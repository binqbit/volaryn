#[path = "support/agreement.rs"]
mod agreement;
#[path = "support/database.rs"]
mod database;
mod support;

use anchor_lang::prelude::Pubkey;
use volaryn_backend::{adapters::store, queries::AgreementQuery};

#[tokio::test]
async fn pages_filters_and_targeted_updates_work_beyond_one_thousand_agreements() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let holder = Pubkey::new_unique().to_string();
    let rows: Vec<_> = (0..1307)
        .map(|index| {
            let mut row = agreement::agreement(10, 100);
            row.address = Pubkey::new_unique().to_string();
            if index % 2 == 0 {
                row.holder = Some(holder.clone());
                row.status = "active".into();
            }
            row
        })
        .collect();
    for batch in rows.chunks(100) {
        store::upsert(&pool, batch, 10, 100).await.unwrap();
    }
    let mut query = AgreementQuery {
        limit: Some(200),
        ..Default::default()
    };
    let mut found = Vec::new();
    loop {
        let page = store::agreements(&pool, &query, false).await.unwrap();
        assert!(page.items.len() <= 200);
        found.extend(page.items.iter().map(|row| row.address.clone()));
        query.after = page.next;
        if query.after.is_none() {
            break;
        }
    }
    let mut expected: Vec<_> = rows.iter().map(|row| row.address.clone()).collect();
    expected.sort();
    assert_eq!(
        found, expected,
        "Every address appears exactly once in key order"
    );
    let mut changed = rows[1200].clone();
    changed.status = "exercised".into();
    changed.finalized_slot = "11".into();
    changed.observed_at = 101;
    store::upsert(&pool, &[changed.clone()], 11, 101)
        .await
        .unwrap();
    assert_eq!(
        store::agreement(&pool, &changed.address)
            .await
            .unwrap()
            .unwrap()
            .status,
        "exercised"
    );
    assert!(
        store::agreement(&pool, &rows[1201].address)
            .await
            .unwrap()
            .is_some(),
        "An update cannot remove unrelated rows"
    );
    store::upsert(&pool, &[rows[1200].clone()], 10, 99)
        .await
        .unwrap();
    assert_eq!(
        store::agreement(&pool, &changed.address)
            .await
            .unwrap()
            .unwrap()
            .status,
        "exercised"
    );
    let filtered = store::agreements(
        &pool,
        &AgreementQuery {
            holder: Some(holder.clone()),
            status: Some("active".into()),
            ..Default::default()
        },
        false,
    )
    .await
    .unwrap();
    assert_eq!(filtered.items.len(), 50);
    assert!(filtered
        .items
        .iter()
        .all(|row| row.holder.as_ref() == Some(&holder) && row.status == "active"));
    let offers = store::agreements(&pool, &Default::default(), true)
        .await
        .unwrap();
    assert!(offers.items.iter().all(|row| row.status == "funded"));
    assert!(store::agreements(
        &pool,
        &AgreementQuery {
            limit: Some(201),
            ..Default::default()
        },
        false
    )
    .await
    .is_err());
    assert!(store::agreements(
        &pool,
        &AgreementQuery {
            after: Some("bad cursor".into()),
            ..Default::default()
        },
        false
    )
    .await
    .is_err());
    pool.close().await;
    database.close().await;
}
