#[path = "support/database.rs"]
mod database;
#[path = "support/activity.rs"]
mod fixtures;
mod support;

use anchor_lang::{prelude::Pubkey, InstructionData};
use axum::{body::Body, extract::State, http::Request, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use fixtures::SignedAction;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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
    account_slot: AtomicU64,
    discoveries: AtomicU64,
    sent: AtomicU64,
    reject_submissions: AtomicBool,
    simulated: AtomicU64,
    simulation: Mutex<Option<Value>>,
    pause_simulation: AtomicBool,
    simulation_started: tokio::sync::Notify,
    resume_simulation: tokio::sync::Notify,
    statuses: Mutex<BTreeMap<String, Value>>,
    accounts: Mutex<BTreeMap<String, Value>>,
}
async fn upstream(State(state): State<Arc<Network>>, Json(request): Json<Value>) -> Json<Value> {
    let result = match request["method"].as_str().unwrap() {
        "getGenesisHash" => json!("11111111111111111111111111111111"),
        "getMultipleAccounts"
            if support::identity::response(&request, &support::deployment()).is_some() =>
        {
            support::identity::response(&request, &support::deployment()).unwrap()
        }
        "getAccountInfo" => {
            json!({"context":{"slot":1000},"value":state.accounts.lock().unwrap().get(request["params"][0].as_str().unwrap()).cloned().unwrap_or(Value::Null)})
        }
        "getMultipleAccounts" => {
            let accounts = state.accounts.lock().unwrap();
            assert_eq!(request["params"][1]["commitment"], "finalized");
            json!({"context":{"slot":state.account_slot.load(Ordering::Relaxed)},"value":request["params"][0].as_array().unwrap().iter().map(|key| accounts.get(key.as_str().unwrap()).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()})
        }
        "getProgramAccounts" => {
            state.discoveries.fetch_add(1, Ordering::Relaxed);
            json!({"context":{"slot":10},"value":[]})
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
        "simulateTransaction" => {
            assert_eq!(request["params"][1]["encoding"], "base64");
            assert_eq!(request["params"][1]["commitment"], "confirmed");
            assert_eq!(request["params"][1]["sigVerify"], true);
            assert_eq!(request["params"][1]["replaceRecentBlockhash"], false);
            assert_eq!(request["params"][1]["minContextSlot"], 10);
            let bytes = STANDARD
                .decode(request["params"][0].as_str().unwrap())
                .unwrap();
            let transaction: solana_transaction::Transaction =
                bincode::deserialize(&bytes).unwrap();
            transaction.verify().unwrap();
            state.simulated.fetch_add(1, Ordering::Relaxed);
            if state.pause_simulation.load(Ordering::Relaxed) {
                state.simulation_started.notify_one();
                state.resume_simulation.notified().await;
            }
            let Some(result) = state.simulation.lock().unwrap().clone() else {
                return Json(json!({"jsonrpc":"2.0", "id":request["id"], "error": {
                    "code": -32005, "message": "Node is unavailable"
                }}));
            };
            result
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
            if state.reject_submissions.load(Ordering::Relaxed) {
                return Json(json!({"jsonrpc":"2.0", "id":request["id"], "error": {
                    "code": -32002, "message": "Transaction simulation failed: account not found"
                }}));
            }
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
        account_slot: AtomicU64::new(1000),
        discoveries: AtomicU64::new(0),
        sent: AtomicU64::new(0),
        reject_submissions: AtomicBool::new(false),
        simulated: AtomicU64::new(0),
        simulation: Mutex::new(Some(json!({"context":{"slot":10},"value":{"err":null}}))),
        pause_simulation: AtomicBool::new(false),
        simulation_started: tokio::sync::Notify::new(),
        resume_simulation: tokio::sync::Notify::new(),
        statuses: Mutex::default(),
        accounts: Mutex::default(),
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
        volaryn_backend::catalog::Catalog::new(url.clone()).unwrap(),
        Default::default(),
    );
    app.reconcile().await.unwrap();
    assert_eq!(network.discoveries.load(Ordering::Relaxed), 1);
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
    assert_eq!(
        network.simulated.load(Ordering::Relaxed),
        1,
        "A saved signature does not need another simulation"
    );
    *network.simulation.lock().unwrap() = None;
    app.record_submission(&action.params()).await.unwrap();
    assert_eq!(network.simulated.load(Ordering::Relaxed), 1);
    *network.simulation.lock().unwrap() = Some(json!({"context":{"slot":10},"value":{"err":null}}));
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
        json!({"confirmationStatus":"finalized","slot":1001,"err":null}),
    );
    *network.accounts.lock().unwrap() = fixtures::accounts(&action.state(), 20);
    assert!(store::agreement(&pool, &action.agreement.to_string())
        .await
        .unwrap()
        .is_none());
    // A pair observed behind the finalized signature cannot publish an older state,
    // and a failed refresh must not discard the durable receipt's retry opportunity.
    sqlx::query("UPDATE activity SET checked_at = 0 WHERE signature = $1")
        .bind(action.signature())
        .execute(&pool)
        .await
        .unwrap();
    assert!(app.reconcile_activity().await.is_err());
    let checked_at: i64 =
        sqlx::query_scalar("SELECT checked_at FROM activity WHERE signature = $1")
            .bind(action.signature())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        checked_at > 0,
        "Failed targeted refreshes rotate through the retry queue"
    );
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Provisional
    );
    network.account_slot.store(1001, Ordering::Relaxed);
    sqlx::query("ALTER TABLE agreements ADD CONSTRAINT test_refresh_failure CHECK (false)")
        .execute(&pool)
        .await
        .unwrap();
    assert!(app.reconcile_activity().await.is_err());
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Provisional
    );
    sqlx::query("ALTER TABLE agreements DROP CONSTRAINT test_refresh_failure")
        .execute(&pool)
        .await
        .unwrap();
    let recovered = Application::new(
        app.deployment.clone(),
        Chain::new(url.clone()).unwrap(),
        pool.clone(),
        volaryn_backend::catalog::Catalog::new(url.clone()).unwrap(),
        Default::default(),
    );
    recovered.reconcile_activity().await.unwrap();
    let indexed = store::agreement(&pool, &action.agreement.to_string())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(indexed.finalized_slot, "1001");
    assert_eq!(
        network.discoveries.load(Ordering::Relaxed),
        1,
        "Finalized receipts publish agreements without waiting for another discovery pass"
    );
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
async fn effect_recovery_indexes_at_or_after_the_observed_evidence_slot() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let action = SignedAction::create(5001);
    let network = Arc::new(Network {
        pool: pool.clone(),
        height: AtomicU64::new(10),
        account_slot: AtomicU64::new(999),
        discoveries: AtomicU64::new(0),
        sent: AtomicU64::new(0),
        reject_submissions: AtomicBool::new(false),
        simulated: AtomicU64::new(0),
        simulation: Mutex::new(Some(json!({"context":{"slot":10},"value":{"err":null}}))),
        pause_simulation: AtomicBool::new(false),
        simulation_started: tokio::sync::Notify::new(),
        resume_simulation: tokio::sync::Notify::new(),
        statuses: Mutex::default(),
        accounts: Mutex::new(fixtures::accounts(&action.state(), 20)),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
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
        Chain::new(endpoint.clone()).unwrap(),
        pool.clone(),
        volaryn_backend::catalog::Catalog::new(endpoint).unwrap(),
        Default::default(),
    );
    app.record_submission(&action.params()).await.unwrap();
    // History is absent beyond the lifetime. The root is 500, but the finalized
    // agreement proving creation is observed at 1000; pair 999 cannot publish it.
    network.height.store(201, Ordering::Relaxed);
    assert!(app.reconcile_activity().await.is_err());
    assert!(store::agreement(&pool, &action.agreement.to_string())
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Pending
    );
    network.account_slot.store(1000, Ordering::Relaxed);
    app.reconcile_activity().await.unwrap();
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Reconciled
    );
    assert_eq!(
        store::agreement(&pool, &action.agreement.to_string())
            .await
            .unwrap()
            .unwrap()
            .finalized_slot,
        "1000"
    );
    app.pool.close().await;
    database.close().await;
    server.abort();
}

