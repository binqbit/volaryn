use crate::{domain::AppError, observations::Deployment};
use anchor_lang::prelude::Pubkey;
use clap::Parser;
use std::{net::SocketAddr, path::PathBuf, str::FromStr};

#[derive(Parser)]
#[command(about = "Volaryn application server")]
pub struct Config {
    #[arg(long, default_value = "target/localnet/deployment.json")]
    pub manifest: PathBuf,
    /// PostgreSQL connection. Compose supplies the disposable local credentials.
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    pub database_url: Option<String>,
    #[arg(long, default_value = "frontend/dist")]
    pub frontend: PathBuf,
    #[arg(long, default_value = "127.0.0.1:8080")]
    pub bind: SocketAddr,
    #[arg(long, default_value = "http://127.0.0.1:8899")]
    pub rpc_url: String,
    /// Check an existing server without requiring curl in the runtime image.
    #[arg(long)]
    pub healthcheck: bool,
}

pub fn read_deployment(path: &std::path::Path) -> Result<Deployment, Box<dyn std::error::Error>> {
    let deployment: Deployment = serde_json::from_slice(&std::fs::read(path)?)?;
    validate_deployment(&deployment)?;
    Ok(deployment)
}

pub fn validate_deployment(deployment: &Deployment) -> Result<(), AppError> {
    if deployment.schema_version != 1
        || deployment.fixture_version != 1
        || deployment.mode != "localnet"
        || !cfg!(feature = "localnet")
        || deployment.program_id != volaryn::ID.to_string()
        || deployment.program_length == 0
        || deployment.program_length > 10 * 1024 * 1024
        || !deployment
            .program_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || deployment.program_sha256.len() != 64
    {
        return Err(AppError::Identity);
    }
    for address in [
        &deployment.genesis_hash,
        &deployment.authority,
        &deployment.holder,
        &deployment.writer,
        &deployment.usdc_mint,
        &deployment.underlying_mint,
        &deployment.writer_usdc,
        &deployment.holder_usdc,
        &deployment.holder_underlying,
    ] {
        Pubkey::from_str(address).map_err(|_| AppError::Identity)?;
    }
    Ok(())
}
