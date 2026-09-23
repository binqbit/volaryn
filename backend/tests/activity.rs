#[path = "support/database.rs"]
mod database;
#[path = "support/activity.rs"]
mod fixtures;
mod support;

use anchor_lang::prelude::Pubkey;
use axum::{body::Body, extract::State, http::Request, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use fixtures::SignedAction;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tower::ServiceExt;
use volaryn_backend::{
    activity::{ActivityQuery, Status},
    adapters::{activity as receipts, chain::Chain, store},
    application::Application,
    http,
};

struct Network {
    pool: sqlx::PgPool,
    height: AtomicU64,
    sent: AtomicU64,
    statuses: Mutex<BTreeMap<String, Value>>,
}
async fn upstream(State(state): State<Arc<Network>>, Json(request): Json<Value>) -> Json<Value> {
    let result = match request["method"].as_str().unwrap() {
        "getGenesisHash" => json!("11111111111111111111111111111111"),
        "getAccountInfo" if request["params"][0] == volaryn::ID.to_string() => {
            json!({"value":{"owner":"BPFLoaderUpgradeab1e11111111111111111111111", "executable":true}})
        }
        "getAccountInfo" => {
            let loader = anchor_lang::solana_program::bpf_loader_upgradeable::ID;
            let data = Pubkey::find_program_address(&[volaryn::ID.as_ref()], &loader).0;
            if request["params"][0] == data.to_string() {
                let mut bytes = vec![0; 45];
                bytes.push(7);
                json!({"value":{"owner":loader.to_string(),"data":[STANDARD.encode(bytes),"base64"]}})
            } else {
                json!({"context":{"slot":1000},"value":null})
            }
        }
        "isBlockhashValid" => json!({"context":{"slot":10},"value":true}),
        "getLatestBlockhash" => json!({"value":{"lastValidBlockHeight":200}}),
        "getEpochInfo" => {
            json!({"blockHeight":state.height.load(Ordering::Relaxed),"absoluteSlot":500})
        }
        "getSignatureStatuses" => {
            let statuses = state.statuses.lock().unwrap();
            json!({"value":request["params"][0].as_array().unwrap().iter().map(|signature| statuses.get(signature.as_str().unwrap()).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()})
        }
        "sendTransaction" => {
            let bytes = STANDARD
                .decode(request["params"][0].as_str().unwrap())
                .unwrap();
            let transaction: solana_transaction::Transaction =
                bincode::deserialize(&bytes).unwrap();
            let signature = transaction.signatures[0].to_string();
            assert!(
                receipts::find(&state.pool, &signature)
                    .await
                    .unwrap()
                    .is_some(),
                "receipt must be durable before broadcast"
            );
            state.sent.fetch_add(1, Ordering::Relaxed);
            json!(signature)
        }
        method => panic!("Unexpected RPC: {method}"),
    };
    Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
}

#[tokio::test]
async fn authenticated_receipts_survive_relay_duplicates_and_reconcile_without_a_browser() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let network = Arc::new(Network {
        pool: pool.clone(),
        height: AtomicU64::new(10),
        sent: AtomicU64::new(0),
        statuses: Mutex::default(),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/", post(upstream))
                .with_state(network.clone()),
        )
        .into_future(),
    );
    let app = Application::new(
        deployment,
        Chain::new(url.clone()).unwrap(),
        pool.clone(),
        volaryn_backend::catalog::Catalog::new(url).unwrap(),
    );
    let directory = tempfile::tempdir().unwrap();
    let router = http::router(app.clone(), directory.path().to_owned());
    let action = SignedAction::create(1);
    let submit = |params| {
        Request::post("/rpc")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"jsonrpc":"2.0","id":1,"method":"sendTransaction","params":params})
                    .to_string(),
            ))
            .unwrap()
    };
    for _ in 0..2 {
        let response = router
            .clone()
            .oneshot(submit(action.params()))
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
    }
    let page = app
        .activity(&ActivityQuery {
            owner: action.owner.clone(),
            before: None,
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.pending.len(), 1);
    assert_eq!(page.items[0].agreement, action.agreement.to_string());
    assert_eq!(page.items[0].created_terms.as_ref().unwrap().nonce, "1");
    assert_eq!(page.items[0].last_valid_block_height, "200");

    // Forged or stripped signatures never create someone else's activity or reach the relay.
    let mut forged = SignedAction::create(2);
    forged.transaction.signatures[0] = Default::default();
    assert_eq!(
        router
            .clone()
            .oneshot(submit(forged.params()))
            .await
            .unwrap()
            .status(),
        400
    );
    forged.transaction.signatures.clear();
    forged.transaction.message.header.num_required_signatures = 0;
    assert_eq!(
        router
            .clone()
            .oneshot(submit(forged.params()))
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(network.sent.load(Ordering::Relaxed), 2);

    let mut wrong_actor = SignedAction::create(2);
    wrong_actor.transaction.message.instructions[0].accounts[0] = 2;
    wrong_actor.resign();
    assert!(app.record_submission(&wrong_actor.params()).await.is_err());
    let mut wrong_agreement = SignedAction::create(2);
    wrong_agreement.transaction.message.instructions[0].accounts[6] = 2;
    wrong_agreement.resign();
    assert!(app
        .record_submission(&wrong_agreement.params())
        .await
        .is_err());

    network.statuses.lock().unwrap().insert(
        action.signature(),
        json!({"confirmationStatus":"confirmed","err":null}),
    );
    app.reconcile_activity().await.unwrap();
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Provisional
    );
    network.statuses.lock().unwrap().insert(
        action.signature(),
        json!({"confirmationStatus":"finalized","err":null}),
    );
    app.reconcile_activity().await.unwrap();
    let finalized = receipts::find(&pool, &action.signature())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(finalized.status, Status::Finalized);
    receipts::update(&pool, &action.signature(), Status::Pending)
        .await
        .unwrap();
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Finalized
    );

    let failed = SignedAction::create(3);
    app.record_submission(&failed.params()).await.unwrap();
    network.statuses.lock().unwrap().insert(
        failed.signature(),
        json!({"confirmationStatus":"finalized","err":{"InstructionError":[0,"Custom"]}}),
    );
    app.reconcile_activity().await.unwrap();
    assert_eq!(
        receipts::find(&pool, &failed.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Failed
    );

    // Missing history before expiry is pending, and after expiry needs agreement-state proof.
    let expired = SignedAction::create(4);
    app.record_submission(&expired.params()).await.unwrap();
    app.reconcile_activity().await.unwrap();
    assert_eq!(
        receipts::find(&pool, &expired.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Pending
    );
    network.height.store(201, Ordering::Relaxed);
    app.reconcile_activity().await.unwrap();
    assert_eq!(
        receipts::find(&pool, &expired.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Expired
    );

    let response = router
        .oneshot(
            Request::get(format!("/api/activity?owner={}", action.owner))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["items"].as_array().unwrap().len(), 3);
    assert!(body["pending"].as_array().unwrap().is_empty());
    assert!(app
        .activity(&ActivityQuery {
            owner: Pubkey::new_unique().to_string(),
            before: None
        })
        .await
        .unwrap()
        .items
        .is_empty());
    assert!(app
        .activity(&ActivityQuery {
            owner: action.owner.clone(),
            before: Some("bad".into())
        })
        .await
        .is_err());

    // Losing PostgreSQL prevents forwarding an unrecorded signed operation.
    pool.close().await;
    assert!(app
        .record_submission(&SignedAction::create(5).params())
        .await
        .is_err());
    assert_eq!(network.sent.load(Ordering::Relaxed), 2);
    server.abort();
    database.close().await;
}

use std::future::IntoFuture;

#[tokio::test]
async fn history_pagination_keeps_old_pending_receipts_recoverable() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let first = SignedAction::create(100);
    let mut receipt = volaryn_backend::activity::Activity {
        id: String::new(),
        signature: first.signature(),
        owner: first.owner.clone(),
        agreement: first.agreement.to_string(),
        operation: volaryn_backend::activity::Operation::Create,
        created_terms: None,
        last_valid_block_height: u64::MAX.to_string(),
        status: Status::Pending,
        created_at: 1,
        updated_at: 1,
    };
    receipts::insert(&pool, &receipt).await.unwrap();
    for nonce in 101..155 {
        receipt.signature = SignedAction::create(nonce).signature();
        receipts::insert(&pool, &receipt).await.unwrap();
        receipts::update(&pool, &receipt.signature, Status::Finalized)
            .await
            .unwrap();
    }
    let page = receipts::page(&pool, &first.owner, None).await.unwrap();
    assert_eq!(page.items.len(), 50);
    assert_eq!(page.pending.len(), 1);
    assert_eq!(page.pending[0].signature, first.signature());
    let older = receipts::page(
        &pool,
        &first.owner,
        Some(page.next.unwrap().parse().unwrap()),
    )
    .await
    .unwrap();
    assert_eq!(older.items.len(), 5);
    assert!(older.next.is_none());
    assert!(older
        .items
        .iter()
        .all(|old| page.items.iter().all(|new| old.signature != new.signature)));
    assert_eq!(older.pending[0].signature, first.signature());
    pool.close().await;
    database.close().await;
}
