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
    /// Referenced agreements already written or held by this wallet in discovery, independent of portfolio pagination.
    pub indexed_agreements: Vec<String>,
    /// Independent of pagination, so older unresolved operations remain recoverable.
    pub pending: Vec<Activity>,
}

impl Application {
    /// Preflight a first-seen signed operation before persisting its receipt and relaying it.
    pub async fn record_submission(&self, params: &Value) -> Result<(), AppError> {
        let Some(intent) = decode::decode(params)? else {
            return Ok(());
        };
        if store::find(&self.pool, &intent.signature).await?.is_some() {
            return Ok(());
        }
        if self.deployment.mode == "mainnet"
            && matches!(intent.operation, Operation::Create | Operation::Activate)
        {
            let mint = if let Some(terms) = &intent.created_terms {
                terms.underlying_mint.clone()
            } else {
                let (_, agreements) = self
                    .chain
                    .agreement_batch(&self.deployment, std::slice::from_ref(&intent.agreement), 0)
                    .await?;
                agreements
                    .first()
                    .ok_or(AppError::NotFound)?
                    .underlying_mint
                    .clone()
            };
            if !self
                .chain
                .admission(&self.deployment, &mint)
                .await?
                .new_commitments
            {
                return Err(AppError::Invalid);
            }
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
        // Signature possession alone must not admit unexecutable operations into durable work.
        // Existing receipts return above so a landed transaction can still be retried/recovered.
        let simulation = self
            .chain
            .request(
                RpcRequest::SimulateTransaction,
                json!([params[0], {
                    "encoding":"base64", "commitment":"confirmed",
                    "sigVerify":true, "replaceRecentBlockhash":false,
                    "minContextSlot":minimum_slot
                }]),
            )
            .await
            .and_then(|simulation| {
                if simulation["context"]["slot"]
                    .as_u64()
                    .ok_or(AppError::Chain)?
                    < minimum_slot
                {
                    return Err(AppError::Chain);
                }
                if !simulation["value"]
                    .get("err")
                    .ok_or(AppError::Chain)?
                    .is_null()
                {
                    return Err(AppError::Invalid);
                }
                Ok(())
            });
        if let Err(error) = simulation {
            // Another request may have persisted and relayed this exact signature while
            // simulation was running. Keep concurrent retries as idempotent as saved ones.
            return if store::find(&self.pool, &intent.signature).await?.is_some() {
                Ok(())
            } else {
                Err(error)
            };
        }
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
