use crate::{
    domain::AppError,
    observations::{AgreementView, Deployment},
};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    types::Json,
    PgPool,
};
use std::time::Duration;

pub async fn open(
    options: PgConnectOptions,
    deployment: &Deployment,
) -> Result<PgPool, Box<dyn std::error::Error>> {
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options.application_name("volaryn").options([
            ("statement_timeout", "10000"),
            ("lock_timeout", "3000"),
            ("idle_in_transaction_session_timeout", "10000"),
        ]))
        .await?;
    // SQLx takes PostgreSQL's migration lock and validates applied checksums.
    let result = async {
        sqlx::migrate!().run(&pool).await?;
        sqlx::query(
            "INSERT INTO deployment (singleton, genesis_hash, program_id)
             VALUES (1, $1, $2) ON CONFLICT (singleton) DO NOTHING",
        )
        .bind(&deployment.genesis_hash)
        .bind(&deployment.program_id)
        .execute(&pool)
        .await?;
        let identity: (String, String) =
            sqlx::query_as("SELECT genesis_hash, program_id FROM deployment WHERE singleton = 1")
                .fetch_one(&pool)
                .await?;
        if identity
            != (
                deployment.genesis_hash.clone(),
                deployment.program_id.clone(),
            )
        {
            return Err(Box::<dyn std::error::Error>::from(AppError::Identity));
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        pool.close().await;
        return Err(error);
    }
    Ok(pool)
}

pub async fn healthy(pool: &PgPool) -> Result<(), AppError> {
    tokio::time::timeout(
        Duration::from_secs(2),
        sqlx::query("SELECT 1").execute(pool),
    )
    .await
    .map_err(|_| AppError::Storage)??;
    Ok(())
}

/// Atomically persist a bounded batch. Retained agreements are never deleted by indexing.
pub async fn upsert(
    pool: &PgPool,
    values: &[AgreementView],
    slot: u64,
    observed_at: i64,
) -> Result<(), AppError> {
    let mut transaction = pool.begin().await?;
    // One statement per batch; stable key order avoids opposing row-lock order.
    sqlx::query(
        "INSERT INTO agreements (address, projection, finalized_slot, observed_at)
         SELECT item ->> 'address', item - 'finalizedSlot' - 'observedAt',
                (item ->> 'finalizedSlot')::NUMERIC, (item ->> 'observedAt')::BIGINT
         FROM jsonb_array_elements($1) AS item ORDER BY item ->> 'address'
         ON CONFLICT (address) DO UPDATE SET
             projection = EXCLUDED.projection,
             finalized_slot = EXCLUDED.finalized_slot,
             observed_at = EXCLUDED.observed_at
         WHERE agreements.finalized_slot <= EXCLUDED.finalized_slot",
    )
    .bind(Json(values))
    .execute(&mut *transaction)
    .await?;
    // This is a high-water mark, not a claim that every row was read at this slot.
    sqlx::query(
        "INSERT INTO reconciliation (singleton, finalized_slot, observed_at)
         VALUES (1, $1::TEXT::NUMERIC, $2) ON CONFLICT (singleton) DO UPDATE
         SET finalized_slot = EXCLUDED.finalized_slot, observed_at = EXCLUDED.observed_at
         WHERE reconciliation.finalized_slot <= EXCLUDED.finalized_slot",
    )
    .bind(slot.to_string())
    .bind(observed_at)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub struct AgreementPage {
    pub items: Vec<AgreementView>,
    pub next: Option<String>,
}

pub async fn last_slot(pool: &PgPool) -> Result<u64, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT finalized_slot::TEXT FROM reconciliation WHERE singleton = 1")
            .fetch_optional(pool)
            .await?;
    row.map_or(Ok(0), |(slot,)| slot.parse().map_err(|_| AppError::Storage))
}

pub async fn agreements(
    pool: &PgPool,
    query: &crate::queries::AgreementQuery,
    offers_only: bool,
) -> Result<AgreementPage, AppError> {
    let limit = query.page_size()?;
    let mut sql = sqlx::QueryBuilder::<sqlx::Postgres>::new(
        "SELECT projection || jsonb_build_object(
             'finalizedSlot', finalized_slot::TEXT, 'observedAt', observed_at)
         FROM agreements WHERE TRUE",
    );
    if let Some(after) = &query.after {
        sql.push(" AND address > ").push_bind(after);
    }
    for (column, value) in [
        ("holder", &query.holder),
        ("writer", &query.writer),
        ("underlying_mint", &query.mint),
        ("status", &query.status),
    ] {
        if let Some(value) = value {
            sql.push(" AND ").push(column).push(" = ").push_bind(value);
        }
    }
    if offers_only {
        sql.push(" AND status = 'funded' AND accept_before > ")
            .push_bind(crate::domain::now())
            .push(" AND (projection ->> 'reserveAmount')::NUMERIC >= (projection ->> 'payout')::NUMERIC");
    }
    for (expression, value) in [
        (
            " AND (projection ->> 'quantityRaw')::NUMERIC = ",
            &query.quantity_raw,
        ),
        (
            " AND (projection ->> 'payout')::NUMERIC >= ",
            &query.min_payout,
        ),
        (
            " AND (projection ->> 'premium')::NUMERIC <= ",
            &query.max_premium,
        ),
    ] {
        if let Some(value) = value {
            sql.push(expression).push_bind(value).push("::NUMERIC");
        }
    }
    if let Some(holder) = &query.eligible_holder {
        sql.push(" AND (projection ->> 'designatedHolder' IS NULL OR projection ->> 'designatedHolder' = ")
            .push_bind(holder).push(")");
    }
    sql.push(" ORDER BY address LIMIT ").push_bind(limit + 1);
    let rows: Vec<(Json<AgreementView>,)> = sql.build_query_as().fetch_all(pool).await?;
    let mut items: Vec<_> = rows.into_iter().map(|(Json(value),)| value).collect();
    let next = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| item.address.clone())
    } else {
        None
    };
    Ok(AgreementPage { items, next })
}

pub async fn agreement(pool: &PgPool, address: &str) -> Result<Option<AgreementView>, AppError> {
    let row: Option<(Json<AgreementView>,)> = sqlx::query_as(
        "SELECT projection || jsonb_build_object(
             'finalizedSlot', finalized_slot::TEXT, 'observedAt', observed_at)
         FROM agreements WHERE address = $1",
    )
    .bind(address)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(Json(value),)| value))
}

/// Keyset pages keep the worker's database reads bounded as the index grows.
pub async fn active_addresses(pool: &PgPool, after: &str) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT address FROM agreements
         WHERE status IN ('funded', 'active') AND address > $1 ORDER BY address LIMIT 200",
    )
    .bind(after)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(address,)| address).collect())
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database operation failed");
        Self::Storage
    }
}
