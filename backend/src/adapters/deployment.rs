//! Release identity and admission are separate: expired policies never veto existing exercise.
use super::{
    chain::{data, pda, Chain},
    issuer_chain::inspect_mint,
};
use crate::{
    assets::{eligibility, Eligibility, Registry},
    domain::{now, AppError},
    observations::Deployment,
};
use anchor_lang::{prelude::Pubkey, solana_program::program_pack::Pack, AccountDeserialize};
use anchor_spl::token::spl_token::state::Mint;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use solana_rpc_client_api::request::RpcRequest;
use std::str::FromStr;
use volaryn::state::{AssetPolicy, ProtocolConfig};

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub mint: String,
    pub new_commitments: bool,
    pub reason: String,
}

impl Chain {
    pub async fn admission(
        &self,
        deployment: &Deployment,
        mint: &str,
    ) -> Result<Admission, AppError> {
        let mut selected = deployment.clone();
        selected.assets.retain(|asset| asset.mint == mint);
        if selected.assets.len() != 1 {
            return Err(AppError::Invalid);
        }
        self.check_admission(&selected)
            .await?
            .pop()
            .ok_or(AppError::Chain)
    }

    pub async fn verify_identity(&self, deployment: &Deployment) -> Result<(), AppError> {
        let genesis = self.request(RpcRequest::GetGenesisHash, json!([])).await?;
        if genesis.as_str() != Some(&deployment.genesis_hash) {
            return Err(AppError::Identity);
        }
        let loader = anchor_lang::solana_program::bpf_loader_upgradeable::ID;
        let program_data = Pubkey::find_program_address(&[volaryn::ID.as_ref()], &loader).0;
        let result = self.request(RpcRequest::GetMultipleAccounts, json!([
            [deployment.program_id, program_data.to_string(), pda(&[b"config"]).to_string(), deployment.usdc_mint],
            {"encoding":"base64", "commitment":"finalized"}
        ])).await?;
        let accounts = result["value"]
            .as_array()
            .filter(|items| items.len() == 4)
            .ok_or(AppError::Chain)?;
        let slot = result["context"]["slot"].as_u64().ok_or(AppError::Chain)?;
        let executable = &accounts[0];
        let pointer = data(executable)?;
        let bytes = data(&accounts[1])?;
        let code = bytes
            .get(45..45 + deployment.program_length)
            .ok_or(AppError::Identity)?;
        let authority = match bytes.get(12) {
            Some(0) => None,
            Some(1) => Some(
                Pubkey::new_from_array(
                    bytes
                        .get(13..45)
                        .ok_or(AppError::Identity)?
                        .try_into()
                        .map_err(|_| AppError::Identity)?,
                )
                .to_string(),
            ),
            _ => return Err(AppError::Identity),
        };
        if executable["executable"] != true
            || executable["owner"] != loader.to_string()
            || pointer.len() != 36
            || pointer[..4] != 2u32.to_le_bytes()
            || pointer[4..] != program_data.to_bytes()
            || accounts[1]["owner"] != loader.to_string()
            || bytes[..4] != 3u32.to_le_bytes()
            || u64::from_le_bytes(bytes[4..12].try_into().map_err(|_| AppError::Identity)?) > slot
            || authority != deployment.upgrade_authority
            || format!("{:x}", Sha256::digest(code)) != deployment.program_sha256
            || bytes[45 + deployment.program_length..]
                .iter()
                .any(|value| *value != 0)
        {
            return Err(AppError::Identity);
        }
        let config_bytes = data(&accounts[2])?;
        let config = ProtocolConfig::try_deserialize(&mut config_bytes.as_slice())
            .map_err(|_| AppError::Identity)?;
        let currency = Mint::unpack(&data(&accounts[3])?).map_err(|_| AppError::Identity)?;
        if accounts[2]["owner"] != deployment.program_id
            || config.authority.to_string() != deployment.authority
            || config.usdc_mint.to_string() != deployment.usdc_mint
            || config.usdc_program != anchor_spl::token::ID
            || accounts[3]["owner"] != anchor_spl::token::ID.to_string()
            || currency.decimals != 6
            || !currency.is_initialized
        {
            return Err(AppError::Identity);
        }
        Ok(())
    }

