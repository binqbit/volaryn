mod support;
use volaryn_backend::release::Release;

#[test]
fn real_assets_require_a_matching_identifiable_non_fixture_release() {
    let mut deployment = support::deployment();
    deployment.mode = "mainnet".into();
    deployment.program_sha256 = "b".repeat(64);
    let mut release = Release {
        version: "0.1.0",
        revision: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        program_sha256: Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        localnet: false,
    };
    release.verify(&deployment).unwrap();
    deployment.program_sha256 = "c".repeat(64);
    assert!(release.verify(&deployment).is_err());
    deployment.program_sha256 = "b".repeat(64);
    release.localnet = true;
    assert!(release.verify(&deployment).is_err());
    release.localnet = false;
    release.revision = None;
    assert!(release.verify(&deployment).is_err());
    release.revision = Some("not-a-source-revision");
    assert!(release.verify(&deployment).is_err());
    // Native local iteration does not claim to be a promoted release.
    deployment.mode = "localnet".into();
    release.verify(&deployment).unwrap();
}
