//! Bounded public-source reads. Retries never extend the whole-operation deadline.

use serde_json::Value;
use std::time::Duration;

#[derive(Clone)]
pub struct SourceHttp(reqwest::Client);

impl SourceHttp {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self(
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(5))
                .build()?,
        ))
    }

    pub async fn json(&self, url: &str, body: Option<Value>) -> Result<Value, &'static str> {
        tokio::time::timeout(Duration::from_secs(8), async {
            for attempt in 0..2 {
                let request = match &body {
                    Some(value) => self.0.post(url).json(value),
                    None => self.0.get(url),
                };
                let mut response = request.send().await.map_err(|error| {
                    if error.is_timeout() {
                        "timeout"
                    } else {
                        "unavailable"
                    }
                })?;
                if response.status().as_u16() == 429 {
                    return Err("rate_limited");
                }
                if matches!(response.status().as_u16(), 502..=504) && attempt == 0 {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
                if !response.status().is_success() {
                    return Err("unavailable");
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(|_| "unavailable")? {
                    if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                        return Err("invalid_response");
                    }
                    bytes.extend_from_slice(&chunk);
                }
                return serde_json::from_slice(&bytes).map_err(|_| "invalid_response");
            }
            Err("unavailable")
        })
        .await
        .map_err(|_| "timeout")?
    }
}
