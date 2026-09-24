mod support;

use std::{
    path::Path,
    process::{Command, Output},
};

fn command(manifest: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_volaryn"));
    command
        .arg("--manifest")
        .arg(manifest)
        .env_remove("DATABASE_URL")
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("no_proxy", "127.0.0.1,localhost")
        .env("TOKIO_WORKER_THREADS", "2");
    command
}

fn failure(output: Output, stage: &str, detail: &str) -> String {
    assert_eq!(output.status.code(), Some(1));
    assert!(
        output.stdout.is_empty(),
        "Diagnostics must not pollute JSON stdout"
    );
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains(stage), "{error}");
    assert!(error.contains(detail), "{error}");
    error
}

#[test]
fn missing_manifest_reports_its_startup_stage() {
    let directory = tempfile::tempdir().unwrap();
    failure(
        command(&directory.path().join("missing.json"))
            .output()
            .unwrap(),
        "Startup failed while reading and validating the deployment manifest",
        "os error",
    );
}

#[test]
fn malformed_manifest_reports_location_without_echoing_input() {
    let directory = tempfile::tempdir().unwrap();
    let manifest = directory.path().join("deployment.json");
    std::fs::write(
        &manifest,
        r#"{"schemaVersion":"private-configuration-value"}"#,
    )
    .unwrap();
    let error = failure(
        command(&manifest).output().unwrap(),
        "reading and validating the deployment manifest",
        "Invalid deployment JSON (Data) at line 1, column",
    );
    assert!(!error.contains("private-configuration-value"), "{error}");
}

#[test]
fn incompatible_manifest_uses_the_error_description() {
    let directory = tempfile::tempdir().unwrap();
    let manifest = directory.path().join("deployment.json");
    let mut deployment = support::deployment();
    deployment.schema_version = 2;
    std::fs::write(&manifest, serde_json::to_vec(&deployment).unwrap()).unwrap();
    failure(
        command(&manifest).output().unwrap(),
        "reading and validating the deployment manifest",
        "The chain does not match this deployment",
    );
}

#[cfg(feature = "localnet")]
#[tokio::test]
async fn rpc_failures_report_the_startup_stage_without_connection_secrets() {
    use axum::{response::IntoResponse, routing::post, Router};
    use std::{
        future::IntoFuture,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    let directory = tempfile::tempdir().unwrap();
    let manifest = directory.path().join("deployment.json");
    std::fs::write(
        &manifest,
        serde_json::to_vec(&support::deployment()).unwrap(),
    )
    .unwrap();
    for (status, body, evidence) in [
        (503, "private-configuration-value", "\"status\":503"),
        (
            200,
            "private-configuration-value",
            "RPC returned invalid JSON",
        ),
        (
            200,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"private-configuration-value"}}"#,
            "\"rpc_code\":-32000",
        ),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&requests);
        let server = tokio::spawn(
            axum::serve(
                listener,
                Router::new().route(
                    "/",
                    post(move || {
                        counted.fetch_add(1, Ordering::Relaxed);
                        async move {
                            (axum::http::StatusCode::from_u16(status).unwrap(), body)
                                .into_response()
                        }
                    }),
                ),
            )
            .into_future(),
        );
        let mut child = command(&manifest);
        child
            .arg("--check-deployment")
            .arg("--rpc-url")
            .arg(format!(
            "http://user:private-configuration-value@{address}/?token=private-configuration-value"
        ));
        let output = tokio::task::spawn_blocking(move || child.output())
            .await
            .unwrap()
            .unwrap();
        server.abort();
        let error = failure(
            output,
            "verifying chain identity",
            "The chain is unavailable or its response is invalid",
        );
        assert!(error.contains(evidence), "{error}");
        assert!(!error.contains("private-configuration-value"), "{error}");
        assert!(!error.contains("http://"), "{error}");
        assert_eq!(requests.load(Ordering::Relaxed), 1);
    }
}

#[tokio::test]
async fn healthcheck_still_runs_without_a_manifest_or_database() {
    use axum::{http::StatusCode, routing::get, Router};
    use std::future::IntoFuture;

    let directory = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new().route("/health/ready", get(|| async { StatusCode::OK })),
        )
        .into_future(),
    );
    let mut child = command(&directory.path().join("missing.json"));
    child
        .arg("--healthcheck")
        .arg("--bind")
        .arg(address.to_string());
    let output = tokio::task::spawn_blocking(move || child.output())
        .await
        .unwrap()
        .unwrap();
    server.abort();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}
