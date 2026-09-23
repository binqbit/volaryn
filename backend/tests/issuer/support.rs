use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicI64, AtomicU16, AtomicUsize, Ordering},
    Arc, Mutex,
};
use volaryn_backend::{
    assets::{Registry, MAINNET_GENESIS},
    catalog::Catalog,
};

pub fn api() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/prestocks/api.json")).unwrap()
}
pub fn accounts() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/prestocks/accounts.json"
    ))
    .unwrap()
}
pub fn registry() -> Registry {
    let mut registry = Registry::embedded();
    let now = volaryn_backend::domain::now();
    for asset in &mut registry.assets {
        asset.reviewed_at = now - 60;
        asset.reviewed_until = now + 3600;
        asset.max_expiry = now + 3600;
        asset.conversion_deadline = None;
        asset.expiry_buffer_seconds = 0;
    }
    registry
}

pub struct Upstream {
    pub api: Mutex<Value>,
    pub accounts: Mutex<Value>,
    pub genesis: Mutex<String>,
    pub status: AtomicU16,
    pub calls: AtomicUsize,
    pub clock_offset: AtomicI64,
}

pub struct Server {
    pub url: String,
    pub state: Arc<Upstream>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Server {
    pub async fn start() -> Self {
        let state = Arc::new(Upstream {
            api: Mutex::new(api()),
            accounts: Mutex::new(accounts()),
            genesis: Mutex::new(MAINNET_GENESIS.into()),
            status: AtomicU16::new(200),
            calls: AtomicUsize::new(0),
            clock_offset: AtomicI64::new(0),
        });
        async fn market(State(state): State<Arc<Upstream>>) -> Response {
            state.calls.fetch_add(1, Ordering::SeqCst);
            let status = StatusCode::from_u16(state.status.load(Ordering::SeqCst)).unwrap();
            if status == StatusCode::REQUEST_TIMEOUT {
                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            }
            (status, Json(state.api.lock().unwrap().clone())).into_response()
        }
        async fn rpc(
            State(state): State<Arc<Upstream>>,
            Json(request): Json<Value>,
        ) -> Json<Value> {
            let result = match request["method"].as_str().unwrap() {
                "getGenesisHash" => json!(state.genesis.lock().unwrap().clone()),
                "getEpochInfo" => {
                    json!({"epoch":1039, "absoluteSlot":448898437, "slotIndex":100, "slotsInEpoch":432000})
                }
                "getBlockTime" => json!(
                    volaryn_backend::domain::now() + state.clock_offset.load(Ordering::SeqCst)
                ),
                "getMultipleAccounts" => {
                    assert_eq!(request["params"][1]["commitment"], "finalized");
                    state.accounts.lock().unwrap()["result"].clone()
                }
                method => panic!("Unexpected RPC method: {method}"),
            };
            Json(json!({"jsonrpc":"2.0", "id":1, "result":result}))
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new()
            .route("/", get(market).post(rpc))
            .with_state(Arc::clone(&state));
        let task = tokio::spawn(async {
            axum::serve(listener, router).await.unwrap();
        });
        Self { url, state, task }
    }
    pub fn catalog(&self) -> Catalog {
        Catalog::with_sources(self.url.clone(), self.url.clone(), registry()).unwrap()
    }
}
