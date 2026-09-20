#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("The chain is unavailable or its response is invalid")]
    Chain,
    #[error("The chain does not match this deployment")]
    Identity,
    #[error("Chain observations are stale; refresh before continuing")]
    Stale,
    #[error("The requested account was not found")]
    NotFound,
    #[error("Request body exceeds the supported size")]
    TooLarge,
    #[error("Invalid request")]
    Invalid,
    #[error("The database is unavailable")]
    Database,
    #[error("The local projection could not be read or updated")]
    Storage,
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
