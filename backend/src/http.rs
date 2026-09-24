use crate::{
    adapters::rpc::BODY_LIMIT,
    application::Application,
    domain::AppError,
    observations::{AgreementView, AssetView, Deployment, WalletView},
    queries::AgreementQuery,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue, Value};
use std::{path::PathBuf, sync::Arc};
use tower::ServiceExt;
use tower_http::{
    limit::RequestBodyLimitLayer, services::ServeDir, set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(Serialize, ToSchema)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Self::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large"),
            Self::Invalid => (StatusCode::BAD_REQUEST, "invalid_request"),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::Identity => (StatusCode::SERVICE_UNAVAILABLE, "wrong_network"),
            Self::Chain => (StatusCode::SERVICE_UNAVAILABLE, "chain_unavailable"),
            Self::Stale => (StatusCode::SERVICE_UNAVAILABLE, "stale_observation"),
            Self::Database => (StatusCode::SERVICE_UNAVAILABLE, "database_unavailable"),
            Self::Storage => (StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable"),
        };
        (
            status,
            Json(ErrorBody {
                code,
                message: self.to_string(),
            }),
        )
            .into_response()
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Volaryn API", version = "1.0.0"),
    components(schemas(ErrorBody, crate::queries::AgreementLifecycle))
)]
struct Api;

fn api() -> OpenApiRouter<Arc<Application>> {
    OpenApiRouter::with_openapi(Api::openapi())
        .routes(routes!(config))
        .routes(routes!(release))
        .routes(routes!(assets))
        .routes(routes!(admission))
        .routes(routes!(official_assets))
        .routes(routes!(wallet))
        .routes(routes!(offers))
        .routes(routes!(agreements))
        .routes(routes!(agreement))
        .routes(routes!(activity))
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    api().split_for_parts().1
}

pub fn router(application: Arc<Application>, frontend: PathBuf) -> Router {
    let (api, _) = api().split_for_parts();
    let static_dir = frontend.clone();
    api.route("/rpc", post(proxy))
        .route("/health/live", get(|| async { StatusCode::OK }))
        .route("/health/ready", get(ready))
        .route("/health/index", get(index_ready))
        .route("/api/{*path}", get(|| async { AppError::NotFound }))
        .fallback(move |uri: Uri| serve_frontend(uri, static_dir.clone()))
        .with_state(application)
        .layer(RequestBodyLimitLayer::new(BODY_LIMIT))
        .layer(axum::middleware::map_response(|response: Response| async {
            if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
                AppError::TooLarge.into_response()
            } else {
                response
            }
        }))
        .layer(tower::limit::ConcurrencyLimitLayer::new(32))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(request_context))
}

async fn request_context(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tracing::Instrument;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let id = format!(
        "{:x}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let span = tracing::info_span!("request", request_id = %id, method = %request.method(), path = request.uri().path());
    let mut response = async {
        let started = std::time::Instant::now();
        let response = next.run(request).await;
        tracing::info!(
            status = response.status().as_u16(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "request completed"
        );
        response
    }
    .instrument(span)
    .await;
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&id).expect("generated request identity"),
    );
    response
}

