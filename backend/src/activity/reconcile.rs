use super::{Activity, Operation, Status, Terms};
use crate::{
    adapters::{
        activity as store,
        chain::{agreement_account, Chain},
    },
    domain::AppError,
    observations::{Deployment, OfferSide},
};
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
    let agreement = agreement_account(&response["value"], &entry.agreement, deployment)?;
    Ok(effect_status(entry, &agreement))
}

/// Proofs require immutable creator/terms, fixed matched roles and irreversible settlement.
pub(super) fn effect_status(entry: &Activity, agreement: &Agreement) -> Status {
    let side = OfferSide::from(agreement.side);
    let creator = agreement.creator.to_string() == entry.owner;
    let writer = agreement
        .writer
        .is_some_and(|key| key.to_string() == entry.owner);
    let holder = agreement
        .holder
        .is_some_and(|key| key.to_string() == entry.owner);
    let expected_role = match entry.operation {
        Operation::Create | Operation::Cancel => side,
        Operation::Activate => side.counterparty(),
        Operation::Exercise => OfferSide::Holder,
        Operation::Reclaim => OfferSide::Writer,
        Operation::Cleanup if agreement.status == AgreementStatus::Cancelled => side,
        Operation::Cleanup => OfferSide::Writer,
    };
    if entry.side != side || entry.actor_role != expected_role {
        return Status::Unresolved;
    }
    let happened = match entry.operation {
        Operation::Create if creator => {
            let terms = Terms {
                side,
                underlying_mint: agreement.underlying_mint.to_string(),
                nonce: agreement.nonce.to_string(),
                quantity_raw: agreement.quantity_raw.to_string(),
                payout: agreement.payout.to_string(),
                premium: agreement.premium.to_string(),
                accept_before: agreement.accept_before.to_string(),
                expires_at: agreement.expires_at.to_string(),
                designated_counterparty: agreement
                    .designated_counterparty
                    .map(|key| key.to_string()),
            };
            return if entry.created_terms.as_ref() == Some(&terms) {
                Status::Reconciled
            } else {
                Status::Unresolved
            };
        }
        Operation::Cancel if creator => agreement.status == AgreementStatus::Cancelled,
        Operation::Reclaim if writer => agreement.status == AgreementStatus::Expired,
        Operation::Activate => {
            if agreement.activated_at.is_none() {
                false
            } else if agreement.holder.is_none() || agreement.writer.is_none() {
                return Status::Unresolved;
            } else {
                match side.counterparty() {
                    OfferSide::Writer => writer,
                    OfferSide::Holder => holder,
                }
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
