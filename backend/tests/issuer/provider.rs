use super::support::Server;
use std::{sync::atomic::Ordering, time::Duration};
use volaryn_backend::{
    adapters::source_http::SourceHttp,
    assets::{Eligibility, SourceStatus},
};

#[tokio::test]
async fn fresh_http_cannot_disguise_old_chain_state_or_cross_epoch_fees() {
    let server = Server::start().await;
    server.state.clock_offset.store(-120, Ordering::SeqCst);
    assert_eq!(
        server
            .catalog()
            .observe()
            .await
            .chain_source
            .error
            .as_deref(),
        Some("stale_chain")
    );
    server.state.clock_offset.store(0, Ordering::SeqCst);
    server.state.accounts.lock().unwrap()["result"]["context"]["slot"] =
        serde_json::json!(448898437 + 432000);
    assert_eq!(
        server
            .catalog()
            .observe()
            .await
            .chain_source
            .error
            .as_deref(),
        Some("epoch_changed")
    );
    server.state.accounts.lock().unwrap()["result"]["context"]["slot"] = serde_json::json!(1);
    assert_eq!(
        server
            .catalog()
            .observe()
            .await
            .chain_source
            .error
            .as_deref(),
        Some("invalid_response")
    );
}

#[tokio::test]
async fn concurrent_reads_coalesce_and_new_listings_require_review() {
    let server = Server::start().await;
    let mut listing = server.state.api.lock().unwrap()[0].clone();
    listing["contract_address"] =
        serde_json::json!(anchor_lang::prelude::Pubkey::new_unique().to_string());
    server
        .state
        .api
        .lock()
        .unwrap()
        .as_array_mut()
        .unwrap()
        .push(listing);
    let catalog = server.catalog();
    let (first, second) = tokio::join!(catalog.observe(), catalog.observe());
    assert_eq!(server.state.calls.load(Ordering::SeqCst), 1);
    assert_eq!(first.assets.len(), second.assets.len());
    assert_eq!(
        first
            .assets
            .iter()
            .filter(|asset| asset.eligibility == Eligibility::Compatible)
            .count(),
        8
    );
    assert_eq!(
        first.assets.last().unwrap().eligibility,
        Eligibility::Unreviewed
    );
    assert!(first.assets.last().unwrap().chain.is_none());
}

#[tokio::test]
async fn wrong_network_and_individual_unsupported_mints_fail_closed() {
    let server = Server::start().await;
    *server.state.genesis.lock().unwrap() = "11111111111111111111111111111111".into();
    let wrong = server.catalog().observe().await;
    assert_eq!(wrong.chain_source.error.as_deref(), Some("wrong_network"));
    assert!(wrong
        .assets
        .iter()
        .all(|asset| asset.eligibility == Eligibility::Unavailable));
    *server.state.genesis.lock().unwrap() = volaryn_backend::assets::MAINNET_GENESIS.into();
    server.state.accounts.lock().unwrap()["result"]["value"][0]["owner"] =
        serde_json::json!(anchor_spl::token::ID.to_string());
    let mixed = server.catalog().observe().await;
    assert_eq!(mixed.assets[0].eligibility, Eligibility::Unsupported);
    assert_eq!(mixed.assets[1].eligibility, Eligibility::Compatible);
}

#[tokio::test]
async fn provider_outage_retains_labelled_context_and_recovers_without_network_coupling() {
    let server = Server::start().await;
    let catalog = server.catalog();
    let original = catalog.observe().await;
    let price = original.assets[0]
        .market
        .as_ref()
        .unwrap()
        .token_price
        .clone();
    server.state.status.store(429, Ordering::SeqCst);
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::time::resume();
    let stale = catalog.observe().await;
    assert!(matches!(stale.market_source.status, SourceStatus::Stale));
    assert_eq!(stale.market_source.error.as_deref(), Some("rate_limited"));
    assert_eq!(stale.assets[0].market.as_ref().unwrap().token_price, price);
    assert_eq!(stale.assets[0].eligibility, Eligibility::Stale);
    assert!(matches!(stale.chain_source.status, SourceStatus::Fresh));
    assert_eq!(server.state.calls.load(Ordering::SeqCst), 2);
    server.state.status.store(200, Ordering::SeqCst);
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::time::resume();
    assert_eq!(
        catalog.observe().await.assets[0].eligibility,
        Eligibility::Compatible
    );
}

#[tokio::test]
async fn unavailable_and_malformed_sources_do_not_invent_market_values() {
    let server = Server::start().await;
    server.state.status.store(429, Ordering::SeqCst);
    let unavailable = server.catalog().observe().await;
    assert!(matches!(
        unavailable.market_source.status,
        SourceStatus::Unavailable
    ));
    assert!(unavailable.assets[0].market.is_none());
    assert!(unavailable.assets[0].chain.is_some());
    server.state.status.store(200, Ordering::SeqCst);
    *server.state.api.lock().unwrap() = serde_json::json!({"data":[]});
    let changed = server.catalog().observe().await;
    assert_eq!(
        changed.market_source.error.as_deref(),
        Some("invalid_response")
    );
    assert!(changed.assets.iter().all(|asset| asset.market.is_none()));
}

#[tokio::test]
async fn source_transport_bounds_retries_response_size_and_time() {
    let server = Server::start().await;
    let http = SourceHttp::new().unwrap();
    server.state.status.store(503, Ordering::SeqCst);
    assert_eq!(
        http.json(&server.url, None).await.unwrap_err(),
        "unavailable"
    );
    assert_eq!(server.state.calls.load(Ordering::SeqCst), 2);
    server.state.status.store(429, Ordering::SeqCst);
    assert_eq!(
        http.json(&server.url, None).await.unwrap_err(),
        "rate_limited"
    );
    assert_eq!(server.state.calls.load(Ordering::SeqCst), 3);
    server.state.status.store(200, Ordering::SeqCst);
    *server.state.api.lock().unwrap() = serde_json::json!("x".repeat(2 * 1024 * 1024));
    assert_eq!(
        http.json(&server.url, None).await.unwrap_err(),
        "invalid_response"
    );
    server.state.status.store(408, Ordering::SeqCst);
    let start = std::time::Instant::now();
    assert_eq!(http.json(&server.url, None).await.unwrap_err(), "timeout");
    assert!(start.elapsed() < Duration::from_secs(8));
}
