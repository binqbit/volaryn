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
        let page = store::agreements(&pool, &query, false, None).await.unwrap();
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
        None,
    )
    .await
    .unwrap();
    assert_eq!(filtered.items.len(), 50);
    assert!(filtered
        .items
        .iter()
        .all(|row| row.holder.as_ref() == Some(&holder) && row.status == "active"));
    let offers = store::agreements(&pool, &Default::default(), true, None)
        .await
        .unwrap();
    assert!(offers.items.iter().all(|row| row.status == "funded"));
    assert!(store::agreements(
        &pool,
        &AgreementQuery {
            limit: Some(201),
            ..Default::default()
        },
        false,
        None
    )
    .await
    .is_err());
    assert!(store::agreements(
        &pool,
        &AgreementQuery {
            after: Some("bad cursor".into()),
            ..Default::default()
        },
        false,
        None
    )
    .await
    .is_err());
    pool.close().await;
    database.close().await;
}

#[tokio::test]
async fn offer_matching_uses_exact_amounts_and_designated_holder_eligibility() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let holder = Pubkey::new_unique().to_string();
    let other = Pubkey::new_unique().to_string();
    let rows: Vec<_> = (0..8)
        .map(|index| {
            let mut row = agreement::agreement(10, 100);
            row.address = Pubkey::new_unique().to_string();
            row.accept_before = (volaryn_backend::domain::now() + 3600).to_string();
            if index == 1 {
                row.designated_holder = Some(holder.clone());
            }
            if index == 2 {
                row.designated_holder = Some(other.clone());
            }
            if index == 3 {
                row.quantity_raw = "9007199254740993".into();
            }
            if index == 4 {
                row.premium = "2".into();
            }
            if index == 5 {
                row.reserve_amount = "0".into();
            }
            if index >= 6 {
                row.writer = holder.clone();
                if index == 7 {
                    row.designated_holder = Some(holder.clone());
                }
            }
            row
        })
        .collect();
    store::upsert(&pool, &rows, 10, 100).await.unwrap();
    let query = AgreementQuery {
        quantity_raw: Some(u64::MAX.to_string()),
        min_payout: Some(u64::MAX.to_string()),
        max_premium: Some("1".into()),
        eligible_holder: Some(holder.clone()),
        ..Default::default()
    };
    let page = store::agreements(&pool, &query, true, None).await.unwrap();
    assert_eq!(page.items.len(), 2);
    assert!(page
        .items
        .iter()
        .all(|row| [rows[0].address.clone(), rows[1].address.clone()].contains(&row.address)));
    let mut paged_query = AgreementQuery {
        limit: Some(1),
        ..query
    };
    let mut found = Vec::new();
    loop {
        let page = store::agreements(&pool, &paged_query, true, None)
            .await
            .unwrap();
        found.extend(page.items.into_iter().map(|row| row.address));
        paged_query.after = page.next;
        if paged_query.after.is_none() {
            break;
        }
    }
    assert_eq!(
        found.len(),
        2,
        "Own offers must be excluded before pagination"
    );
    let own = store::agreements(
        &pool,
        &AgreementQuery {
            writer: Some(holder),
            ..Default::default()
        },
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        own.items.len(),
        2,
        "My offers retains the writer's own records"
    );
    assert!(store::agreement(&pool, &rows[6].address)
        .await
        .unwrap()
        .is_some());
    for invalid in ["1.2", "01", "-1", "18446744073709551616", "1 OR TRUE"] {
        assert!(AgreementQuery {
            quantity_raw: Some(invalid.into()),
            ..Default::default()
        }
        .page_size()
        .is_err());
    }
    pool.close().await;
    database.close().await;
}