    /// Read-only release smoke check. Disabled or expired policy is a reported condition, not an identity failure.
    pub async fn check_admission(
        &self,
        deployment: &Deployment,
    ) -> Result<Vec<Admission>, AppError> {
        let registry = Registry::embedded();
        let epoch = self
            .request(
                RpcRequest::GetEpochInfo,
                json!([{"commitment":"finalized"}]),
            )
            .await?;
        let epoch_number = epoch["epoch"].as_u64().ok_or(AppError::Chain)?;
        let minimum_slot = epoch["absoluteSlot"].as_u64().ok_or(AppError::Chain)?;
        let epoch_end = minimum_slot
            .checked_sub(epoch["slotIndex"].as_u64().ok_or(AppError::Chain)?)
            .and_then(|start| start.checked_add(epoch["slotsInEpoch"].as_u64()?))
            .ok_or(AppError::Chain)?;
        let mut result = Vec::new();
        for asset in &deployment.assets {
            let mint = Pubkey::from_str(&asset.mint).map_err(|_| AppError::Identity)?;
            let response = self
                .request(
                    RpcRequest::GetMultipleAccounts,
                    json!([
                        [asset.mint, pda(&[b"policy", mint.as_ref()]).to_string()],
                        {"encoding":"base64", "commitment":"finalized", "minContextSlot":minimum_slot}
                    ]),
                )
                .await?;
            let slot = response["context"]["slot"]
                .as_u64()
                .ok_or(AppError::Chain)?;
            if slot < minimum_slot || slot >= epoch_end {
                return Err(AppError::Chain);
            }
            let chain_time = self
                .request(RpcRequest::GetBlockTime, json!([slot]))
                .await?
                .as_i64()
                .ok_or(AppError::Chain)?;
            if now().abs_diff(chain_time) > 60 {
                return Err(AppError::Chain);
            }
            let values = response["value"]
                .as_array()
                .filter(|items| items.len() == 2)
                .ok_or(AppError::Chain)?;
            let bytes = data(&values[1])?;
            let policy = AssetPolicy::try_deserialize(&mut bytes.as_slice())
                .map_err(|_| AppError::Identity)?;
            if values[1]["owner"] != deployment.program_id
                || policy.mint != mint
                || policy.token_program != anchor_spl::token_2022::ID
                || policy.decimals != asset.decimals
                || policy.version == 0
            {
                return Err(AppError::Identity);
            }
            let evidence = inspect_mint(&values[0], epoch_number, chain_time)
                .map_err(|_| AppError::Identity)?;
            if evidence.decimals != asset.decimals {
                return Err(AppError::Identity);
            }
            let reviewed = registry
                .assets
                .iter()
                .find(|item| item.mint == asset.reference_mint)
                .ok_or(AppError::Identity)?;
            let (eligible, reason) = eligibility(&registry, reviewed, &evidence, now());
            let reviewed_limits = deployment.mode == "localnet"
                || (policy.reviewed_until <= reviewed.reviewed_until
                    && policy.max_expiry <= reviewed.max_expiry
                    && matches!(eligible, Eligibility::Compatible));
            let open = policy.enabled
                && now() < policy.reviewed_until
                && now() < policy.max_expiry
                && reviewed_limits;
            result.push(Admission { mint: asset.mint.clone(), new_commitments: open, reason: if open { "Policy permits new commitments within its expiry limits".into() } else { format!("New commitments unavailable: policy disabled, expired, or outside reviewed limits. {reason}") } });
        }
        Ok(result)
    }
}
