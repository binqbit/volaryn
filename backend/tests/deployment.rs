mod support;
use axum::{extract::State, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use volaryn_backend::adapters::chain::Chain;

#[tokio::test]
async fn identity_binds_loader_code_authority_protocol_and_currency_in_one_snapshot() {
    let deployment = support::deployment();
    let accounts = Arc::new(Mutex::new(support::identity::accounts(&deployment)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let chain = Chain::new(format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route(
                    "/",
                    post(
                        |State(accounts): State<Arc<Mutex<Vec<Value>>>>,
                         Json(request): Json<Value>| async move {
                            let result = match request["method"].as_str().unwrap() {
                                "getGenesisHash" => json!("11111111111111111111111111111111"),
                                "getMultipleAccounts" => {
                                    assert_eq!(request["params"][1]["commitment"], "finalized");
                                    json!({"context":{"slot":10},"value":*accounts.lock().unwrap()})
                                }
                                _ => panic!(
                                    "Read-only deployment verification issued an unexpected method"
                                ),
                            };
                            Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
                        },
                    ),
                )
                .with_state(Arc::clone(&accounts)),
        )
        .into_future(),
    );
    chain.verify_identity(&deployment).await.unwrap();
    for (index, offset) in [
        (0, 0),
        (0, 4),
        (1, 0),
        (1, 4),
        (1, 12),
        (1, 13),
        (1, 45),
        (2, 8),
        (2, 40),
        (3, 44),
    ] {
        let mut corrupted = support::identity::accounts(&deployment);
        let mut bytes = STANDARD
            .decode(corrupted[index]["data"][0].as_str().unwrap())
            .unwrap();
        bytes[offset] ^= 255;
        corrupted[index]["data"][0] = json!(STANDARD.encode(bytes));
        *accounts.lock().unwrap() = corrupted;
        assert!(
            chain.verify_identity(&deployment).await.is_err(),
            "account {index}, offset {offset}"
        );
    }
    let mut padded = support::identity::accounts(&deployment);
    let mut bytes = STANDARD
        .decode(padded[1]["data"][0].as_str().unwrap())
        .unwrap();
    bytes.extend([0; 32]);
    padded[1]["data"][0] = json!(STANDARD.encode(&bytes));
    *accounts.lock().unwrap() = padded.clone();
    chain.verify_identity(&deployment).await.unwrap();
    bytes.push(1);
    padded[1]["data"][0] = json!(STANDARD.encode(bytes));
    *accounts.lock().unwrap() = padded;
    assert!(chain.verify_identity(&deployment).await.is_err());
    let mut immutable = deployment.clone();
    immutable.upgrade_authority = None;
    let mut frozen = support::identity::accounts(&deployment);
    let mut bytes = STANDARD
        .decode(frozen[1]["data"][0].as_str().unwrap())
        .unwrap();
    bytes[12] = 0;
    frozen[1]["data"][0] = json!(STANDARD.encode(bytes));
    *accounts.lock().unwrap() = frozen;
    chain.verify_identity(&immutable).await.unwrap();
    assert!(chain.verify_identity(&deployment).await.is_err());
    server.abort();
}
use std::future::IntoFuture;
