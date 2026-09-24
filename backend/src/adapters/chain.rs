use super::rpc::Transport;
use crate::{
    domain::{now, AppError},
    observations::{AgreementView, Deployment, WalletTokenAccount, WalletView},
};
use anchor_lang::{prelude::Pubkey, AccountDeserialize, Discriminator};
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions, state::Account as TokenAccount,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use solana_rpc_client::{nonblocking::rpc_client::RpcClient, rpc_client::RpcClientConfig};
use solana_rpc_client_api::request::RpcRequest;
use std::{collections::BTreeSet, str::FromStr};
use volaryn::state::{Agreement, AgreementStatus};

pub struct Chain {
    client: RpcClient,
    pub transport: Transport,
}

pub(super) fn data(account: &Value) -> Result<Vec<u8>, AppError> {
    STANDARD
        .decode(account["data"][0].as_str().ok_or(AppError::Chain)?)
        .map_err(|_| AppError::Chain)
}

fn token_amount(account: &Value, mint: &str, owner: &str, program: &str) -> Result<u64, AppError> {
    if account["owner"].as_str() != Some(program) {
        return Err(AppError::Chain);
    }
    let bytes = data(account)?;
    let token = StateWithExtensions::<TokenAccount>::unpack(&bytes).map_err(|_| AppError::Chain)?;
    if token.base.mint.to_string() != mint || token.base.owner.to_string() != owner {
        return Err(AppError::Chain);
    }
    Ok(token.base.amount)
}

pub(super) fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &volaryn::ID).0
}

impl Chain {
    pub fn new(url: String) -> Result<Self, reqwest::Error> {
        let transport = Transport::new(url)?;
        let client = RpcClient::new_sender(transport.clone(), RpcClientConfig::default());
        Ok(Self { client, transport })
    }

    pub(crate) async fn request(
        &self,
        request: RpcRequest,
        params: Value,
    ) -> Result<Value, AppError> {
        self.client
            .send(request, params)
            .await
            .map_err(|_| AppError::Chain)
    }

