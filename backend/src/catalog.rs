//! Lazy, bounded source cache. Provider failures never enter the settlement path.

use crate::{
    adapters::{
        issuer_chain::{self, ChainSnapshot},
        prestocks::{self, ProviderAsset},
        source_http::SourceHttp,
    },
    assets::{
        self, Eligibility, OfficialAsset, OfficialCatalog, Registry, SourceObservation,
        SourceStatus, PRESTOCKS_API,
    },
    domain::now,
};
use std::{collections::BTreeMap, time::Duration};
use tokio::sync::Mutex;
use tokio::time::Instant;

struct Observation<T> {
    value: Option<T>,
    received_at: Option<i64>,
    error: Option<&'static str>,
}
impl<T> Default for Observation<T> {
    fn default() -> Self {
        Self {
            value: None,
            received_at: None,
            error: None,
        }
    }
}
impl<T> Observation<T> {
    fn update(&mut self, result: Result<T, &'static str>, time: i64) {
        match result {
            Ok(value) => {
                self.value = Some(value);
                self.received_at = Some(time);
                self.error = None;
            }
            Err(error) => {
                self.error = Some(error);
                tracing::warn!(
                    source_error = error,
                    "official asset observation unavailable"
                );
            }
        }
    }
    fn view(&self, time: i64) -> SourceObservation {
        SourceObservation {
            status: if self.value.is_none() {
                SourceStatus::Unavailable
            } else if self.error.is_some()
                || self
                    .received_at
                    .is_none_or(|received| time < received || time - received > 60)
            {
                SourceStatus::Stale
            } else {
                SourceStatus::Fresh
            },
            received_at: self.received_at,
            error: self.error.map(str::to_owned),
        }
    }
}

#[derive(Default)]
struct Cache {
    attempted: Option<Instant>,
    market: Observation<BTreeMap<String, ProviderAsset>>,
    chain: Observation<ChainSnapshot>,
}

pub struct Catalog {
    http: SourceHttp,
    api_url: String,
    rpc_url: String,
    registry: Registry,
    cache: Mutex<Cache>,
}

impl Catalog {
    pub fn new(rpc_url: String) -> Result<Self, reqwest::Error> {
        Self::with_sources(PRESTOCKS_API.into(), rpc_url, Registry::embedded())
    }

    /// Explicit dependency injection for captured-response tests, never controlled by HTTP input.
    pub fn with_sources(
        api_url: String,
        rpc_url: String,
        registry: Registry,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: SourceHttp::new()?,
            api_url,
            rpc_url,
            registry,
            cache: Mutex::new(Cache::default()),
        })
    }

    pub async fn observe(&self) -> OfficialCatalog {
        let mut cache = self.cache.lock().await;
        if cache
            .attempted
            .is_none_or(|last| last.elapsed() >= Duration::from_secs(30))
        {
            let (market, chain) = tokio::join!(
                async {
                    let result = self
                        .http
                        .json(&self.api_url, None)
                        .await
                        .and_then(prestocks::parse);
                    (result, now())
                },
                async {
                    let result =
                        issuer_chain::read(&self.http, &self.rpc_url, &self.registry).await;
                    (result, now())
                },
            );
            cache.market.update(market.0, market.1);
            cache.chain.update(chain.0, chain.1);
            cache.attempted = Some(Instant::now());
        }
        self.view(&cache, now())
    }

    fn view(&self, cache: &Cache, time: i64) -> OfficialCatalog {
        let market_source = cache.market.view(time);
        let chain_source = cache.chain.view(time);
        let fresh = matches!(market_source.status, SourceStatus::Fresh)
            && matches!(chain_source.status, SourceStatus::Fresh);
        let mut assets = Vec::new();
        for policy in &self.registry.assets {
            let provider = cache
                .market
                .value
                .as_ref()
                .and_then(|rows| rows.get(&policy.mint));
            let market = provider.and_then(|asset| asset.market().ok());
            let observation = cache
                .chain
                .value
                .as_ref()
                .and_then(|snapshot| snapshot.mints.get(&policy.mint));
            let chain = observation.and_then(|result| result.as_ref().ok()).cloned();
            let (eligibility, reason) = if let Some(chain) = &chain {
                let evaluated = assets::eligibility(&self.registry, policy, chain, time);
                if evaluated.0 != Eligibility::Compatible {
                    evaluated
                } else if provider.is_none() {
                    (
                        Eligibility::Unavailable,
                        "The issuer did not return this reviewed mint".into(),
                    )
                } else if !fresh {
                    (
                        Eligibility::Stale,
                        "Fresh issuer and network observations are required for new admission"
                            .into(),
                    )
                } else {
                    evaluated
                }
            } else if observation.is_some_and(Result::is_err) {
                (
                    Eligibility::Unsupported,
                    "The official account is missing or has an unsupported mint representation"
                        .into(),
                )
            } else {
                (
                    Eligibility::Unavailable,
                    "The official network observation is unavailable".into(),
                )
            };
            assets.push(OfficialAsset {
                mint: policy.mint.clone(),
                name: policy.name.clone(),
                symbol: policy.symbol.clone(),
                eligibility,
                reason,
                policy: Some(policy.clone()),
                market,
                chain,
            });
        }
        if let Some(rows) = &cache.market.value {
            for (mint, asset) in rows {
                if self
                    .registry
                    .assets
                    .iter()
                    .any(|policy| &policy.mint == mint)
                {
                    continue;
                }
                assets.push(OfficialAsset {
                    mint: mint.clone(),
                    name: asset.name.clone(),
                    symbol: asset.symbol.clone(),
                    eligibility: Eligibility::Unreviewed,
                    reason: "A new issuer listing does not automatically permit protection".into(),
                    policy: None,
                    market: asset.market().ok(),
                    chain: None,
                });
            }
        }
        OfficialCatalog {
            network: "solana:mainnet".into(),
            genesis_hash: self.registry.genesis_hash.clone(),
            source: PRESTOCKS_API.into(),
            market_source,
            chain_source,
            finalized_slot: cache
                .chain
                .value
                .as_ref()
                .map(|snapshot| snapshot.slot.to_string()),
            assets,
        }
    }
}
