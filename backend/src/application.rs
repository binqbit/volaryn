use crate::{
    adapters::{chain::Chain, store},
    config::IndexConfig,
    domain::{now, AppError},
    indexer::Indexer,
    observations::{AgreementView, Deployment},
    queries::AgreementQuery,
};
use sqlx::PgPool;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct Application {
    pub catalog: crate::catalog::Catalog,
    pub deployment: Deployment,
    pub chain: Arc<Chain>,
    pub pool: PgPool,
    last_success: AtomicI64,
    indexer: Mutex<Indexer>,
    identity_verified: Mutex<Option<Instant>>,
}

impl Application {
    pub fn new(
        deployment: Deployment,
        chain: Chain,
        pool: PgPool,
        catalog: crate::catalog::Catalog,
        index: IndexConfig,
    ) -> Arc<Self> {
        Arc::new(Self {
            catalog,
            deployment,
            chain: Arc::new(chain),
            pool,
            last_success: AtomicI64::new(0),
            indexer: Mutex::new(Indexer::new(Duration::from_secs(
                index.index_discovery_interval_secs,
            ))),
            identity_verified: Mutex::new(None),
        })
    }

    pub fn ready(&self) -> Result<(), AppError> {
        if now() - self.last_success.load(Ordering::Acquire) > 30 {
            Err(AppError::Stale)
        } else {
            Ok(())
        }
    }

    pub async fn reconcile(&self) -> Result<(), AppError> {
        let mut indexer = self.indexer.lock().await;
        tokio::time::timeout(Duration::from_secs(60), async {
            self.ensure_chain().await?;
            indexer
                .refresh(&self.chain, &self.pool, &self.deployment)
                .await?;
            self.last_success.store(now(), Ordering::Release);
            Ok(())
        })
        .await
        .unwrap_or(Err(AppError::Chain))
    }

    /// Coalesce identity checks independently of database/index availability.
    pub async fn ensure_chain(&self) -> Result<(), AppError> {
        let mut verified = self.identity_verified.lock().await;
        if verified.is_some_and(|time| time.elapsed() < Duration::from_secs(5)) {
            return Ok(());
        }
        *verified = None;
        self.chain.verify_identity(&self.deployment).await?;
        *verified = Some(Instant::now());
        Ok(())
    }

    pub async fn agreements(
        &self,
        query: &AgreementQuery,
        offers_only: bool,
    ) -> Result<store::AgreementPage, AppError> {
        query.page_size()?;
        self.ready()?;
        let chain_time = if offers_only
            || query
                .lifecycle
                .is_some_and(|lifecycle| lifecycle.needs_time())
        {
            self.ensure_chain().await?;
            Some(self.chain.time().await?)
        } else {
            None
        };
        store::agreements(&self.pool, query, offers_only, chain_time).await
    }

    pub async fn agreement(&self, address: &str) -> Result<AgreementView, AppError> {
        address
            .parse::<anchor_lang::prelude::Pubkey>()
            .map_err(|_| AppError::Invalid)?;
        self.ensure_chain().await?;
        // Direct navigation remains usable during a projection or database outage.
        if self.ready().is_ok() {
            if let Ok(Some(value)) = tokio::time::timeout(
                Duration::from_millis(500),
                store::agreement(&self.pool, address),
            )
            .await
            .unwrap_or(Err(AppError::Storage))
            {
                if now() - value.observed_at <= 30 {
                    return Ok(value);
                }
            }
        }
        let (_, mut values) = self
            .chain
            .agreement_batch(&self.deployment, &[address.to_owned()], 0)
            .await?;
        values.pop().ok_or(AppError::NotFound)
    }
}
