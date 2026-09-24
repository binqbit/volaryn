#[path = "support/agreement.rs"]
mod agreement;
#[path = "support/chain.rs"]
mod chain;
#[path = "support/database.rs"]
mod database;
mod support;

use anchor_lang::prelude::Pubkey;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use std::sync::atomic::Ordering;
use tower::ServiceExt;
use volaryn_backend::{
    adapters::{chain::Chain, store},
    application::Application,
    catalog::Catalog,
    http::router,
    queries::{AgreementLifecycle, AgreementQuery},
};

#[tokio::test]
async fn owner_union_and_lifecycle_filters_apply_before_pagination() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let owner = Pubkey::new_unique().to_string();
    let other = Pubkey::new_unique().to_string();
    let mut rows: Vec<_> = (0..9)
        .map(|index| {
            let mut row = agreement::agreement(10, 100);
            row.address = Pubkey::new_unique().to_string();
            row.writer = if index % 2 == 0 {
                owner.clone()
            } else {
                other.clone()
            };
            row.holder = if index % 2 == 1 {
                Some(owner.clone())
            } else {
                None
            };
            row.accept_before = "100".into();
            row.expires_at = "200".into();
            row.status = match index {
                0 | 1 => "funded",
                2 | 3 | 7 | 8 => "active",
                4 => "exercised",
                5 => "cancelled",
                _ => "expired",
            }
            .into();
            row
        })
        .collect();
    rows[0].accept_before = "101".into();
    rows[2].expires_at = "100".into();
    // A match on both sides must still produce exactly one row.
    rows[3].writer = owner.clone();
    // Neither designation nor an unrelated agreement is ownership.
    rows[7].holder = None;
    rows[7].designated_holder = Some(owner.clone());
    rows[8].writer = other;
    store::upsert(&pool, &rows, 10, 100).await.unwrap();
    let mut query = AgreementQuery {
        owner: Some(owner.clone()),
        limit: Some(1),
        ..Default::default()
    };
    let mut found = Vec::new();
    loop {
        let page = store::agreements(&pool, &query, false, None).await.unwrap();
        found.extend(page.items.into_iter().map(|row| row.address));
        query.after = page.next;
        if query.after.is_none() {
            break;
        }
    }
    let mut expected: Vec<_> = rows[..7].iter().map(|row| row.address.clone()).collect();
    expected.sort();
    assert_eq!(
        found, expected,
        "All combines both roles once and excludes designated-only records"
    );
    for (lifecycle, indices) in [
        (AgreementLifecycle::Available, vec![0]),
        (AgreementLifecycle::AcceptanceEnded, vec![1]),
        (AgreementLifecycle::Active, vec![3]),
        (AgreementLifecycle::Exercised, vec![4]),
        (AgreementLifecycle::Cancelled, vec![5]),
        (AgreementLifecycle::Expired, vec![2, 6]),
    ] {
        let mut query = AgreementQuery {
            owner: Some(owner.clone()),
            lifecycle: Some(lifecycle),
            limit: Some(1),
            ..Default::default()
        };
        let mut found = Vec::new();
        loop {
            let page = store::agreements(&pool, &query, false, Some(100))
                .await
                .unwrap();
            found.extend(page.items.into_iter().map(|row| row.address));
            query.after = page.next;
            if query.after.is_none() {
                break;
            }
        }
        let mut expected: Vec<_> = indices
            .iter()
            .map(|index| rows[*index].address.clone())
            .collect();
        expected.sort();
        assert_eq!(
            found, expected,
            "Lifecycle selection uses chain time at exact deadline boundaries"
        );
    }
    let page = store::agreements(
        &pool,
        &AgreementQuery {
            owner: Some(owner.clone()),
            holder: Some(owner.clone()),
            lifecycle: Some(AgreementLifecycle::Expired),
            ..Default::default()
        },
        false,
        Some(100),
    )
    .await
    .unwrap();
    assert!(
        page.items.is_empty(),
        "Role and lifecycle filters intersect"
    );
    let raw = store::agreements(
        &pool,
        &AgreementQuery {
            owner: Some(owner),
            status: Some("active".into()),
            ..Default::default()
        },
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        raw.items.len(),
        2,
        "Raw contract status remains backward compatible"
    );
    assert!(
        store::agreements(
            &pool,
            &AgreementQuery {
                lifecycle: Some(AgreementLifecycle::Active),
                ..Default::default()
            },
            false,
            None
        )
        .await
        .is_err(),
        "Never substitute the host clock when chain time is unavailable"
    );
    // Discovery metadata is independent of whichever portfolio cursor/status is selected.
    let unindexed = Pubkey::new_unique().to_string();
    for (index, address) in [&rows[0].address, &unindexed].iter().enumerate() {
        let receipt = volaryn_backend::activity::Activity {
            id: String::new(),
            signature: format!("receipt-{index}"),
            owner: rows[0].writer.clone(),
            agreement: (*address).clone(),
            operation: volaryn_backend::activity::Operation::Create,
            created_terms: None,
            last_valid_block_height: "200".into(),
            status: volaryn_backend::activity::Status::Pending,
            created_at: 100,
            updated_at: 100,
        };
        volaryn_backend::adapters::activity::insert(&pool, &receipt)
            .await
            .unwrap();
        volaryn_backend::adapters::activity::update(
            &pool,
            &receipt.signature,
            volaryn_backend::activity::Status::Finalized,
        )
        .await
        .unwrap();
    }
    let activity = volaryn_backend::adapters::activity::page(&pool, &rows[0].writer, None)
        .await
        .unwrap();
    assert_eq!(activity.items.len(), 2);
    assert_eq!(activity.indexed_agreements, vec![rows[0].address.clone()]);
    let activation = volaryn_backend::activity::Activity {
        id: String::new(),
        signature: "activation".into(),
        owner: rows[0].writer.clone(),
        agreement: rows[8].address.clone(),
        operation: volaryn_backend::activity::Operation::Activate,
        created_terms: None,
        last_valid_block_height: "200".into(),
        status: volaryn_backend::activity::Status::Pending,
        created_at: 100,
        updated_at: 100,
    };
    volaryn_backend::adapters::activity::insert(&pool, &activation)
        .await
        .unwrap();
    volaryn_backend::adapters::activity::update(
        &pool,
        &activation.signature,
        volaryn_backend::activity::Status::Finalized,
    )
    .await
    .unwrap();
    let before = volaryn_backend::adapters::activity::page(&pool, &rows[0].writer, None)
        .await
        .unwrap();
    assert!(
        !before.indexed_agreements.contains(&activation.agreement),
        "An existing record without this holder does not complete activation discovery"
    );
    let mut activated = rows[8].clone();
    activated.holder = Some(rows[0].writer.clone());
    activated.finalized_slot = "11".into();
    store::upsert(&pool, &[activated], 11, 101).await.unwrap();
    let after = volaryn_backend::adapters::activity::page(&pool, &rows[0].writer, None)
        .await
        .unwrap();
    assert!(after.indexed_agreements.contains(&activation.agreement));
    pool.close().await;
    database.close().await;
}

