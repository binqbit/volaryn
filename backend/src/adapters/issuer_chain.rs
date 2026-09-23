//! Public mainnet observations; this adapter has no transaction-submission operation.

use super::source_http::SourceHttp;
use crate::assets::{FeeSchedule, MintEvidence, Registry, MAINNET_GENESIS};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        confidential_transfer::ConfidentialTransferMint,
        confidential_transfer_fee::ConfidentialTransferFeeConfig,
        default_account_state::DefaultAccountState,
        metadata_pointer::MetadataPointer,
        pausable::PausableConfig,
        permanent_delegate::PermanentDelegate,
        scaled_ui_amount::ScaledUiAmountConfig,
        transfer_fee::{TransferFee, TransferFeeConfig},
        transfer_hook::TransferHook,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::{AccountState, Mint},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};

pub struct ChainSnapshot {
    pub slot: u64,
    pub mints: BTreeMap<String, Result<MintEvidence, &'static str>>,
}

pub async fn read(
    http: &SourceHttp,
    url: &str,
    registry: &Registry,
) -> Result<ChainSnapshot, &'static str> {
    tokio::time::timeout(Duration::from_secs(8), snapshot(http, url, registry))
        .await
        .map_err(|_| "timeout")?
}

async fn rpc(
    http: &SourceHttp,
    url: &str,
    method: &str,
    params: Value,
) -> Result<Value, &'static str> {
    let body = json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params});
    let response = http.json(url, Some(body)).await?;
    if response.get("error").is_some() {
        return Err("rpc_error");
    }
    response.get("result").cloned().ok_or("invalid_response")
}

async fn snapshot(
    http: &SourceHttp,
    url: &str,
    registry: &Registry,
) -> Result<ChainSnapshot, &'static str> {
    if rpc(http, url, "getGenesisHash", json!([])).await?.as_str() != Some(MAINNET_GENESIS)
        || registry.genesis_hash != MAINNET_GENESIS
    {
        return Err("wrong_network");
    }
    let epoch = rpc(
        http,
        url,
        "getEpochInfo",
        json!([{"commitment":"finalized"}]),
    )
    .await?;
    let minimum_slot = epoch["absoluteSlot"].as_u64().ok_or("invalid_response")?;
    let epoch_number = epoch["epoch"].as_u64().ok_or("invalid_response")?;
    let epoch_start = minimum_slot
        .checked_sub(epoch["slotIndex"].as_u64().ok_or("invalid_response")?)
        .ok_or("invalid_response")?;
    let epoch_end = epoch_start
        .checked_add(epoch["slotsInEpoch"].as_u64().ok_or("invalid_response")?)
        .ok_or("invalid_response")?;
    let addresses: Vec<_> = registry.assets.iter().map(|asset| &asset.mint).collect();
    let params = json!([addresses, {"encoding":"base64", "commitment":"finalized", "minContextSlot":minimum_slot}]);
    let accounts = rpc(http, url, "getMultipleAccounts", params).await?;
    let slot = accounts["context"]["slot"]
        .as_u64()
        .ok_or("invalid_response")?;
    let values = accounts["value"].as_array().ok_or("invalid_response")?;
    if slot < minimum_slot || values.len() != addresses.len() {
        return Err("invalid_response");
    }
    if slot >= epoch_end {
        return Err("epoch_changed");
    }
    let time = rpc(http, url, "getBlockTime", json!([slot]))
        .await?
        .as_i64()
        .ok_or("invalid_response")?;
    if crate::domain::now().abs_diff(time) > 60 {
        return Err("stale_chain");
    }
    let mints = registry
        .assets
        .iter()
        .zip(values)
        .map(|(asset, value)| (asset.mint.clone(), inspect_mint(value, epoch_number, time)))
        .collect();
    Ok(ChainSnapshot { slot, mints })
}

