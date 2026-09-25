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
    let mut active = Vec::new();
    let mut after = String::new();
    loop {
        let page = store::active_addresses(&pool, &after).await.unwrap();
        assert!(page.len() <= 200);
        let Some(last) = page.last() else {
            break;
        };
        after = last.clone();
        active.extend(page);
        assert!(
            active.len() <= expected.len(),
            "Worker cursors must advance"
        );
    }
    assert_eq!(
        active, expected,
        "Reconciliation uses the same address order"
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
    let offers = store::agreements(&pool, &Default::default(), true, Some(100))
        .await
        .unwrap();
    assert!(offers.items.iter().all(|row| row.status == "open"));
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
async fn address_cursors_use_bytewise_order_under_a_linguistic_collation() {
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let linguistic_order: bool = sqlx::query_scalar("SELECT 'a'::TEXT < 'Z'::TEXT")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        linguistic_order,
        "The fixture must expose locale-sensitive ordering"
    );

    let rows: Vec<_> = ['a', 'Z', 'z', 'A']
        .into_iter()
        .map(|prefix| {
            let mut row = agreement::agreement(10, 100);
            row.address = format!("{prefix}{}", "1".repeat(42));
            row.address.parse::<Pubkey>().unwrap();
            row
        })
        .collect();
    store::upsert(&pool, &rows, 10, 100).await.unwrap();
    let expected: Vec<_> = ['A', 'Z', 'a', 'z']
        .into_iter()
        .map(|prefix| format!("{prefix}{}", "1".repeat(42)))
        .collect();

    // Both portfolio and offer cursors must use the same order as their indexes.
    for offers_only in [false, true] {
        let mut query = AgreementQuery {
            limit: Some(1),
            owner: rows[0].writer.clone(),
            ..Default::default()
        };
        for (index, address) in expected.iter().enumerate() {
            let page = store::agreements(&pool, &query, offers_only, Some(100))
                .await
                .unwrap();
            assert_eq!(page.items.len(), 1);
            assert_eq!(&page.items[0].address, address);
            assert_eq!(page.next, (index < 3).then(|| address.clone()));
            query.after = Some(address.clone());
        }
        assert!(store::agreements(&pool, &query, offers_only, Some(100))
            .await
            .unwrap()
            .items
            .is_empty());
    }
    assert_eq!(
        store::active_addresses(&pool, &expected[1]).await.unwrap(),
        expected[2..],
        "Worker cursors cross the uppercase/lowercase boundary without skipping addresses"
    );
    pool.close().await;
    database.close().await;
}

#[tokio::test]
async fn offer_matching_uses_exact_amounts_and_designated_counterparty_eligibility() {
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
            row.accept_before = "3700".into();
            if index == 1 {
                row.designated_counterparty = Some(holder.clone());
            }
            if index == 2 {
                row.designated_counterparty = Some(other.clone());
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
                row.creator = holder.clone();
                row.writer = Some(holder.clone());
                if index == 7 {
                    row.designated_counterparty = Some(holder.clone());
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
        eligible_counterparty: Some(holder.clone()),
        ..Default::default()
    };
    let page = store::agreements(&pool, &query, true, Some(100))
        .await
        .unwrap();
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
        let page = store::agreements(&pool, &paged_query, true, Some(100))
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

#[tokio::test]
async fn mixed_offer_origins_filter_before_pagination_and_require_their_own_escrow() {
    use volaryn_backend::observations::OfferSide;
    let database = database::Database::new().await;
    let pool = store::open(database.options.clone(), &support::deployment())
        .await
        .unwrap();
    let actor = Pubkey::new_unique().to_string();
    let other = Pubkey::new_unique().to_string();
    let rows: Vec<_> = (0..6)
        .map(|index| {
            let mut row = agreement::agreement(10, 100);
            row.address = Pubkey::new_unique().to_string();
            row.creator = if index == 5 {
                actor.clone()
            } else {
                other.clone()
            };
            row.side = if index == 0 {
                OfferSide::Writer
            } else {
                OfferSide::Holder
            };
            row.writer = (row.side == OfferSide::Writer).then(|| row.creator.clone());
            row.holder = (row.side == OfferSide::Holder).then(|| row.creator.clone());
            row.accept_before = "101".into();
            row.payout = "20".into();
            row.premium = "1".into();
            row.reserve_amount = match index {
                0 => "20",
                2 => "0",
                _ => "1",
            }
            .into();
            row.designated_counterparty = match index {
                3 => Some(actor.clone()),
                4 => Some(Pubkey::new_unique().to_string()),
                _ => None,
            };
            row
        })
        .collect();
    store::upsert(&pool, &rows, 10, 100).await.unwrap();
    for (side, expected_indices) in [
        (None, vec![0, 1, 3]),
        (Some(OfferSide::Writer), vec![0]),
        (Some(OfferSide::Holder), vec![1, 3]),
    ] {
        let mut query = AgreementQuery {
            side,
            eligible_counterparty: Some(actor.clone()),
            limit: Some(1),
            ..Default::default()
        };
        let mut found = Vec::new();
        loop {
            let page = store::agreements(&pool, &query, true, Some(100))
                .await
                .unwrap();
            found.extend(page.items.into_iter().map(|row| row.address));
            query.after = page.next;
            if query.after.is_none() {
                break;
            }
        }
        let mut expected: Vec<_> = expected_indices
            .into_iter()
            .map(|index| rows[index].address.clone())
            .collect();
        expected.sort();
        assert_eq!(
            found, expected,
            "Side, own-offer and counterparty eligibility apply before pagination"
        );
    }
    let owned = store::agreements(
        &pool,
        &AgreementQuery {
            owner: Some(actor.clone()),
            ..Default::default()
        },
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(owned.items.len(), 1);
    assert_eq!(owned.items[0].address, rows[5].address);
    assert!(owned.items[0].writer.is_none());
    let created = store::agreements(
        &pool,
        &AgreementQuery {
            creator: Some(actor),
            ..Default::default()
        },
        false,
        None,
    )
    .await
    .unwrap();
    assert_eq!(created.items[0].address, rows[5].address);
    assert!(
        store::agreements(&pool, &Default::default(), true, Some(101))
            .await
            .unwrap()
            .items
            .is_empty()
    );
    pool.close().await;
    database.close().await;
}
