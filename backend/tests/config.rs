mod support;

use volaryn_backend::config::validate_deployment;

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
    deployment.schema_version = 3;
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
