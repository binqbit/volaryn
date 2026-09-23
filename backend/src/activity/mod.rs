//! Public, signature-authenticated operation receipts; never a source of balances or rights.
mod decode;
mod reconcile;
#[cfg(test)]
mod tests;

use crate::{
    adapters::activity as store,
    application::Application,
    domain::{now, AppError},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use solana_rpc_client_api::request::RpcRequest;
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Create,
    Activate,
    Exercise,
    Cancel,
    Reclaim,
    Cleanup,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pending,
    Provisional,
    Finalized,
    Failed,
    Expired,
    Reconciled,
    Unresolved,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Terms {
    pub underlying_mint: String,
    pub nonce: String,
    pub quantity_raw: String,
    pub payout: String,
    pub premium: String,
    pub accept_before: String,
    pub expires_at: String,
    pub designated_holder: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub signature: String,
    pub owner: String,
    pub agreement: String,
    pub operation: Operation,
    pub created_terms: Option<Terms>,
    pub last_valid_block_height: String,
    pub status: Status,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ActivityQuery {
    pub owner: String,
    pub before: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub items: Vec<Activity>,
    pub next: Option<String>,
    /// Independent of pagination, so older unresolved operations remain recoverable.
    pub pending: Vec<Activity>,
}

impl Application {
    /// Called before relaying a supported signed operation. Storage failure prevents sending.
    pub async fn record_submission(&self, params: &Value) -> Result<(), AppError> {
        let Some(intent) = decode::decode(params)? else {
            return Ok(());
        };
        if store::find(&self.pool, &intent.signature).await?.is_some() {
            return Ok(());
        }
        // Establish a server-observed upper lifetime bound, never a client-supplied height.
        let valid = self
            .chain
            .request(
                RpcRequest::IsBlockhashValid,
                json!([intent.blockhash, {"commitment":"confirmed"}]),
            )
            .await?;
        if valid["value"] != true {
            return Err(AppError::Invalid);
        }
        let minimum_slot = valid["context"]["slot"].as_u64().ok_or(AppError::Chain)?;
        let lifetime = self
            .chain
            .request(
                RpcRequest::GetLatestBlockhash,
                json!([{"commitment":"confirmed", "minContextSlot":minimum_slot}]),
            )
            .await?;
        let height = lifetime["value"]["lastValidBlockHeight"]
            .as_u64()
            .ok_or(AppError::Chain)?;
        let timestamp = now();
        store::insert(
            &self.pool,
            &Activity {
                id: String::new(),
                signature: intent.signature,
                owner: intent.owner,
                agreement: intent.agreement,
                operation: intent.operation,
                created_terms: intent.created_terms,
                last_valid_block_height: height.to_string(),
                status: Status::Pending,
                created_at: timestamp,
                updated_at: timestamp,
            },
        )
        .await
    }

    pub async fn activity(&self, query: &ActivityQuery) -> Result<ActivityPage, AppError> {
        query
            .owner
            .parse::<anchor_lang::prelude::Pubkey>()
            .map_err(|_| AppError::Invalid)?;
        let before = query
            .before
            .as_ref()
            .map(|value| value.parse::<i64>())
            .transpose()
            .map_err(|_| AppError::Invalid)?;
        if before.is_some_and(|id| id <= 0) {
            return Err(AppError::Invalid);
        }
        self.ensure_chain().await?;
        store::page(&self.pool, &query.owner, before).await
    }

    pub async fn reconcile_activity(&self) -> Result<(), AppError> {
        self.ensure_chain().await?;
        reconcile::refresh(&self.chain, &self.pool, &self.deployment).await
    }
}
