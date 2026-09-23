//! Read-only issuer verification through the same adapters used by the application.

use clap::Parser;
use volaryn_backend::{assets::MAINNET_RPC, catalog::Catalog};

#[derive(Parser)]
#[command(
    about = "Read official PreStocks context and verify mainnet mint configuration; never signs or submits transactions"
)]
struct Config {
    #[arg(long, default_value = MAINNET_RPC)]
    rpc_url: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::parse();
    let snapshot = Catalog::new(config.rpc_url)?.observe().await;
    println!("{}", serde_json::to_string_pretty(&snapshot)?);
    if !matches!(
        snapshot.market_source.status,
        volaryn_backend::assets::SourceStatus::Fresh
    ) || !matches!(
        snapshot.chain_source.status,
        volaryn_backend::assets::SourceStatus::Fresh
    ) {
        std::process::exit(1);
    }
    Ok(())
}