    /// Discover identities without downloading every agreement's data.
    pub async fn discover(&self, deployment: &Deployment) -> Result<(u64, Vec<String>), AppError> {
        let body = serde_json::to_vec(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts",
            "params": [deployment.program_id, {
                "encoding": "base64", "commitment": "finalized", "withContext": true,
                "dataSlice": {"offset": 0, "length": 0},
                "filters": [{"memcmp": {"offset": 0,
                    "bytes": STANDARD.encode(Agreement::DISCRIMINATOR), "encoding": "base64"}}]
            }]
        }))
        .map_err(|_| AppError::Chain)?;
        // Internal discovery has a separate bounded budget; public RPC stays at 2 MiB.
        let response = self
            .transport
            .raw_bounded(body.into(), 32 * 1024 * 1024)
            .await?;
        let envelope: Value = serde_json::from_slice(&response).map_err(|_| AppError::Chain)?;
        if envelope.get("error").is_some() {
            return Err(AppError::Chain);
        }
        let result = &envelope["result"];
        let slot = result["context"]["slot"].as_u64().ok_or(AppError::Chain)?;
        let mut addresses = BTreeSet::new();
        for account in result["value"].as_array().ok_or(AppError::Chain)? {
            if account["account"]["owner"] != deployment.program_id {
                return Err(AppError::Identity);
            }
            let address = account["pubkey"].as_str().ok_or(AppError::Chain)?;
            Pubkey::from_str(address).map_err(|_| AppError::Chain)?;
            addresses.insert(address.to_owned());
        }
        Ok((slot, addresses.into_iter().collect()))
    }

    /// Each agreement and its reserve share one response context (up to 50 pairs).
    pub async fn agreement_batch(
        &self,
        deployment: &Deployment,
        addresses: &[String],
        minimum_slot: u64,
    ) -> Result<(u64, Vec<AgreementView>), AppError> {
        if addresses.is_empty() || addresses.len() > 50 {
            return Err(AppError::Invalid);
        }
        let mut keys = Vec::with_capacity(addresses.len() * 2);
        for address in addresses {
            let key = Pubkey::from_str(address).map_err(|_| AppError::Invalid)?;
            keys.push(address.clone());
            keys.push(pda(&[b"reserve", key.as_ref()]).to_string());
        }
        let result = self.request(RpcRequest::GetMultipleAccounts,
            json!([keys, {"encoding":"base64", "commitment":"finalized", "minContextSlot":minimum_slot}])).await?;
        let slot = result["context"]["slot"].as_u64().ok_or(AppError::Chain)?;
        let accounts = result["value"].as_array().ok_or(AppError::Chain)?;
        if slot < minimum_slot || accounts.len() != addresses.len() * 2 {
            return Err(AppError::Chain);
        }
        let observed_at = now();
        let views = addresses
            .iter()
            .zip(accounts.as_chunks::<2>().0)
            .map(|(address, pair)| {
                if pair[0].is_null() {
                    return Err(AppError::NotFound);
                }
                if pair[0]["owner"] != deployment.program_id {
                    return Err(AppError::Identity);
                }
                let bytes = data(&pair[0])?;
                let agreement = Agreement::try_deserialize(&mut bytes.as_slice())
                    .map_err(|_| AppError::Chain)?;
                let key = Pubkey::from_str(address).map_err(|_| AppError::Invalid)?;
                let expected = pda(&[
                    b"agreement",
                    agreement.writer.as_ref(),
                    &agreement.nonce.to_le_bytes(),
                ]);
                if agreement.version != 1
                    || agreement.usdc_mint.to_string() != deployment.usdc_mint
                    || agreement.usdc_program != anchor_spl::token::ID
                    || key != expected
                {
                    return Err(AppError::Identity);
                }
                let amount = token_amount(
                    &pair[1],
                    &deployment.usdc_mint,
                    address,
                    &anchor_spl::token::ID.to_string(),
                )?;
                Ok(AgreementView {
                    address: address.clone(),
                    version: agreement.version,
                    writer: agreement.writer.to_string(),
                    holder: agreement.holder.map(|key| key.to_string()),
                    designated_holder: agreement.designated_holder.map(|key| key.to_string()),
                    underlying_mint: agreement.underlying_mint.to_string(),
                    underlying_program: agreement.underlying_program.to_string(),
                    underlying_decimals: agreement.underlying_decimals,
                    usdc_mint: agreement.usdc_mint.to_string(),
                    quantity_raw: agreement.quantity_raw.to_string(),
                    payout: agreement.payout.to_string(),
                    premium: agreement.premium.to_string(),
                    accept_before: agreement.accept_before.to_string(),
                    expires_at: agreement.expires_at.to_string(),
                    status: match agreement.status {
                        AgreementStatus::Funded => "funded",
                        AgreementStatus::Active => "active",
                        AgreementStatus::Exercised => "exercised",
                        AgreementStatus::Cancelled => "cancelled",
                        AgreementStatus::Expired => "expired",
                    }
                    .into(),
                    policy_version: agreement.policy_version,
                    reserve: pda(&[b"reserve", key.as_ref()]).to_string(),
                    reserve_amount: amount.to_string(),
                    settlement: pda(&[b"settlement", key.as_ref()]).to_string(),
                    net_received: agreement.net_received.to_string(),
                    finalized_slot: slot.to_string(),
                    observed_at,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok((slot, views))
    }

    /// Preserve individual sources: combined balances cannot authorize a one-account transfer.
    pub async fn wallet(
        &self,
        deployment: &Deployment,
        owner: &str,
    ) -> Result<WalletView, AppError> {
        Pubkey::from_str(owner).map_err(|_| AppError::Invalid)?;
        let mut accounts = Vec::new();
        for program in [anchor_spl::token_2022::ID, anchor_spl::token::ID] {
            let result = self
                .request(
                    RpcRequest::GetTokenAccountsByOwner,
                    json!([owner, {"programId":program.to_string()}, {"encoding":"base64", "commitment":"finalized"}]),
                )
                .await?;
            let slot = result["context"]["slot"].as_u64().ok_or(AppError::Chain)?;
            for entry in result["value"].as_array().ok_or(AppError::Chain)? {
                let address = entry["pubkey"].as_str().ok_or(AppError::Chain)?;
                Pubkey::from_str(address).map_err(|_| AppError::Chain)?;
                let bytes = data(&entry["account"])?;
                let token = StateWithExtensions::<TokenAccount>::unpack(&bytes)
                    .map_err(|_| AppError::Chain)?;
                let mint = token.base.mint.to_string();
                let decimals = if program == anchor_spl::token::ID && mint == deployment.usdc_mint {
                    6
                } else if program == anchor_spl::token_2022::ID {
                    let Some(asset) = deployment.assets.iter().find(|asset| asset.mint == mint)
                    else {
                        continue;
                    };
                    asset.decimals
                } else {
                    continue;
                };
                let amount = token_amount(&entry["account"], &mint, owner, &program.to_string())?;
                accounts.push(WalletTokenAccount {
                    address: address.into(),
                    mint: mint.clone(),
                    token_program: program.to_string(),
                    amount_raw: amount.to_string(),
                    frozen: token.base.state
                        == anchor_spl::token_2022::spl_token_2022::state::AccountState::Frozen,
                    decimals,
                    finalized_slot: slot.to_string(),
                });
            }
        }
        accounts.sort_by(|a, b| a.address.cmp(&b.address));
        Ok(WalletView {
            owner: owner.into(),
            accounts,
        })
    }
}
