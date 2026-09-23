use clap::Parser;
use std::sync::Arc;
use volaryn_backend::{
    adapters::{chain::Chain, store},
    application::Application,
    config::{read_deployment, Config},
    http,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::parse();
    if config.healthcheck {
        reqwest::Client::new()
            .get(format!(
                "http://127.0.0.1:{}/health/ready",
                config.bind.port()
            ))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await?
            .error_for_status()?;
        return Ok(());
    }
    tracing_subscriber::fmt().json().init();
    let deployment = read_deployment(&config.manifest)?;
    let chain = Chain::new(config.rpc_url)?;
    chain.verify_identity(&deployment).await?;
    let database_url = config
        .database_url
        .as_deref()
        .ok_or("Set DATABASE_URL or --database-url for PostgreSQL")?;
    let database_options = database_url
        .parse()
        .map_err(|_| "Invalid PostgreSQL connection URL")?;
    let pool = store::open(database_options, &deployment).await?;
    let catalog = volaryn_backend::catalog::Catalog::new(config.official_rpc_url)?;
    let app = Application::new(deployment, chain, pool, catalog);
    let worker_app = Arc::clone(&app);
    let worker = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = worker_app.reconcile().await {
                tracing::warn!(%error, "reconciliation unavailable");
            }
        }
    });
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    let activity_app = Arc::clone(&app);
    let activity_worker = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = activity_app.reconcile_activity().await {
                tracing::warn!(%error, "activity reconciliation unavailable");
            }
        }
    });
    tracing::info!(address = %listener.local_addr()?, "application ready");
    axum::serve(listener, http::router(Arc::clone(&app), config.frontend))
        .with_graceful_shutdown(async {
            let mut termination =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = termination.recv() => {} }
        })
        .await?;
    worker.abort();
    activity_worker.abort();
    let _ = worker.await;
    let _ = activity_worker.await;
    app.pool.close().await;
    Ok(())
}
