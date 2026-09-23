#[path = "support/database.rs"]
mod database;
mod support;

use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    routing::post,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;
use volaryn_backend::{
    adapters::{
        chain::Chain,
        rpc::{Transport, BODY_LIMIT},
        store,
    },
    application::Application,
    domain::AppError,
    http::router,
};

async fn upstream(body: Bytes) -> String {
    let request: Value = serde_json::from_slice(&body).unwrap();
    let result = match request["method"].as_str().unwrap() {
        "getGenesisHash" => json!("11111111111111111111111111111111"),
        "getAccountInfo" if request["params"][0] == volaryn::ID.to_string() => {
            json!({"value":{"owner":"BPFLoaderUpgradeab1e11111111111111111111111", "executable":true}})
        }
        "getAccountInfo" => {
            let mut bytes = vec![0; 45];
            bytes.push(7);
            json!({"value":{"owner":"BPFLoaderUpgradeab1e11111111111111111111111", "data":[STANDARD.encode(bytes),"base64"]}})
        }
        "getProgramAccounts" => json!({"context":{"slot":21}, "value":[]}),
        _ => return r#"{"jsonrpc":"2.0","id":7,"result":{"value":18446744073709551615}}"#.into(),
    };
    json!({"jsonrpc":"2.0", "id":request["id"], "result":result}).to_string()
}

#[tokio::test]
async fn readiness_proxy_and_static_routes_keep_their_boundaries() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async {
        axum::serve(listener, Router::new().route("/", post(upstream)))
            .await
            .unwrap();
    });
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("index.html"), "<html>app</html>").unwrap();
    let deployment = support::deployment();
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let app = Application::new(
        deployment,
        Chain::new(endpoint.clone()).unwrap(),
        pool,
        volaryn_backend::catalog::Catalog::new(endpoint).unwrap(),
    );
    let service = router(app.clone(), directory.path().to_owned());
    let response = service
        .clone()
        .oneshot(Request::get("/health/index").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    app.reconcile().await.unwrap();
    for (path, expected) in [
        ("/health/ready", 200),
        ("/agreements/example", 200),
        ("/api/missing", 404),
        ("/assets/missing.js", 404),
    ] {
        let response = service
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), expected, "{path}");
    }
    let request = |body: String| {
        Request::post("/rpc")
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    let raw = r#"{"jsonrpc":"2.0","id":7,"method":"getBalance","params":[]}"#.to_owned();
    let response = service.clone().oneshot(request(raw.clone())).await.unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        body,
        r#"{"jsonrpc":"2.0","id":7,"result":{"value":18446744073709551615}}"#
    );
    let denied = service
        .clone()
        .oneshot(request(
            r#"{"jsonrpc":"2.0","id":8,"method":"requestAirdrop","params":[]}"#.into(),
        ))
        .await
        .unwrap();
    let body: Value =
        serde_json::from_slice(&denied.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["error"]["code"], -32601);
    assert_eq!(body["id"], 8);
    assert_eq!(
        service
            .clone()
            .oneshot(request("[]".into()))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        service
            .clone()
            .oneshot(request("x".repeat(BODY_LIMIT + 1)))
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    app.pool.close().await;
    assert!(app.reconcile().await.is_err());
    for (path, expected) in [
        ("/health/ready", 200),
        ("/health/index", 503),
        ("/api/config", 200),
    ] {
        let response = service
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            expected,
            "{path} after database failure"
        );
    }
    let response = service.oneshot(request(raw.clone())).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "Index failure cannot disable a verified RPC route"
    );
    database.close().await;
    server.abort();
}

#[tokio::test]
async fn transport_bounds_upstream_responses_and_preserves_rpc_errors() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async {
        axum::serve(listener, Router::new().route("/", post(|body: Bytes| async move {
        if body == "large" { "x".repeat(BODY_LIMIT + 1) } else { r#"{"jsonrpc":"2.0","id":9,"error":{"code":-32002,"message":"simulation failed"}}"#.into() }
    }))).await.unwrap();
    });
    let transport = Transport::new(endpoint).unwrap();
    let raw = transport.raw(Bytes::from_static(b"error")).await.unwrap();
    assert_eq!(
        raw,
        r#"{"jsonrpc":"2.0","id":9,"error":{"code":-32002,"message":"simulation failed"}}"#
    );
    assert!(matches!(
        transport.raw(Bytes::from_static(b"large")).await,
        Err(AppError::Chain)
    ));
    server.abort();
}
