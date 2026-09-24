use clap::Parser;
use std::{error::Error, fmt, sync::Arc};
use volaryn_backend::{
    adapters::{chain::Chain, store},
    application::Application,
    config::{read_deployment, Config},
    http,
};

struct StartupError {
    stage: &'static str,
    source: Box<dyn Error>,
}

impl fmt::Display for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Startup failed while {}: {}",
            self.stage,
            safe_error(self.source.as_ref())
        )
    }
}

// Rust's Result termination uses Debug; keep the operator-facing message readable.
impl fmt::Debug for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, formatter)
    }
}

impl Error for StartupError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(self.source.as_ref())
    }
}

fn startup(stage: &'static str, source: impl Into<Box<dyn Error>>) -> StartupError {
    StartupError {
        stage,
        source: source.into(),
    }
}

// Configuration values and server error messages may contain connection secrets.
fn safe_error(error: &(dyn Error + 'static)) -> String {
    if let Some(error) = error.downcast_ref::<serde_json::Error>() {
        return format!(
            "Invalid deployment JSON ({:?}) at line {}, column {}",
            error.classify(),
            error.line(),
            error.column()
        );
    }
    if let Some(error) = error.downcast_ref::<sqlx::Error>() {
        return match error {
            sqlx::Error::Database(error) => match error.code() {
                Some(code)
                    if code.len() == 5 && code.bytes().all(|byte| byte.is_ascii_alphanumeric()) =>
                {
                    format!("PostgreSQL rejected the operation (SQLSTATE {code})")
                }
                _ => "PostgreSQL rejected the operation".into(),
            },
            sqlx::Error::Configuration(_) => "Invalid PostgreSQL connection configuration".into(),
            sqlx::Error::Io(error) => {
                format!("PostgreSQL connection I/O failed ({:?})", error.kind())
            }
            sqlx::Error::Tls(_) => "PostgreSQL TLS connection failed".into(),
            sqlx::Error::Migrate(error) => safe_error(error.as_ref()),
            sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed | sqlx::Error::RowNotFound => {
                error.to_string()
            }
            _ => "PostgreSQL initialization failed".into(),
        };
    }
    if let Some(error) = error.downcast_ref::<sqlx::migrate::MigrateError>() {
        use sqlx::migrate::MigrateError;
        return match error {
            MigrateError::Execute(error) => safe_error(error),
            MigrateError::ExecuteMigration(error, version) => {
                format!("migration {version}: {}", safe_error(error))
            }
            MigrateError::VersionMissing(_)
            | MigrateError::VersionMismatch(_)
            | MigrateError::VersionNotPresent(_)
            | MigrateError::VersionTooOld(_, _)
            | MigrateError::VersionTooNew(_, _)
            | MigrateError::Dirty(_) => error.to_string(),
            _ => "Database migration failed".into(),
        };
    }
    error.to_string()
}

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
    tracing_subscriber::fmt()
        .json()
        .with_writer(std::io::stderr)
        .init();
    let deployment = read_deployment(&config.manifest)
        .map_err(|error| startup("reading and validating the deployment manifest", error))?;
    volaryn_backend::release::current()
        .verify(&deployment)
        .map_err(|error| startup("verifying the release", error))?;
    let rpc_url = config
        .chain_connection(&deployment)
        .map_err(|error| startup("configuring the chain RPC", error))?;
    let chain = Chain::new(rpc_url).map_err(|_| {
        startup(
            "configuring the chain RPC",
            "Invalid RPC transport configuration",
        )
    })?;
    chain
        .verify_identity(&deployment)
        .await
        .map_err(|error| startup("verifying chain identity", error))?;
    if config.check_deployment {
        let admission = chain
            .check_admission(&deployment)
            .await
            .map_err(|error| startup("checking deployment admission", error))?;
        println!("{}", serde_json::to_string_pretty(&admission)?);
        return Ok(());
    }
    let database_url = config
        .database_connection()
        .map_err(|error| startup("configuring PostgreSQL", error))?;
    let database_options = database_url.parse().map_err(|_| {
        startup(
            "configuring PostgreSQL",
            "Invalid PostgreSQL connection URL",
        )
    })?;
    let pool = store::open(database_options, &deployment)
        .await
        .map_err(|error| startup("opening PostgreSQL and applying migrations", error))?;
    let catalog =
        volaryn_backend::catalog::Catalog::new(config.official_rpc_url).map_err(|_| {
            startup(
                "configuring the official catalog",
                "Invalid catalog transport configuration",
            )
        })?;
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
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|error| startup("binding the HTTP listener", error))?;
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
