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