pub fn inspect_mint(
    account: &Value,
    epoch: u64,
    chain_time: i64,
) -> Result<MintEvidence, &'static str> {
    let program = account["owner"].as_str().ok_or("missing_mint")?;
    if program != anchor_spl::token_2022::ID.to_string()
        || account["executable"] != false
        || account["data"][1] != "base64"
    {
        return Err("unsupported_mint");
    }
    let bytes = STANDARD
        .decode(account["data"][0].as_str().ok_or("invalid_mint")?)
        .map_err(|_| "invalid_mint")?;
    let mint = StateWithExtensions::<Mint>::unpack(&bytes).map_err(|_| "invalid_mint")?;
    let mut extensions: Vec<_> = mint
        .get_extension_types()
        .map_err(|_| "invalid_mint")?
        .into_iter()
        .map(|kind| format!("{kind:?}"))
        .collect();
    extensions.sort();
    let mut authorities = BTreeMap::new();
    authorities.insert(
        "mint".into(),
        Option::<Pubkey>::from(mint.base.mint_authority).map(|key| key.to_string()),
    );
    authorities.insert(
        "freeze".into(),
        Option::<Pubkey>::from(mint.base.freeze_authority).map(|key| key.to_string()),
    );
    macro_rules! authority {
        ($kind:ty, $field:ident, $name:literal) => {
            if let Ok(config) = mint.get_extension::<$kind>() {
                authorities.insert(
                    $name.into(),
                    Option::<Pubkey>::from(config.$field).map(|key| key.to_string()),
                );
            }
        };
    }
    authority!(
        TransferFeeConfig,
        transfer_fee_config_authority,
        "transferFee"
    );
    authority!(
        TransferFeeConfig,
        withdraw_withheld_authority,
        "withheldFees"
    );
    authority!(TransferHook, authority, "transferHook");
    authority!(PermanentDelegate, delegate, "permanentDelegate");
    authority!(PausableConfig, authority, "pause");
    authority!(ScaledUiAmountConfig, authority, "scaling");
    authority!(ConfidentialTransferMint, authority, "confidentialTransfer");
    authority!(ConfidentialTransferFeeConfig, authority, "confidentialFees");
    authority!(MetadataPointer, authority, "metadata");
    let fee = |value: &TransferFee| FeeSchedule {
        epoch: u64::from(value.epoch).to_string(),
        basis_points: u16::from(value.transfer_fee_basis_points),
        maximum_raw: u64::from(value.maximum_fee).to_string(),
    };
    let fees = mint.get_extension::<TransferFeeConfig>().ok();
    let scale = mint.get_extension::<ScaledUiAmountConfig>().ok();
    let scale_value = |value| {
        let value = f64::from(value);
        if !value.is_finite() || value <= 0.0 {
            return Err("invalid_scaling");
        }
        Ok(value.to_string())
    };
    let current_multiplier = scale
        .map(|config| {
            scale_value(
                if chain_time >= i64::from(config.new_multiplier_effective_timestamp) {
                    config.new_multiplier
                } else {
                    config.multiplier
                },
            )
        })
        .transpose()?;
    let mut restrictions: Vec<String> = vec!["Only transparent balances can be delivered".into()];
    for (role, warning) in [
        ("mint", "The issuer can mint additional supply"),
        ("freeze", "The issuer can freeze token accounts and block delivery"),
        ("permanentDelegate", "The issuer can transfer or burn holdings through a permanent delegate"),
        ("transferFee", "Issuer fees can change before exercise without changing the gross obligation or USDC payout"),
        ("scaling", "The issuer can change displayed quantities without changing raw balances"),
        ("transferHook", "The issuer can enable a transfer hook and block this delivery path"),
        ("pause", "The issuer can pause token transfers"),
    ] {
        if authorities.get(role).is_some_and(Option::is_some) { restrictions.push(warning.into()); }
    }
    if mint
        .get_extension::<PausableConfig>()
        .is_ok_and(|pause| bool::from(pause.paused))
    {
        restrictions.push("Transfers are paused".into());
    }
    if mint
        .get_extension::<TransferHook>()
        .is_ok_and(|hook| Option::<Pubkey>::from(hook.program_id).is_some())
    {
        restrictions.push("An active transfer hook is unsupported".into());
    }
    if mint
        .get_extension::<DefaultAccountState>()
        .is_ok_and(|default| default.state != AccountState::Initialized as u8)
    {
        restrictions.push("The default account state blocks new commitments".into());
    }
    Ok(MintEvidence {
        token_program: program.into(),
        decimals: mint.base.decimals,
        supply_raw: mint.base.supply.to_string(),
        extensions,
        authorities,
        current_fee: fees.map(|config| fee(config.get_epoch_fee(epoch))),
        next_fee: fees
            .filter(|config| epoch < u64::from(config.newer_transfer_fee.epoch))
            .map(|config| fee(&config.newer_transfer_fee)),
        display_multiplier: current_multiplier,
        next_display_multiplier: scale
            .map(|config| scale_value(config.new_multiplier))
            .transpose()?,
        multiplier_effective_at: scale
            .map(|config| i64::from(config.new_multiplier_effective_timestamp)),
        transparent_transfer_supported: volaryn::token::validate_mint_state(&mint, true).is_ok(),
        restrictions,
    })
}
