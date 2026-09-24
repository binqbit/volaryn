#[path = "support/database.rs"]
mod database;
mod support;

#[path = "support/agreement.rs"]
mod agreement;

use volaryn_backend::{
    activity::{Activity, Operation, Status, Terms},
    adapters::{activity, store},
    observations::OfferSide,
};

#[tokio::test]
async fn migrations_preserve_identity_and_exact_amounts_across_restart() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let (engine,): (String,) = sqlx::query_as("SHOW server_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        engine.starts_with("17.11"),
        "unsupported PostgreSQL: {engine}"
    );
    let (superuser, createdb, createrole): (bool, bool, bool) = sqlx::query_as(
        "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((superuser, createdb, createrole), (false, false, false));
    let agreement = agreement::agreement(u64::MAX, 1);
    store::upsert(&pool, &[agreement], u64::MAX, 1)
        .await
        .unwrap();
    for side in [OfferSide::Writer, OfferSide::Holder] {
        activity::insert(
            &pool,
            &Activity {
                id: String::new(),
                signature: format!("{}-creation", side.as_str()),
                owner: format!("{}-creator", side.as_str()),
                agreement: format!("{}-agreement", side.as_str()),
                operation: Operation::Create,
                side,
                actor_role: side,
                created_terms: Some(Terms {
                    side,
                    underlying_mint: "mint".into(),
                    nonce: u64::MAX.to_string(),
                    quantity_raw: u64::MAX.to_string(),
                    payout: u64::MAX.to_string(),
                    premium: "1".into(),
                    accept_before: "100".into(),
                    expires_at: "200".into(),
                    designated_counterparty: None,
                }),
                last_valid_block_height: u64::MAX.to_string(),
                status: Status::Pending,
                created_at: 1,
                updated_at: 1,
            },
        )
        .await
        .unwrap();
    }
    activity::update(&pool, "holder-creation", Status::Finalized)
        .await
        .unwrap();
    pool.close().await;
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    let rows = store::agreements(&pool, &Default::default(), false, None)
        .await
        .unwrap()
        .items;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].quantity_raw, "18446744073709551615");
    for side in [OfferSide::Writer, OfferSide::Holder] {
        let receipt = activity::find(&pool, &format!("{}-creation", side.as_str()))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(receipt.side, side);
        assert_eq!(receipt.actor_role, side);
        assert_eq!(receipt.last_valid_block_height, u64::MAX.to_string());
        let terms = receipt.created_terms.unwrap();
        assert_eq!(terms.side, side);
        assert_eq!(terms.payout, u64::MAX.to_string());
        assert_eq!(
            receipt.status,
            if side == OfferSide::Holder {
                Status::Finalized
            } else {
                Status::Pending
            }
        );
    }
    let (slot,): (String,) = sqlx::query_as("SELECT finalized_slot::TEXT FROM reconciliation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slot, u64::MAX.to_string());
    let (migrations,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM _sqlx_migrations WHERE success = TRUE")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(migrations as usize, sqlx::migrate!().iter().count());
    pool.close().await;
    let mut incompatible = deployment.clone();
    incompatible.genesis_hash = "different-ledger".into();
    assert!(store::open(database.options.clone(), &incompatible)
        .await
        .is_err());
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    assert_eq!(
        store::agreements(&pool, &Default::default(), false, None)
            .await
            .unwrap()
            .items[0]
            .payout,
        u64::MAX.to_string()
    );
    pool.close().await;
    database.close().await;
}

#[tokio::test]
async fn failed_batch_keeps_the_last_complete_projection() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    store::upsert(&pool, &[agreement::agreement(17, 100)], 17, 100)
        .await
        .unwrap();
    // Fail after rows have been replaced, immediately before the checkpoint commits.
    sqlx::raw_sql(
        "CREATE FUNCTION reject_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'injected write failure'; END $$;
         CREATE TRIGGER reject_reconciliation BEFORE UPDATE ON reconciliation
         FOR EACH ROW EXECUTE FUNCTION reject_reconciliation();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut replacement = agreement::agreement(18, 101);
    replacement.address = "replacement".into();
    assert!(store::upsert(&pool, &[replacement], 18, 101).await.is_err());
    let rows = store::agreements(&pool, &Default::default(), false, None)
        .await
        .unwrap()
        .items;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].address, "agreement");
    assert_eq!(rows[0].finalized_slot, "17");
    let (slot,): (String,) = sqlx::query_as("SELECT finalized_slot::TEXT FROM reconciliation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slot, "17");
    pool.close().await;
    database.close().await;
}

#[tokio::test]
async fn concurrent_startup_and_out_of_order_snapshots_preserve_the_newest_checkpoint() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let (first, second) = tokio::join!(
        store::open(database.options.clone(), &deployment),
        store::open(database.options.clone(), &deployment),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    let newest = [agreement::agreement(22, 200)];
    let stale = [agreement::agreement(21, 100)];
    let (newer, older) = tokio::join!(
        store::upsert(&first, &newest, 22, 200),
        store::upsert(&second, &stale, 21, 100),
    );
    newer.unwrap();
    older.unwrap();
    store::upsert(&first, &[], 20, 50).await.unwrap();
    let (slot, observed_at): (String, i64) =
        sqlx::query_as("SELECT finalized_slot::TEXT, observed_at FROM reconciliation")
            .fetch_one(&first)
            .await
            .unwrap();
    assert_eq!((slot.as_str(), observed_at), ("22", 200));
    let rows = store::agreements(&first, &Default::default(), false, None)
        .await
        .unwrap()
        .items;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].finalized_slot, "22");
    first.close().await;
    second.close().await;
    database.close().await;
}

#[tokio::test]
async fn changed_applied_migration_is_rejected_without_resetting_data() {
    let database = database::Database::new().await;
    let deployment = support::deployment();
    let pool = store::open(database.options.clone(), &deployment)
        .await
        .unwrap();
    store::upsert(&pool, &[], 30, 300).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET checksum = $1 WHERE version = 1")
        .bind(vec![0u8; 48])
        .execute(&pool)
        .await
        .unwrap();
    assert!(store::open(database.options.clone(), &deployment)
        .await
        .is_err());
    let (slot,): (String,) = sqlx::query_as("SELECT finalized_slot::TEXT FROM reconciliation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(slot, "30");
    pool.close().await;
    database.close().await;
}
