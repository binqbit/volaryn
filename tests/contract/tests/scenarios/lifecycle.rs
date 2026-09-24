use crate::support::{
    assert_error, signer_pubkey, to_vm_instruction, AssetFixture, Fixture, HOLDER_UNDERLYING,
    HOLDER_USDC, NOW, PAYOUT, PREMIUM, QUANTITY, WRITER_BALANCE,
};
use anchor_spl::token_2022::spl_token_2022 as token;
use volaryn::{error::VolarynError, AgreementStatus};

#[test]
fn writer_offline_exercise_delivers_gross_quantity_and_full_payout() {
    for kind in [AssetFixture::Plain, AssetFixture::Extended] {
        let mut fixture = Fixture::new(kind);
        fixture.create();
        assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
        assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE - PAYOUT);
        assert_eq!(fixture.token(fixture.settlement).owner, fixture.agreement);
        assert!(fixture.token(fixture.settlement).delegate.is_none());
        assert!(fixture.token(fixture.settlement).close_authority.is_none());
        fixture.activate();
        assert_eq!(
            fixture.amount(fixture.writer_usdc),
            WRITER_BALANCE - PAYOUT + PREMIUM
        );
        assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
        assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
        let meta = fixture.holder_send(fixture.exercise_instruction()).unwrap();
        assert!(
            meta.compute_units_consumed < 200_000,
            "exercise consumed {} CUs",
            meta.compute_units_consumed
        );
        let expected = if matches!(kind, AssetFixture::Extended) {
            QUANTITY - QUANTITY / 100
        } else {
            QUANTITY
        };
        assert_eq!(fixture.agreement().net_received, expected);
        assert_eq!(fixture.amount(fixture.settlement), expected);
        assert_eq!(
            fixture.amount(fixture.holder_underlying),
            HOLDER_UNDERLYING - QUANTITY
        );
        assert_eq!(
            fixture.amount(fixture.holder_usdc),
            HOLDER_USDC - PREMIUM + PAYOUT
        );
        assert_eq!(fixture.amount(fixture.reserve), 0);
        assert_eq!(
            fixture.token(fixture.settlement).owner,
            signer_pubkey(&fixture.writer)
        );
        assert_eq!(fixture.agreement().status, AgreementStatus::Exercised);
        eprintln!("exercise: {} compute units", meta.compute_units_consumed);
        // The writer can spend the custom account; discovery must not assume an ATA.
        let move_tokens = to_vm_instruction(
            token::instruction::transfer_checked(
                &token::ID,
                &fixture.settlement,
                &fixture.underlying,
                &fixture.holder_underlying,
                &signer_pubkey(&fixture.writer),
                &[],
                expected,
                6,
            )
            .unwrap(),
        );
        fixture.writer_send(move_tokens).unwrap();
        assert_eq!(fixture.amount(fixture.settlement), 0);
    }
}

#[test]
fn expiry_boundary_refunds_reserve_and_preserves_premium() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    fixture.activate();
    assert_error(
        fixture.writer_send(fixture.refund_instruction(false)),
        VolarynError::InvalidState,
    );
    assert_error(
        fixture.writer_send(fixture.refund_instruction(true)),
        VolarynError::NotExpired,
    );
    fixture.time(NOW + 200);
    assert_error(
        fixture.holder_send(fixture.exercise_instruction()),
        VolarynError::Expired,
    );
    fixture
        .writer_send(fixture.refund_instruction(true))
        .unwrap();
    assert_eq!(fixture.agreement().status, AgreementStatus::Expired);
    assert_eq!(
        fixture.amount(fixture.writer_usdc),
        WRITER_BALANCE + PREMIUM
    );
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
    assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    assert_eq!(
        fixture.token(fixture.settlement).owner,
        signer_pubkey(&fixture.writer)
    );
}

#[test]
fn exercise_immediately_before_expiry_succeeds() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture.activate();
    fixture.time(NOW + 199);
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(fixture.agreement().status, AgreementStatus::Exercised);
}

#[test]
fn cancellation_and_activation_are_mutually_exclusive() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture
        .writer_send(fixture.refund_instruction(false))
        .unwrap();
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::InvalidState,
    );
    assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE);
    // Retained agreement accounts prohibit nonce reuse after terminal settlement.
    assert!(fixture
        .writer_send(fixture.create_instruction(fixture.terms()))
        .is_err());
    assert_eq!(fixture.agreement().status, AgreementStatus::Cancelled);
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
}

#[test]
fn acceptance_deadline_is_exclusive_and_unaccepted_offer_is_recoverable() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture.time(NOW + 100);
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::AcceptanceClosed,
    );
    fixture
        .writer_send(fixture.refund_instruction(false))
        .unwrap();
    assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE);
}

#[test]
fn insufficient_premium_cannot_activate_an_offer() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.premium = HOLDER_USDC + 1;
    fixture
        .writer_send(fixture.create_instruction(terms))
        .unwrap();
    assert!(fixture.holder_send(fixture.activate_instruction()).is_err());
    assert_eq!(fixture.agreement().status, AgreementStatus::Open);
    assert_eq!(fixture.agreement().holder, None);
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC);
}
