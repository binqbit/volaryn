use crate::{assets::MAINNET_GENESIS, domain::AppError, observations::Deployment};
use anchor_lang::prelude::Pubkey;
use clap::Parser;
use std::{net::SocketAddr, path::PathBuf, str::FromStr};

/// Circle's native Solana USDC; never substituted with a bridged or test mint.
pub const MAINNET_USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

#[derive(Parser)]
#[command(about = "Volaryn application server")]
pub struct Config {
    #[arg(long, default_value = "target/localnet/deployment.json")]
    pub manifest: PathBuf,
    #[arg(
        long,
        env = "DATABASE_URL",
        hide_env_values = true,
        conflicts_with = "database_url_file"
    )]
    pub database_url: Option<String>,
    #[arg(long)]
    pub database_url_file: Option<PathBuf>,
    #[arg(long, default_value = "frontend/dist")]
    pub frontend: PathBuf,
    #[arg(long, default_value = "127.0.0.1:8080")]
    pub bind: SocketAddr,
    #[arg(long, conflicts_with = "rpc_url_file")]
    pub rpc_url: Option<String>,
    #[arg(long)]
    pub rpc_url_file: Option<PathBuf>,
    /// Read-only source for the official catalog; never used for signing.
    #[arg(long, default_value = crate::assets::MAINNET_RPC)]
    pub official_rpc_url: String,
    #[arg(long)]
    pub healthcheck: bool,
    /// Verify release, chain, protocol and asset policies without opening a database or sending.
    #[arg(long)]
    pub check_deployment: bool,
}

fn secret(value: &Option<String>, file: &Option<PathBuf>) -> Result<Option<String>, &'static str> {
    if let Some(path) = file {
        let value =
            std::fs::read_to_string(path).map_err(|_| "Cannot read connection secret file")?;
        let value = value.trim();
        if value.is_empty() || value.len() > 8192 || value.contains(['\n', '\r']) {
            return Err("Invalid connection secret file");
        }
        return Ok(Some(value.to_owned()));
    }
    Ok(value.clone())
}

impl Config {
    pub fn database_connection(&self) -> Result<String, &'static str> {
        secret(&self.database_url, &self.database_url_file)?
            .ok_or("Set DATABASE_URL, --database-url or --database-url-file")
    }

    pub fn chain_connection(&self, deployment: &Deployment) -> Result<String, &'static str> {
        let value = secret(&self.rpc_url, &self.rpc_url_file)?;
        let value = match (value, deployment.mode.as_str()) {
            (Some(value), _) => value,
            (None, "localnet") => "http://127.0.0.1:8899".into(),
            _ => return Err("Set --rpc-url or --rpc-url-file for the external deployment"),
        };
        let url = reqwest::Url::parse(&value).map_err(|_| "Invalid RPC connection URL")?;
        if url.host_str().is_none()
            || !matches!(url.scheme(), "http" | "https")
            || (deployment.mode == "mainnet" && url.scheme() != "https")
        {
            return Err("External RPC connections require HTTPS");
        }
        Ok(value)
    }
}

pub fn read_deployment(path: &std::path::Path) -> Result<Deployment, Box<dyn std::error::Error>> {
    let deployment: Deployment = serde_json::from_slice(&std::fs::read(path)?)?;
    validate_deployment(&deployment)?;
    Ok(deployment)
}

pub fn validate_deployment(deployment: &Deployment) -> Result<(), AppError> {
    if deployment.schema_version != 3
        || deployment.program_id != volaryn::ID.to_string()
        || deployment.program_length == 0
        || deployment.program_length > 10 * 1024 * 1024
        || !deployment
            .program_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || deployment.program_sha256.len() != 64
    {
        return Err(AppError::Identity);
    }
    for address in [
        &deployment.genesis_hash,
        &deployment.authority,
        &deployment.usdc_mint,
    ]
    .into_iter()
    .chain(deployment.upgrade_authority.iter())
    {
        Pubkey::from_str(address).map_err(|_| AppError::Identity)?;
    }
    match (deployment.mode.as_str(), &deployment.localnet) {
        ("localnet", Some(local)) if cfg!(feature = "localnet") && local.fixture_version == 1 => {
            if deployment.genesis_hash == MAINNET_GENESIS {
                return Err(AppError::Identity);
            }
            for address in [
                &local.holder,
                &local.writer,
                &local.writer_usdc,
                &local.holder_usdc,
            ] {
                Pubkey::from_str(address).map_err(|_| AppError::Identity)?;
            }
        }
        ("mainnet", None)
            if !cfg!(feature = "localnet")
                && deployment.genesis_hash == MAINNET_GENESIS
                && deployment.usdc_mint == MAINNET_USDC => {}
        _ => return Err(AppError::Identity),
    }
    let registry = crate::assets::Registry::embedded();
    let mut mints = std::collections::BTreeSet::new();
    let mut references = std::collections::BTreeSet::new();
    if deployment.assets.is_empty() || deployment.assets.len() > registry.assets.len() {
        return Err(AppError::Identity);
    }
    for asset in &deployment.assets {
        Pubkey::from_str(&asset.mint).map_err(|_| AppError::Identity)?;
        let reviewed = registry
            .assets
            .iter()
            .find(|item| item.mint == asset.reference_mint)
            .ok_or(AppError::Identity)?;
        if !mints.insert(&asset.mint)
            || !references.insert(&asset.reference_mint)
            || asset.mint == deployment.usdc_mint
            || (deployment.mode == "mainnet" && asset.mint != reviewed.mint)
            || (deployment.mode == "localnet"
                && registry.assets.iter().any(|item| item.mint == asset.mint))
            || asset.symbol != reviewed.symbol
            || asset.name != reviewed.name
            || asset.decimals != reviewed.decimals
            || asset.source != reviewed.source
        {
            return Err(AppError::Identity);
        }
    }
    Ok(())
}
