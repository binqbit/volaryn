use super::support;
use anchor_lang::prelude::Pubkey;
use std::collections::BTreeSet;
use volaryn_backend::{
    adapters::{issuer_chain::inspect_mint, prestocks},
    assets::{eligibility, Eligibility, Registry, MAINNET_GENESIS},
};

#[test]
fn every_reviewed_identity_has_captured_provider_and_mint_evidence() {
    let registry = Registry::embedded();
    assert_eq!(registry.version, 1);
    assert_eq!(registry.genesis_hash, MAINNET_GENESIS);
    let rows = prestocks::parse(support::api()).unwrap();
    let accounts = support::accounts();
    let mut identities = BTreeSet::new();
    for (index, policy) in registry.assets.iter().enumerate() {
        assert!(identities.insert(&policy.mint));
        policy.mint.parse::<Pubkey>().unwrap();
        assert!(policy.source.starts_with("https://prestocks.com/"));
        assert!(
            policy.reviewed_at < policy.reviewed_until && policy.reviewed_at < policy.max_expiry
        );
        if let Some(deadline) = policy.conversion_deadline {
            assert!(policy.expiry_buffer_seconds > 0);
            assert!(policy.max_expiry <= deadline - policy.expiry_buffer_seconds);
        }
        let row = &rows[&policy.mint];
        assert_eq!(row.name, policy.name);
        assert_eq!(row.symbol, policy.symbol);
        let mint = inspect_mint(
            &accounts["result"]["value"][index],
            1039,
            policy.reviewed_at,
        )
        .unwrap();
        assert_eq!(
            eligibility(&registry, policy, &mint, policy.reviewed_at).0,
            Eligibility::Compatible
        );
        assert_eq!(mint.current_fee.unwrap().maximum_raw, u64::MAX.to_string());
        assert!(row.market().unwrap().observed_at.is_none());
        assert!(!row.market().unwrap().units_verified);
    }
}

#[test]
fn policies_bind_precision_authorities_review_and_lifecycle_limits() {
    let registry = Registry::embedded();
    let mut policy = registry.assets[0].clone();
    let mut mint = inspect_mint(
        &support::accounts()["result"]["value"][0],
        1039,
        policy.reviewed_at,
    )
    .unwrap();
    mint.decimals = 6;
    assert_eq!(
        eligibility(&registry, &policy, &mint, policy.reviewed_at).0,
        Eligibility::Unsupported
    );
    mint.decimals = 9;
    mint.authorities.insert("freeze".into(), None);
    assert_eq!(
        eligibility(&registry, &policy, &mint, policy.reviewed_at).0,
        Eligibility::Unsupported
    );
    mint.authorities
        .insert("freeze".into(), Some(registry.issuer_authority.clone()));
    policy.max_expiry += 100;
    assert_eq!(
        eligibility(&registry, &policy, &mint, policy.reviewed_until).0,
        Eligibility::Stale
    );
    policy.conversion_deadline = Some(policy.reviewed_at + 100);
    policy.expiry_buffer_seconds = 10;
    assert_eq!(
        eligibility(&registry, &policy, &mint, policy.reviewed_at + 90).0,
        Eligibility::Expired
    );
}

#[test]
fn market_missing_values_precision_and_unit_drift_do_not_become_valuations() {
    let mut rows = support::api();
    rows[0]["tokenPrice"] = serde_json::Value::Null;
    rows[0].as_object_mut().unwrap().remove("markPrice");
    rows[0]["supply"] = serde_json::from_str("9007199254740993.125").unwrap();
    let registry = Registry::embedded();
    let parsed = prestocks::parse(rows.clone()).unwrap();
    let context = parsed[&registry.assets[0].mint].market().unwrap();
    assert!(context.token_price.is_none() && context.mark_price.is_none());
    assert_eq!(context.supply.as_deref(), Some("9007199254740993.125"));
    assert!(!context.units_verified);
    for invalid in [
        serde_json::json!("$12"),
        serde_json::json!(-1),
        serde_json::from_str("-1e-999").unwrap(),
        serde_json::json!({"value":12,"unit":"USD"}),
    ] {
        rows[0]["tokenPrice"] = invalid;
        assert!(
            prestocks::parse(rows.clone()).unwrap()[&registry.assets[0].mint]
                .market()
                .is_err()
        );
    }
    let duplicate = rows[0].clone();
    rows.as_array_mut().unwrap().push(duplicate);
    assert!(prestocks::parse(rows).is_err());
}

#[test]
fn fee_and_scaling_observations_use_chain_epoch_and_time() {
    let accounts = support::accounts();
    let openai = &accounts["result"]["value"][5];
    let old = inspect_mint(openai, 1038, 1784305799).unwrap();
    let new = inspect_mint(openai, 1039, 1784305800).unwrap();
    assert_eq!(old.current_fee.unwrap().basis_points, 50);
    assert_eq!(old.next_fee.unwrap().basis_points, 100);
    assert_eq!(new.current_fee.unwrap().basis_points, 100);
    assert!(new.next_fee.is_none());
    assert_eq!(old.display_multiplier.as_deref(), Some("1"));
    assert_eq!(new.display_multiplier.as_deref(), Some("1.4861347"));
}
