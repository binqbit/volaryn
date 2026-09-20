//! Bounded account reconciliation; public transaction transport never waits on this worker.

use crate::{
    adapters::{chain::Chain, store},
    domain::{now, AppError},
    observations::Deployment,
};
use sqlx::PgPool;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::task::JoinSet;

#[derive(Default)]
pub struct Indexer {
    discovered_at: Option<Instant>,
}

impl Indexer {
    pub async fn refresh(
        &mut self,
        chain: &Arc<Chain>,
        pool: &PgPool,
        deployment: &Deployment,
    ) -> Result<(), AppError> {
        let started = Instant::now();
        let full_scan = self
            .discovered_at
            .is_none_or(|time| time.elapsed() >= Duration::from_secs(30));
        let minimum_slot = store::last_slot(pool).await?;
        let mut count = 0;
        if full_scan {
            let (slot, addresses) = chain.discover(deployment).await?;
            if slot < minimum_slot {
                return Err(AppError::Chain);
            }
            count = addresses.len();
            refresh_batches(chain, pool, deployment, &addresses, slot).await?;
            store::upsert(pool, &[], slot, now()).await?;
            self.discovered_at = Some(Instant::now());
        } else {
            let mut after = String::new();
            loop {
                let addresses = store::active_addresses(pool, &after).await?;
                let Some(last) = addresses.last() else {
                    break;
                };
                after.clone_from(last);
                count += addresses.len();
                refresh_batches(chain, pool, deployment, &addresses, minimum_slot).await?;
            }
        }
        tracing::info!(
            agreements = count,
            full_scan,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "index reconciliation complete"
        );
        Ok(())
    }
}

async fn refresh_batches(
    chain: &Arc<Chain>,
    pool: &PgPool,
    deployment: &Deployment,
    addresses: &[String],
    minimum_slot: u64,
) -> Result<(), AppError> {
    // Four independent responses at most; each contains 50 agreement/reserve pairs.
    let mut batches = addresses.chunks(50);
    let mut running = JoinSet::new();
    loop {
        while running.len() < 4 {
            let Some(batch) = batches.next() else {
                break;
            };
            let chain = Arc::clone(chain);
            let deployment = deployment.clone();
            let batch = batch.to_vec();
            running.spawn(async move {
                chain
                    .agreement_batch(&deployment, &batch, minimum_slot)
                    .await
            });
        }
        let Some(result) = running.join_next().await else {
            break;
        };
        let (slot, values) = result.map_err(|_| AppError::Chain)??;
        store::upsert(pool, &values, slot, now()).await?;
    }
    Ok(())
}