#[tokio::test]
async fn both_origins_persist_verified_side_and_actor_role_for_every_operation() {
    use volaryn::state::{AgreementStatus, OfferSide as ChainSide};
    use volaryn_backend::{activity::Operation, observations::OfferSide};
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let network = Arc::new(Network {
        pool: pool.clone(),
        height: AtomicU64::new(10),
        account_slot: AtomicU64::new(1000),
        discoveries: AtomicU64::new(0),
        sent: AtomicU64::new(0),
        reject_submissions: AtomicBool::new(false),
        simulated: AtomicU64::new(0),
        simulation: Mutex::new(Some(json!({"context":{"slot":10},"value":{"err":null}}))),
        pause_simulation: AtomicBool::new(false),
        simulation_started: tokio::sync::Notify::new(),
        resume_simulation: tokio::sync::Notify::new(),
        statuses: Mutex::default(),
        accounts: Mutex::default(),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
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
        Chain::new(endpoint.clone()).unwrap(),
        pool.clone(),
        volaryn_backend::catalog::Catalog::new(endpoint).unwrap(),
        Default::default(),
    );
    for (side_index, side) in [ChainSide::Writer, ChainSide::Holder]
        .into_iter()
        .enumerate()
    {
        for (index, (operation, status)) in [
            (Operation::Cancel, AgreementStatus::Open),
            (Operation::Activate, AgreementStatus::Open),
            (Operation::Exercise, AgreementStatus::Active),
            (Operation::Reclaim, AgreementStatus::Active),
            (Operation::Cleanup, AgreementStatus::Cancelled),
            (Operation::Cleanup, AgreementStatus::Exercised),
        ]
        .into_iter()
        .enumerate()
        {
            let origin = SignedAction::create_side(2000 + (side_index * 10 + index) as u64, side);
            app.record_submission(&origin.params()).await.unwrap();
            let created = receipts::find(&pool, &origin.signature())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(created.side, OfferSide::from(side));
            assert_eq!(created.actor_role, OfferSide::from(side));
            assert_eq!(
                created.created_terms.as_ref().unwrap().side,
                OfferSide::from(side)
            );
            let mut state = origin.state();
            let counterpart = origin.operation(volaryn::instruction::Activate {}.data(), 8);
            if matches!(status, AgreementStatus::Active | AgreementStatus::Exercised) {
                match side {
                    ChainSide::Writer => state.holder = Some(counterpart.owner.parse().unwrap()),
                    ChainSide::Holder => state.writer = Some(counterpart.owner.parse().unwrap()),
                }
                state.activated_at = Some(2);
            }
            state.status = status;
            network
                .accounts
                .lock()
                .unwrap()
                .extend(fixtures::accounts(&state, 20));
            let role = match operation {
                Operation::Activate => OfferSide::from(side).counterparty(),
                Operation::Cancel => OfferSide::from(side),
                Operation::Exercise => OfferSide::Holder,
                Operation::Reclaim => OfferSide::Writer,
                Operation::Cleanup if status == AgreementStatus::Cancelled => OfferSide::from(side),
                Operation::Cleanup => OfferSide::Writer,
                Operation::Create => unreachable!(),
            };
            let data = match operation {
                Operation::Activate if side == ChainSide::Holder => {
                    volaryn::instruction::AcceptRequest {}.data()
                }
                Operation::Activate => volaryn::instruction::Activate {}.data(),
                Operation::Cancel => volaryn::instruction::CancelOffer {}.data(),
                Operation::Exercise => volaryn::instruction::Exercise {}.data(),
                Operation::Reclaim => volaryn::instruction::ReclaimExpired {}.data(),
                Operation::Cleanup => volaryn::instruction::CleanupTerminal {}.data(),
                Operation::Create => unreachable!(),
            };
            let actor_seed = if role == OfferSide::from(side) { 9 } else { 8 };
            let action = origin.operation(data.clone(), actor_seed);
            if operation != Operation::Activate {
                let wrong_actor = origin.operation(data, 7);
                assert!(app.record_submission(&wrong_actor.params()).await.is_err());
                assert!(receipts::find(&pool, &wrong_actor.signature())
                    .await
                    .unwrap()
                    .is_none());
            } else {
                let wrong_instruction = origin.operation(
                    if side == ChainSide::Holder {
                        volaryn::instruction::Activate {}.data()
                    } else {
                        volaryn::instruction::AcceptRequest {}.data()
                    },
                    8,
                );
                assert!(app
                    .record_submission(&wrong_instruction.params())
                    .await
                    .is_err());
                let self_acceptance = origin.operation(data, 9);
                assert!(app
                    .record_submission(&self_acceptance.params())
                    .await
                    .is_err());
            }
            app.record_submission(&action.params()).await.unwrap();
            let receipt = receipts::find(&pool, &action.signature())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(receipt.operation, operation);
            assert_eq!(receipt.side, OfferSide::from(side));
            assert_eq!(receipt.actor_role, role);
        }
    }
    app.pool.close().await;
    database.close().await;
    server.abort();
}

#[tokio::test]
async fn server_preflight_blocks_invalid_receipts_and_preserves_relay_ambiguity() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let network = Arc::new(Network {
        pool: pool.clone(),
        height: AtomicU64::new(10),
        account_slot: AtomicU64::new(1000),
        discoveries: AtomicU64::new(0),
        sent: AtomicU64::new(0),
        reject_submissions: AtomicBool::new(true),
        simulated: AtomicU64::new(0),
        simulation: Mutex::new(None),
        pause_simulation: AtomicBool::new(false),
        simulation_started: tokio::sync::Notify::new(),
        resume_simulation: tokio::sync::Notify::new(),
        statuses: Mutex::default(),
        accounts: Mutex::default(),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
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
        Chain::new(endpoint.clone()).unwrap(),
        pool.clone(),
        volaryn_backend::catalog::Catalog::new(endpoint).unwrap(),
        Default::default(),
    );
    let mut action = SignedAction::create(901);
    action.transaction.message.instructions[0].data = volaryn::instruction::CancelOffer {}.data();
    action.transaction.message.instructions[0].accounts = vec![0, 1, 2, 2, 2, 2];
    action.resign();
    network
        .accounts
        .lock()
        .unwrap()
        .extend(fixtures::accounts(&action.state(), 20));
    let router = http::router(app.clone(), "missing-test-frontend".into());
    let request = || {
        let mut params = action.params();
        params[1] = json!({"encoding":"base64", "skipPreflight":false,
            "preflightCommitment":"confirmed", "maxRetries":0, "minContextSlot":10});
        Request::post("/rpc")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"jsonrpc":"2.0", "id":1, "method":"sendTransaction", "params":params})
                    .to_string(),
            ))
            .unwrap()
    };
    *network.simulation.lock().unwrap() = Some(json!({"context":{"slot":10},"value":{"err":null}}));
    for config in [
        json!({"encoding":"base64", "skipPreflight":"invalid"}),
        json!({"encoding":"base64", "maxRetries":-1}),
        json!({"encoding":"base64", "minContextSlot":"10"}),
        json!({"encoding":"base64", "preflightCommitment":"invalid"}),
        Value::Null,
    ] {
        let mut params = action.params();
        if config.is_null() {
            params
                .as_array_mut()
                .unwrap()
                .push(json!("unexpected third argument"));
        } else {
            params[1] = config;
        }
        let response = router
            .clone()
            .oneshot(
                Request::post("/rpc")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"jsonrpc":"2.0", "id":1,
                    "method":"sendTransaction", "params":params})
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            400,
            "Malformed send options must be rejected before recording or relaying"
        );
        assert!(receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .is_none());
        assert_eq!(network.sent.load(Ordering::Relaxed), 0);
        assert_eq!(network.simulated.load(Ordering::Relaxed), 0);
    }
    for (simulation, status) in [
        (
            Some(json!({"context":{"slot":10},"value":{"err":"AccountNotFound"}})),
            400,
        ),
        (None, 503),
        (
            Some(json!({"context":{"slot":9},"value":{"err":null}})),
            503,
        ),
        (Some(json!({"context":{"slot":10},"value":{}})), 503),
    ] {
        *network.simulation.lock().unwrap() = simulation;
        let response = router.clone().oneshot(request()).await.unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(network.sent.load(Ordering::Relaxed), 0);
        assert!(receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .is_none());
        assert!(receipts::pending(&pool).await.unwrap().is_empty());
    }
    // A successful simulation cannot predict a later relay failure; keep recovery evidence.
    *network.simulation.lock().unwrap() = Some(json!({"context":{"slot":10},"value":{"err":null}}));
    let response = router.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), 200);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["error"]["code"], -32002);
    assert_eq!(network.sent.load(Ordering::Relaxed), 1);
    assert_eq!(
        receipts::find(&pool, &action.signature())
            .await
            .unwrap()
            .unwrap()
            .status,
        Status::Pending,
    );
    network.accounts.lock().unwrap().clear();
    network.height.store(201, Ordering::Relaxed);
    for _ in 0..2 {
        app.reconcile_activity().await.unwrap();
        let queued = receipts::pending(&pool).await.unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].signature, action.signature());
        assert_eq!(queued[0].status, Status::Unresolved);
    }
    // Pause a first-seen request after its lookup; another request can save the same
    // signature before its simulation fails. Only that exact receipt permits recovery.
    let concurrent = SignedAction::create(902);
    for matching_receipt in [false, true] {
        network.pause_simulation.store(true, Ordering::Relaxed);
        let pending_app = app.clone();
        let pending_params = concurrent.params();
        let pending =
            tokio::spawn(async move { pending_app.record_submission(&pending_params).await });
        network.simulation_started.notified().await;
        network.pause_simulation.store(false, Ordering::Relaxed);
        *network.simulation.lock().unwrap() =
            Some(json!({"context":{"slot":10},"value":{"err":null}}));
        app.record_submission(&if matching_receipt {
            concurrent.params()
        } else {
            action.params()
        })
        .await
        .unwrap();
        *network.simulation.lock().unwrap() =
            Some(json!({"context":{"slot":10},"value":{"err":"AlreadyProcessed"}}));
        network.resume_simulation.notify_one();
        assert_eq!(pending.await.unwrap().is_ok(), matching_receipt);
        assert_eq!(
            receipts::find(&pool, &concurrent.signature())
                .await
                .unwrap()
                .is_some(),
            matching_receipt,
        );
    }
    app.pool.close().await;
    database.close().await;
    server.abort();
}

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
        side: volaryn_backend::observations::OfferSide::Writer,
        actor_role: volaryn_backend::observations::OfferSide::Writer,
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