async fn serve_frontend(uri: Uri, directory: PathBuf) -> Response {
    let path = uri.path();
    if matches!(
        path,
        "/" | "/offers"
            | "/offers/new"
            | "/portfolio"
            | "/portfolio/protection"
            | "/portfolio/written"
            | "/portfolio/activity"
            | "/writer"
            | "/protection"
            | "/issuer-assets"
    ) || path.starts_with("/agreements/")
    {
        match tokio::fs::read(directory.join("index.html")).await {
            Ok(bytes) => (
                [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                bytes,
            )
                .into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    } else if path.starts_with("/assets/") {
        let request = axum::http::Request::builder()
            .uri(uri)
            .body(axum::body::Body::empty())
            .unwrap();
        match ServeDir::new(directory).oneshot(request).await {
            Ok(mut response) => {
                if response.status().is_success() {
                    response.headers_mut().insert(
                        header::CACHE_CONTROL,
                        HeaderValue::from_static("public, max-age=31536000, immutable"),
                    );
                }
                response.into_response()
            }
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn ready(State(app): State<Arc<Application>>) -> Result<StatusCode, AppError> {
    app.ensure_chain().await?;
    Ok(StatusCode::OK)
}

async fn index_ready(State(app): State<Arc<Application>>) -> Result<StatusCode, AppError> {
    app.ensure_chain().await?;
    app.ready()?;
    crate::adapters::store::healthy(&app.pool)
        .await
        .map_err(|_| AppError::Database)?;
    Ok(StatusCode::OK)
}

#[utoipa::path(get, path = "/api/config", responses((status = 200, body = Deployment)))]
async fn config(State(app): State<Arc<Application>>) -> Result<Json<Deployment>, AppError> {
    app.ensure_chain().await?;
    Ok(Json(app.deployment.clone()))
}

#[utoipa::path(get, path = "/api/release", responses((status = 200, body = crate::release::Release)))]
async fn release() -> Json<crate::release::Release> {
    Json(crate::release::current())
}

#[utoipa::path(get, path = "/api/assets", responses((status = 200, body = [AssetView])))]
async fn assets(State(app): State<Arc<Application>>) -> Result<Json<Vec<AssetView>>, AppError> {
    app.ensure_chain().await?;
    Ok(Json(app.deployment.assets.clone()))
}

#[derive(Deserialize)]
struct MintQuery {
    mint: String,
}

#[utoipa::path(get, path = "/api/admission", params(("mint" = String, Query)), responses((status = 200, body = crate::adapters::deployment::Admission)))]
async fn admission(
    State(app): State<Arc<Application>>,
    Query(query): Query<MintQuery>,
) -> Result<Json<crate::adapters::deployment::Admission>, AppError> {
    app.ensure_chain().await?;
    app.chain
        .admission(&app.deployment, &query.mint)
        .await
        .map(Json)
}

#[derive(Deserialize)]
struct OwnerQuery {
    owner: String,
}

#[utoipa::path(get, path = "/api/assets/official", responses((status = 200, body = crate::assets::OfficialCatalog)))]
async fn official_assets(
    State(app): State<Arc<Application>>,
) -> Json<crate::assets::OfficialCatalog> {
    // Independent of the local ledger, projection and signing readiness.
    Json(app.catalog.observe().await)
}

#[utoipa::path(get, path = "/api/wallet", params(("owner" = String, Query)), responses((status = 200, body = WalletView)))]
async fn wallet(
    State(app): State<Arc<Application>>,
    query: Result<Query<OwnerQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<WalletView>, AppError> {
    app.ensure_chain().await?;
    let Query(query) = query.map_err(|_| AppError::Invalid)?;
    Ok(Json(app.chain.wallet(&app.deployment, &query.owner).await?))
}

#[utoipa::path(get, path = "/api/offers", params(AgreementQuery), responses((status = 200, body = [AgreementView], headers(("X-Next-Cursor" = String, description = "Exclusive address cursor for the next page; absent on the last page")))))]
async fn offers(
    State(app): State<Arc<Application>>,
    query: Result<Query<AgreementQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response, AppError> {
    let Query(query) = query.map_err(|_| AppError::Invalid)?;
    page_response(app.agreements(&query, true).await?)
}

#[utoipa::path(get, path = "/api/agreements", params(AgreementQuery), responses((status = 200, body = [AgreementView], headers(("X-Next-Cursor" = String, description = "Exclusive address cursor for the next page; absent on the last page")))))]
async fn agreements(
    State(app): State<Arc<Application>>,
    query: Result<Query<AgreementQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response, AppError> {
    let Query(query) = query.map_err(|_| AppError::Invalid)?;
    page_response(app.agreements(&query, false).await?)
}

fn page_response(page: crate::adapters::store::AgreementPage) -> Result<Response, AppError> {
    let mut response = Json(page.items).into_response();
    if let Some(cursor) = page.next {
        response.headers_mut().insert(
            "x-next-cursor",
            HeaderValue::from_str(&cursor).map_err(|_| AppError::Storage)?,
        );
    }
    Ok(response)
}

#[utoipa::path(get, path = "/api/agreements/{address}", params(("address" = String, Path)), responses((status = 200, body = AgreementView)))]
async fn agreement(
    State(app): State<Arc<Application>>,
    Path(address): Path<String>,
) -> Result<Json<AgreementView>, AppError> {
    app.agreement(&address).await.map(Json)
}

#[utoipa::path(get, path = "/api/activity", params(crate::activity::ActivityQuery), responses((status = 200, body = crate::activity::ActivityPage)))]
async fn activity(
    State(app): State<Arc<Application>>,
    query: Result<Query<crate::activity::ActivityQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<crate::activity::ActivityPage>, AppError> {
    app.activity(&query.map_err(|_| AppError::Invalid)?.0)
        .await
        .map(Json)
}

#[derive(Deserialize)]
struct Envelope {
    jsonrpc: String,
    id: Value,
    method: String,
    params: Box<RawValue>,
}

async fn proxy(State(app): State<Arc<Application>>, body: Bytes) -> Result<Response, AppError> {
    app.ensure_chain().await?;
    let envelope: Envelope = serde_json::from_slice(&body).map_err(|_| AppError::Invalid)?;
    const METHODS: &[&str] = &[
        "getGenesisHash",
        "getEpochInfo",
        "getHealth",
        "getBalance",
        "getLatestBlockhash",
        "getAccountInfo",
        "getMultipleAccounts",
        "getTokenAccountsByOwner",
        "getMinimumBalanceForRentExemption",
        "getSignatureStatuses",
        "getBlockHeight",
        "getSlot",
        "getBlockTime",
        "getFeeForMessage",
        "simulateTransaction",
        "sendTransaction",
    ];
    if envelope.jsonrpc != "2.0"
        || !(envelope.id.is_string() || envelope.id.is_number())
        || !envelope.params.get().starts_with('[')
    {
        return Err(AppError::Invalid);
    }
    if !METHODS.contains(&envelope.method.as_str()) {
        return Ok(Json(json!({"jsonrpc":"2.0", "id":envelope.id, "error":{"code":-32601, "message":"Method not allowed"}})).into_response());
    }
    if envelope.method == "sendTransaction" {
        let params = serde_json::from_str(envelope.params.get()).map_err(|_| AppError::Invalid)?;
        app.record_submission(&params).await?;
    }
    let bytes = app.chain.transport.raw(body).await?;
    Ok(([(header::CONTENT_TYPE, "application/json")], bytes).into_response())
}
