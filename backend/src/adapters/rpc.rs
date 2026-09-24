use crate::domain::AppError;
use async_trait::async_trait;
use axum::body::Bytes;
use serde_json::{json, Value};
use solana_rpc_client::rpc_sender::{RpcSender, RpcTransportStats};
use solana_rpc_client_api::{
    client_error::{Error, ErrorKind},
    request::RpcRequest,
};
use std::time::Duration;

pub const BODY_LIMIT: usize = 2 * 1024 * 1024;

// RPC URLs can contain credentials. Log failure classes, never reqwest's URL-bearing errors.
fn transport_error(error: &reqwest::Error, stage: &'static str) -> AppError {
    let reason = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connection"
    } else if error.is_body() {
        "response_body"
    } else {
        "request"
    };
    tracing::warn!(stage, reason, "RPC transport failed");
    AppError::Chain
}

#[derive(Clone)]
pub struct Transport {
    client: reqwest::Client,
    url: String,
}

impl Transport {
    pub fn new(url: String) -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()?;
        Ok(Self { client, url })
    }

    /// Preserve Solana's JSON numbers and error envelopes byte-for-byte.
    pub async fn raw(&self, body: Bytes) -> Result<Bytes, AppError> {
        self.raw_bounded(body, BODY_LIMIT).await
    }

    pub(super) async fn raw_bounded(
        &self,
        body: Bytes,
        response_limit: usize,
    ) -> Result<Bytes, AppError> {
        if body.len() > BODY_LIMIT {
            return Err(AppError::Invalid);
        }
        tokio::time::timeout(Duration::from_secs(8), async {
            let mut response = self
                .client
                .post(&self.url)
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(|error| transport_error(&error, "send"))?;
            if !response.status().is_success() {
                tracing::warn!(
                    status = response.status().as_u16(),
                    "RPC returned an unsuccessful HTTP status"
                );
                return Err(AppError::Chain);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| transport_error(&error, "read"))?
            {
                if bytes.len() + chunk.len() > response_limit {
                    tracing::warn!(
                        response_limit,
                        received_bytes = bytes.len() + chunk.len(),
                        "RPC response exceeded its byte limit"
                    );
                    return Err(AppError::Chain);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(Bytes::from(bytes))
        })
        .await
        .map_err(|_| {
            tracing::warn!(reason = "timeout", "RPC operation exceeded its deadline");
            AppError::Chain
        })?
    }
}

#[async_trait]
impl RpcSender for Transport {
    async fn send(&self, request: RpcRequest, params: Value) -> Result<Value, Error> {
        let bytes = serde_json::to_vec(
            &json!({"jsonrpc":"2.0", "id":1, "method":request.to_string(), "params":params}),
        )?;
        let response = self
            .raw(bytes.into())
            .await
            .map_err(|error| Error::from(ErrorKind::Custom(error.to_string())))?;
        let value: Value = serde_json::from_slice(&response).inspect_err(|error| {
            tracing::warn!(
                method = %request,
                line = error.line(),
                column = error.column(),
                "RPC returned invalid JSON"
            );
        })?;
        if value.get("error").is_some() || value.get("result").is_none() {
            tracing::warn!(
                method = %request,
                rpc_code = value["error"]["code"].as_i64(),
                "RPC rejected the request or omitted its result"
            );
            return Err(ErrorKind::Custom("Upstream rejected the RPC request".into()).into());
        }
        Ok(value["result"].clone())
    }
    fn get_transport_stats(&self) -> RpcTransportStats {
        RpcTransportStats::default()
    }
    fn url(&self) -> String {
        self.url.clone()
    }
}
