#[path = "support/chain.rs"]
mod chain;
#[path = "support/database.rs"]
mod database;
mod support;

use std::sync::{atomic::Ordering, Arc};
use volaryn_backend::{
    adapters::{chain::Chain, store},
    application::Application,
    domain::AppError,
};

#[tokio::test]
async fn discovery_batches_pairs_and_refreshes_only_live_agreements() {
    let ledger = chain::Ledger::new(1001);
    let (url, server) = ledger.serve().await;
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let app = Application::new(
        deployment,
        Chain::new(url.clone()).unwrap(),
        pool,
        volaryn_backend::catalog::Catalog::new(url).unwrap(),
    );
    app.reconcile().await.unwrap();
    assert_eq!(ledger.discoveries.load(Ordering::Relaxed), 1);
    assert_eq!(ledger.batches.load(Ordering::Relaxed), 21);
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM agreements")
        .fetch_one(&app.pool)
        .await
        .unwrap();
    assert_eq!(count, 1001);
    for (index, address) in ledger.addresses.iter().enumerate() {
        let value = store::agreement(&app.pool, address).await.unwrap().unwrap();
        assert_eq!(
            value.finalized_slot, "11",
            "Do not label newer account pairs with discovery slot 10"
        );
        assert_eq!(value.reserve_amount, if index == 0 { "20" } else { "0" });
        assert_eq!(
            value.status,
            if index == 0 { "active" } else { "exercised" }
        );
    }
    app.reconcile().await.unwrap();
    assert_eq!(ledger.discoveries.load(Ordering::Relaxed), 1);
    assert_eq!(ledger.batches.load(Ordering::Relaxed), 22);
    let directory = tempfile::tempdir().unwrap();
    let router = volaryn_backend::http::router(Arc::clone(&app), directory.path().to_owned());
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let response = router
        .clone()
        .oneshot(
            Request::get("/api/agreements?limit=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key("x-next-cursor"));
    let body: Vec<serde_json::Value> =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body.len(), 10);
    let response = router
        .oneshot(
            Request::get("/api/agreements?limit=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    app.pool.close().await;
    let value = app.agreement(&ledger.addresses[0]).await.unwrap();
    assert_eq!(
        value.status, "active",
        "Direct chain detail must survive a closed database pool"
    );
    database.close().await;
    server.abort();
}

#[tokio::test]
async fn account_pair_reads_reject_older_contexts_missing_accounts_and_wrong_owners() {
    let mut ledger = chain::Ledger::new(1);
    let key = ledger.addresses[0].clone();
    let (url, server) = ledger.serve().await;
    let rpc = Chain::new(url).unwrap();
    let deployment = support::deployment();
    assert!(matches!(
        rpc.agreement_batch(&deployment, std::slice::from_ref(&key), 12)
            .await,
        Err(AppError::Chain)
    ));
    assert!(matches!(
        rpc.agreement_batch(
            &deployment,
            std::slice::from_ref(&deployment.localnet.as_ref().unwrap().holder),
            0
        )
        .await,
        Err(AppError::NotFound)
    ));
    server.abort();
    // Release the server's Arc before modifying this fixture.
    let _ = server.await;
    Arc::get_mut(&mut ledger)
        .unwrap()
        .accounts
        .get_mut(&key)
        .unwrap()["owner"] = serde_json::json!(deployment.localnet.as_ref().unwrap().holder);
    let (url, server) = ledger.serve().await;
    let rpc = Chain::new(url).unwrap();
    assert!(matches!(
        rpc.agreement_batch(&deployment, &[key], 0).await,
        Err(AppError::Identity)
    ));
    server.abort();
}

#[tokio::test]
async fn holder_origin_projection_keeps_creator_identity_and_rejects_impossible_roles() {
    use anchor_lang::{AccountDeserialize, AccountSerialize};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use volaryn::state::{Agreement, AgreementStatus, OfferSide};
    for case in 0..6 {
        let mut ledger = chain::Ledger::new(1);
        let address = ledger.addresses[0].clone();
        let account = Arc::get_mut(&mut ledger)
            .unwrap()
            .accounts
            .get_mut(&address)
            .unwrap();
        let bytes = STANDARD
            .decode(account["data"][0].as_str().unwrap())
            .unwrap();
        let mut agreement = Agreement::try_deserialize(&mut bytes.as_slice()).unwrap();
        let accepting_writer = agreement.holder.unwrap();
        agreement.side = OfferSide::Holder;
        agreement.holder = Some(agreement.creator);
        agreement.writer = None;
        agreement.activated_at = None;
        agreement.status = AgreementStatus::Open;
        match case {
            1 => {
                agreement.writer = Some(accepting_writer);
                agreement.activated_at = Some(2);
                agreement.status = AgreementStatus::Active;
            }
            2 => agreement.version = 1,
            3 => agreement.holder = Some(accepting_writer),
            4 => agreement.writer = Some(agreement.creator),
            5 => {
                agreement.status = AgreementStatus::Active;
                agreement.activated_at = Some(2);
            }
            _ => {}
        }
        let mut bytes = Vec::new();
        agreement.try_serialize(&mut bytes).unwrap();
        account["data"][0] = serde_json::json!(STANDARD.encode(bytes));
        let (endpoint, server) = ledger.serve().await;
        let rpc = Chain::new(endpoint).unwrap();
        let result = rpc
            .agreement_batch(&support::deployment(), std::slice::from_ref(&address), 0)
            .await;
        if case < 2 {
            let (_, views) = result.unwrap();
            assert_eq!(views[0].address, address);
            assert_eq!(views[0].creator, agreement.creator.to_string());
            assert_eq!(
                views[0].side,
                volaryn_backend::observations::OfferSide::Holder
            );
            assert_eq!(views[0].writer, agreement.writer.map(|key| key.to_string()));
            assert_eq!(views[0].holder, Some(agreement.creator.to_string()));
        } else {
            assert!(
                matches!(result, Err(AppError::Identity)),
                "Invalid role case {case}"
            );
        }
        server.abort();
    }
}