#[tokio::test]
async fn portfolio_http_validates_filters_and_observes_chain_deadlines() {
    let ledger = chain::Ledger::new(2);
    let (endpoint, server) = ledger.serve().await;
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let app = Application::new(
        support::deployment(),
        Chain::new(endpoint.clone()).unwrap(),
        pool,
        Catalog::new(endpoint).unwrap(),
    );
    app.reconcile().await.unwrap();
    let rows = store::agreements(&app.pool, &Default::default(), false, None)
        .await
        .unwrap();
    let owner = &rows.items[0].writer;
    let service = router(
        app.clone(),
        std::path::PathBuf::from("missing-test-frontend"),
    );
    for (query, count) in [
        (format!("owner={owner}"), 2),
        (format!("owner={owner}&lifecycle=active"), 1),
        (format!("owner={owner}&lifecycle=expired"), 0),
    ] {
        let response = service
            .clone()
            .oneshot(
                Request::get(format!("/api/agreements?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body: Vec<serde_json::Value> =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body.len(), count);
    }
    ledger.time.store(1800000010, Ordering::Relaxed);
    let response = service
        .clone()
        .oneshot(
            Request::get(format!("/api/agreements?owner={owner}&lifecycle=expired"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: Vec<serde_json::Value> =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body.len(), 1);
    assert_eq!(
        body[0]["status"], "active",
        "Filtering does not rewrite on-chain state"
    );
    for query in ["owner=invalid", "lifecycle=unknown", "status=unknown"] {
        let response = service
            .clone()
            .oneshot(
                Request::get(format!("/api/agreements?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{query}");
    }
    ledger.time.store(0, Ordering::Relaxed);
    for lifecycle in ["exercised", "cancelled"] {
        let response = service
            .clone()
            .oneshot(
                Request::get(format!("/api/agreements?lifecycle={lifecycle}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            200,
            "Terminal status does not require an available clock"
        );
    }

    let response = service
        .oneshot(
            Request::get("/api/agreements?lifecycle=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        503,
        "Unknown chain time is not an empty successful portfolio"
    );
    app.pool.close().await;
    database.close().await;
    server.abort();
}
