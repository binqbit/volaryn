//! Public artifact identity. Connection secrets and signing keys never enter this record.
use crate::{domain::AppError, observations::Deployment};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: &'static str,
    pub revision: Option<&'static str>,
    pub program_sha256: Option<&'static str>,
    pub localnet: bool,
}

pub fn current() -> Release {
    Release {
        version: env!("CARGO_PKG_VERSION"),
        revision: option_env!("VOLARYN_RELEASE_REVISION"),
        program_sha256: option_env!("VOLARYN_PROGRAM_SHA256"),
        localnet: cfg!(feature = "localnet"),
    }
}

impl Release {
    pub fn verify(&self, deployment: &Deployment) -> Result<(), AppError> {
        if deployment.mode == "mainnet"
            && (self.localnet
                || self.revision.is_none_or(|value| {
                    value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit())
                })
                || self.program_sha256 != Some(deployment.program_sha256.as_str()))
        {
            return Err(AppError::Identity);
        }
        Ok(())
    }
}
