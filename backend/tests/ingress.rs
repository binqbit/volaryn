mod support;

use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
};
use http_body_util::Channel;
use std::{convert::Infallible, time::Duration};
use tower::ServiceExt;
use volaryn_backend::{
    adapters::chain::Chain, application::Application, catalog::Catalog, http::router,
};

fn service() -> axum::Router {
    // Body validation runs before any RPC or database work. No external services are started.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgresql://127.0.0.1:1/unused")
        .unwrap();
    let endpoint = "http://127.0.0.1:1";
    let app = Application::new(
        support::deployment(),
        Chain::new(endpoint.into()).unwrap(),
        pool,
        Catalog::new(endpoint.into()).unwrap(),
    );
    router(app, "missing-test-frontend".into())
}

#[tokio::test(start_paused = true)]
async fn stalled_request_body_releases_the_request_slot() {
    let (_sender, body) = Channel::<Bytes, Infallible>::new(1);
    let request = Request::post("/rpc")
        .header("content-type", "application/json")
        .body(Body::new(body))
        .unwrap();
    let response = tokio::time::timeout(Duration::from_secs(11), service().oneshot(request))
        .await
        .expect("An incomplete body must not hold a request slot indefinitely")
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(response.headers().contains_key("x-request-id"));
}

#[tokio::test(start_paused = true)]
async fn trickling_body_data_cannot_extend_the_total_deadline() {
    let (mut sender, body) = Channel::<Bytes, Infallible>::new(1);
    let request = Request::post("/rpc")
        .header("content-type", "application/json")
        .body(Body::new(body))
        .unwrap();
    let pending = tokio::spawn(service().oneshot(request));
    for _ in 0..4 {
        sender.send_data(Bytes::from_static(b" ")).await.unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(3)).await;
    }
    let response = tokio::time::timeout(Duration::from_secs(1), pending)
        .await
        .expect("Repeated chunks must not restart the body deadline")
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
