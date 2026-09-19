use crate::support::{
    address, assert_error, AssetFixture, Fixture, HOLDER_USDC, NOW, PAYOUT, QUANTITY,
    WRITER_BALANCE,
};
use volaryn::error::VolarynError;

#[test]
fn policy_is_rechecked_on_activation_but_cannot_veto_active_exercise() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    let mut terms = fixture.policy_terms();
    terms.enabled = false;
    fixture
        .authority_send(fixture.update_policy_instruction(terms.clone()))
        .unwrap();
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::IneligibleAsset,
    );
    fixture
        .authority_send(fixture.update_policy_instruction(fixture.policy_terms()))
        .unwrap();
    fixture.activate();
    fixture
        .authority_send(fixture.update_policy_instruction(terms))
        .unwrap();
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(fixture.agreement().quantity_raw, QUANTITY);
    assert_eq!(fixture.agreement().payout, PAYOUT);
}

#[test]
fn invalid_amounts_deadlines_and_lifecycle_limits_reject_creation() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    for field in 0..6 {
        let mut terms = fixture.terms();
        match field {
            0 => terms.quantity_raw = 0,
            1 => terms.payout = 0,
            2 => terms.premium = 0,
            3 => terms.accept_before = NOW,
            4 => terms.expires_at = terms.accept_before - 1,
            _ => terms.expires_at = NOW + 1001,
        }
        let expected = if field == 5 {
            VolarynError::IneligibleAsset
        } else {
            VolarynError::InvalidTerms
        };
        assert_error(
            fixture.writer_send(fixture.create_instruction(terms)),
            expected,
        );
        assert!(fixture
            .svm
            .get_account(&address(fixture.agreement))
            .is_none());
        assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE);
    }
    let mut terms = fixture.terms();
    terms.payout = u64::MAX;
    assert!(fixture
        .writer_send(fixture.create_instruction(terms))
        .is_err());
    assert!(fixture.svm.get_account(&address(fixture.reserve)).is_none());
}

#[test]
fn unsupported_transfer_hook_is_rejected_at_admission() {
    let mut fixture = Fixture::new(AssetFixture::UnsupportedHook);
    assert_error(
        fixture.authority_send(fixture.create_policy_instruction()),
        VolarynError::UnsupportedMint,
    );
    assert!(fixture.svm.get_account(&address(fixture.policy)).is_none());
}

#[test]
fn stale_review_or_shortened_expiry_policy_blocks_activation() {
    for stale in [false, true] {
        let mut fixture = Fixture::new(AssetFixture::Plain);
        fixture.create();
        let mut terms = fixture.policy_terms();
        if stale {
            terms.reviewed_until = NOW + 1;
        } else {
            terms.max_expiry = NOW + 199;
        }
        fixture
            .authority_send(fixture.update_policy_instruction(terms))
            .unwrap();
        if stale {
            fixture.time(NOW + 1);
        }
        assert_error(
            fixture.holder_send(fixture.activate_instruction()),
            VolarynError::IneligibleAsset,
        );
        assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC);
    }
}
