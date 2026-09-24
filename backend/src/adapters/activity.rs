use crate::activity::{Activity, ActivityPage, Status};
use crate::domain::{now, AppError};
use sqlx::{types::Json, PgPool};

const RECEIPT: &str = "jsonb_build_object('id', id::TEXT, 'signature', signature, 'owner', owner,
    'agreement', agreement, 'operation', operation, 'side', side, 'actorRole', actor_role, 'createdTerms', created_terms,
    'lastValidBlockHeight', last_valid_block_height::TEXT, 'status', status,
    'createdAt', created_at, 'updatedAt', updated_at)";

pub async fn insert(pool: &PgPool, activity: &Activity) -> Result<(), AppError> {
    let operation = serde_json::to_value(&activity.operation).map_err(|_| AppError::Storage)?;
    sqlx::query(
        "INSERT INTO activity (signature, owner, agreement, operation, side, actor_role, created_terms,
                              last_valid_block_height, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::TEXT::NUMERIC, 'pending', $9, $9)
         ON CONFLICT (signature) DO NOTHING",
    )
    .bind(&activity.signature)
    .bind(&activity.owner)
    .bind(&activity.agreement)
    .bind(operation.as_str().ok_or(AppError::Storage)?)
    .bind(activity.side.as_str())
    .bind(activity.actor_role.as_str())
    .bind(activity.created_terms.as_ref().map(Json))
    .bind(&activity.last_valid_block_height)
    .bind(activity.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find(pool: &PgPool, signature: &str) -> Result<Option<Activity>, AppError> {
    let mut sql = sqlx::QueryBuilder::new("SELECT ");
    sql.push(RECEIPT)
        .push(" FROM activity WHERE signature = ")
        .push_bind(signature);
    let row: Option<(Json<Activity>,)> = sql.build_query_as().fetch_optional(pool).await?;
    Ok(row.map(|(Json(item),)| item))
}

pub async fn page(
    pool: &PgPool,
    owner: &str,
    before: Option<i64>,
) -> Result<ActivityPage, AppError> {
    let mut sql = sqlx::QueryBuilder::new("SELECT ");
    sql.push(RECEIPT)
        .push(" FROM activity WHERE owner = ")
        .push_bind(owner);
    if let Some(id) = before {
        sql.push(" AND id < ").push_bind(id);
    }
    sql.push(" ORDER BY id DESC LIMIT 51");
    let rows: Vec<(Json<Activity>,)> = sql.build_query_as().fetch_all(pool).await?;
    let mut items: Vec<_> = rows.into_iter().map(|(Json(item),)| item).collect();
    let next = if items.len() > 50 {
        items.truncate(50);
        items.last().map(|item| item.id.clone())
    } else {
        None
    };
    let mut sql = sqlx::QueryBuilder::new("SELECT ");
    sql.push(RECEIPT)
        .push(
            " FROM activity WHERE status IN ('pending', 'provisional', 'unresolved') AND owner = ",
        )
        .push_bind(owner)
        .push(" ORDER BY id LIMIT 50");
    let rows: Vec<(Json<Activity>,)> = sql.build_query_as().fetch_all(pool).await?;
    let pending: Vec<_> = rows.into_iter().map(|(Json(item),)| item).collect();
    let addresses: Vec<_> = items
        .iter()
        .chain(&pending)
        .map(|item| &item.agreement)
        .collect();
    let indexed_agreements = sqlx::query_scalar(
        "SELECT address FROM agreements
         WHERE address = ANY($1) AND (writer = $2 OR holder = $2)
         ORDER BY address",
    )
    .bind(addresses)
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(ActivityPage {
        items,
        next,
        pending,
        indexed_agreements,
    })
}

pub async fn pending(pool: &PgPool) -> Result<Vec<Activity>, AppError> {
    let mut sql = sqlx::QueryBuilder::new("SELECT ");
    sql.push(RECEIPT).push(
        " FROM activity WHERE status IN ('pending', 'provisional', 'unresolved')
          ORDER BY checked_at, id LIMIT 10",
    );
    let rows: Vec<(Json<Activity>,)> = sql.build_query_as().fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(Json(item),)| item).collect())
}

pub async fn update(pool: &PgPool, signature: &str, status: Status) -> Result<(), AppError> {
    let status = serde_json::to_value(status).map_err(|_| AppError::Storage)?;
    sqlx::query(
        "UPDATE activity SET status = $2, checked_at = $3,
        updated_at = CASE WHEN status <> $2 THEN $3 ELSE updated_at END
        WHERE signature = $1 AND status IN ('pending', 'provisional', 'unresolved')",
    )
    .bind(signature)
    .bind(status.as_str().ok_or(AppError::Storage)?)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(())
}
