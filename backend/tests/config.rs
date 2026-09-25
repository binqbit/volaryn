mod support;

use volaryn_backend::config::validate_deployment;

#[test]
fn index_cadence_has_optional_defaults_and_bounded_overrides() {
    use clap::{CommandFactory, Parser};
    use volaryn_backend::config::{Config, IndexConfig};
    let defaults = IndexConfig::default();
    assert_eq!(defaults.index_poll_interval_secs, 1);
    assert_eq!(defaults.index_discovery_interval_secs, 2);
    for (name, variable, default) in [
        (
            "index_poll_interval_secs",
            "VOLARYN_INDEX_POLL_INTERVAL_SECS",
            "1",
        ),
        (
            "index_discovery_interval_secs",
            "VOLARYN_INDEX_DISCOVERY_INTERVAL_SECS",
            "2",
        ),
    ] {
        let command = Config::command();
        let argument = command
            .get_arguments()
            .find(|arg| arg.get_id() == name)
            .unwrap();
        assert_eq!(argument.get_env().unwrap(), variable);
        assert_eq!(argument.get_default_values(), &[default]);
    }
    for (poll, discovery) in [("1", "1"), ("10", "300")] {
        let config = Config::try_parse_from([
            "volaryn",
            "--index-poll-interval-secs",
            poll,
            "--index-discovery-interval-secs",
            discovery,
        ])
        .unwrap();
        assert_eq!(config.index.index_poll_interval_secs.to_string(), poll);
        assert_eq!(
            config.index.index_discovery_interval_secs.to_string(),
            discovery
        );
    }
    for (poll, discovery) in [
        ("0", "5"),
        ("11", "5"),
        ("2", "0"),
        ("2", "301"),
        ("2", "1.5"),
        ("-1", "5"),
    ] {
        assert!(Config::try_parse_from([
            "volaryn",
            "--index-poll-interval-secs",
            poll,
            "--index-discovery-interval-secs",
            discovery,
        ])
        .is_err());
    }
}

#[test]
fn fixture_manifests_require_the_explicit_localnet_build() {
    let deployment = support::deployment();
    assert_eq!(
        validate_deployment(&deployment).is_ok(),
        cfg!(feature = "localnet")
    );
}

#[test]
fn incompatible_versions_and_program_identity_fail_closed() {
    let mut deployment = support::deployment();
    deployment.schema_version = 2;
    assert!(validate_deployment(&deployment).is_err());
    deployment = support::deployment();
    deployment.program_id = "11111111111111111111111111111111".into();
    assert!(validate_deployment(&deployment).is_err());
    deployment = support::deployment();
    deployment.mode = "mainnet".into();
    assert!(validate_deployment(&deployment).is_err());
    deployment = support::deployment();
    deployment.program_length = usize::MAX;
    assert!(validate_deployment(&deployment).is_err());
    deployment = support::deployment();
    deployment.program_sha256 = "z".repeat(64);
    assert!(validate_deployment(&deployment).is_err());
}

#[test]
fn local_asset_identity_must_match_a_reviewed_reference_without_aliases() {
    let original = support::deployment();
    let mut deployment = original.clone();
    deployment.assets[0].name = "Unrelated token".into();
    assert!(volaryn_backend::config::validate_deployment(&deployment).is_err());
    deployment = original.clone();
    deployment.assets[0].decimals = 6;
    assert!(volaryn_backend::config::validate_deployment(&deployment).is_err());
    deployment = original.clone();
    deployment.assets.push(deployment.assets[0].clone());
    assert!(volaryn_backend::config::validate_deployment(&deployment).is_err());
    deployment = original.clone();
    deployment.assets[0].mint = deployment.assets[0].reference_mint.clone();
    assert!(volaryn_backend::config::validate_deployment(&deployment).is_err());
}

#[test]
fn live_manifests_bind_mainnet_currency_and_exclude_local_participants() {
    let mut deployment = support::deployment();
    deployment.mode = "mainnet".into();
    deployment.genesis_hash = volaryn_backend::assets::MAINNET_GENESIS.into();
    deployment.usdc_mint = volaryn_backend::config::MAINNET_USDC.into();
    deployment.localnet = None;
    for asset in &mut deployment.assets {
        asset.mint = asset.reference_mint.clone();
    }
    assert_eq!(
        validate_deployment(&deployment).is_ok(),
        !cfg!(feature = "localnet")
    );
    let encoded = serde_json::to_value(&deployment).unwrap();
    assert!(encoded.get("localnet").is_none());
    deployment.localnet = support::deployment().localnet;
    assert!(validate_deployment(&deployment).is_err());
    deployment.localnet = None;
    deployment.usdc_mint = support::deployment().usdc_mint;
    assert!(validate_deployment(&deployment).is_err());
    deployment.usdc_mint = volaryn_backend::config::MAINNET_USDC.into();
    deployment.genesis_hash = support::deployment().genesis_hash;
    assert!(validate_deployment(&deployment).is_err());
}

#[test]
fn connection_files_are_explicit_and_errors_do_not_disclose_credentials() {
    use clap::Parser;
    let mut config = volaryn_backend::config::Config::try_parse_from([
        "volaryn",
        "--database-url",
        "postgresql://example",
    ])
    .unwrap();
    config.database_url = None;
    let directory = tempfile::tempdir().unwrap();
    let secret = directory.path().join("connection");
    std::fs::write(&secret, "postgresql://app:private-value@db/app\n").unwrap();
    config.database_url_file = Some(secret.clone());
    assert_eq!(
        config.database_connection().unwrap(),
        "postgresql://app:private-value@db/app"
    );
    std::fs::write(&secret, "private-value\nsecond-line").unwrap();
    assert_eq!(
        config.database_connection().unwrap_err(),
        "Invalid connection secret file"
    );
    let mut live = support::deployment();
    live.mode = "mainnet".into();
    assert!(config.chain_connection(&live).is_err());
    config.rpc_url = Some("http://example.invalid/?key=private-value".into());
    assert_eq!(
        config.chain_connection(&live).unwrap_err(),
        "External RPC connections require HTTPS"
    );
    config.rpc_url = Some("https://example.invalid/?key=private-value".into());
    assert!(config.chain_connection(&live).is_ok());
}
