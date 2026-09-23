use super::{Activity, Operation, Status, Terms};
use crate::{
    adapters::{activity as store, chain::Chain},
    domain::AppError,
    observations::Deployment,
};
use anchor_lang::{prelude::Pubkey, AccountDeserialize};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use solana_rpc_client_api::request::RpcRequest;
use sqlx::PgPool;
use volaryn::state::{Agreement, AgreementStatus};

pub(super) async fn refresh(
    chain: &Chain,
    pool: &PgPool,
    deployment: &Deployment,
) -> Result<(), AppError> {
    let entries = store::pending(pool).await?;
    if entries.is_empty() {
        return Ok(());
    }
    // Read the root before history so absence is checked after the lifetime boundary.
    let root = chain
        .request(
            RpcRequest::GetEpochInfo,
            json!([{"commitment":"finalized"}]),
        )
        .await?;
    let height = root["blockHeight"].as_u64().ok_or(AppError::Chain)?;
    let slot = root["absoluteSlot"].as_u64().ok_or(AppError::Chain)?;
    let signatures: Vec<_> = entries.iter().map(|item| &item.signature).collect();
    let statuses = chain
        .request(
            RpcRequest::GetSignatureStatuses,
            json!([signatures, {"searchTransactionHistory":true}]),
        )
        .await?;
    let values = statuses["value"].as_array().ok_or(AppError::Chain)?;
    if values.len() != entries.len() {
        return Err(AppError::Chain);
    }
    for (entry, status) in entries.iter().zip(values) {
        let state = if status["confirmationStatus"] == "finalized" {
            if status.get("err").ok_or(AppError::Chain)?.is_null() {
                Status::Finalized
            } else {
                Status::Failed
            }
        } else if status["confirmationStatus"] == "confirmed" {
            Status::Provisional
        } else if !status.is_null() {
            Status::Pending
        } else if height
            > entry
                .last_valid_block_height
                .parse::<u64>()
                .map_err(|_| AppError::Storage)?
        {
            effect(chain, deployment, entry, slot)
                .await
                .unwrap_or(Status::Unresolved)
        } else {
            Status::Pending
        };
        store::update(pool, &entry.signature, state).await?;
    }
    Ok(())
}

async fn effect(
    chain: &Chain,
    deployment: &Deployment,
    entry: &Activity,
    slot: u64,
) -> Result<Status, AppError> {
    let response = chain
        .request(
            RpcRequest::GetAccountInfo,
            json!([entry.agreement,
        {"encoding":"base64", "commitment":"finalized", "minContextSlot":slot}]),
        )
        .await?;
    if response["context"]["slot"]
        .as_u64()
        .ok_or(AppError::Chain)?
        < slot
    {
        return Err(AppError::Chain);
    }
    if response["value"].is_null() {
        return Ok(if entry.operation == Operation::Create {
            Status::Expired
        } else {
            Status::Unresolved
        });
    }
    let account = &response["value"];
    if account["owner"] != deployment.program_id {
        return Err(AppError::Identity);
    }
    let bytes = STANDARD
        .decode(account["data"][0].as_str().ok_or(AppError::Chain)?)
        .map_err(|_| AppError::Chain)?;
    let agreement =
        Agreement::try_deserialize(&mut bytes.as_slice()).map_err(|_| AppError::Chain)?;
    let expected = Pubkey::find_program_address(
        &[
            b"agreement",
            agreement.writer.as_ref(),
            &agreement.nonce.to_le_bytes(),
        ],
        &volaryn::ID,
    )
    .0;
    if agreement.version != 1
        || expected.to_string() != entry.agreement
        || agreement.usdc_mint.to_string() != deployment.usdc_mint
    {
        return Err(AppError::Identity);
    }
    Ok(effect_status(entry, &agreement))
}

/// These proofs depend on version 1's immutable terms, fixed holder and irreversible settlement.
pub(super) fn effect_status(entry: &Activity, agreement: &Agreement) -> Status {
    let writer = agreement.writer.to_string() == entry.owner;
    let holder = agreement
        .holder
        .is_some_and(|key| key.to_string() == entry.owner);
    let happened = match entry.operation {
        Operation::Create if writer => {
            let terms = Terms {
                underlying_mint: agreement.underlying_mint.to_string(),
                nonce: agreement.nonce.to_string(),
                quantity_raw: agreement.quantity_raw.to_string(),
                payout: agreement.payout.to_string(),
                premium: agreement.premium.to_string(),
                accept_before: agreement.accept_before.to_string(),
                expires_at: agreement.expires_at.to_string(),
                designated_holder: agreement.designated_holder.map(|key| key.to_string()),
            };
            return if entry.created_terms.as_ref() == Some(&terms) {
                Status::Reconciled
            } else {
                Status::Unresolved
            };
        }
        Operation::Cancel if writer => agreement.status == AgreementStatus::Cancelled,
        Operation::Reclaim if writer => agreement.status == AgreementStatus::Expired,
        Operation::Activate => {
            if agreement.activated_at.is_none() {
                false
            } else if agreement.holder.is_none() {
                return Status::Unresolved;
            } else {
                holder
            }
        }
        Operation::Exercise if holder => agreement.status == AgreementStatus::Exercised,
        // Repeatable cleanup cannot be attributed to a signature from current balances.
        _ => return Status::Unresolved,
    };
    if happened {
        Status::Reconciled
    } else {
        Status::Expired
    }
}
