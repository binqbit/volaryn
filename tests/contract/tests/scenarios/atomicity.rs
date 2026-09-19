use crate::support::{
    address, signer_pubkey, to_vm_instruction, AssetFixture, Fixture, HOLDER_UNDERLYING, NOW,
    PAYOUT, PREMIUM, WRITER_BALANCE,
};
use anchor_spl::token_2022::spl_token_2022 as token;

#[test]
fn failed_payout_rolls_back_the_already_attempted_underlying_transfer() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    fixture.activate();
    fixture.freeze(fixture.holder_usdc, fixture.usdc, false, true);
    let before = [
        fixture.agreement,
        fixture.reserve,
        fixture.settlement,
        fixture.holder_underlying,
        fixture.holder_usdc,
    ]
    .map(|key| fixture.svm.get_account(&address(key)).unwrap().data);
    let err = fixture
        .holder_send(fixture.exercise_instruction())
        .unwrap_err();
    assert!(
        err.meta.logs.iter().any(|l| l.contains("TransferChecked")),
        "{err:#?}"
    );
    let after = [
        fixture.agreement,
        fixture.reserve,
        fixture.settlement,
        fixture.holder_underlying,
        fixture.holder_usdc,
    ]
    .map(|key| fixture.svm.get_account(&address(key)).unwrap().data);
    assert_eq!(before, after);
    fixture.freeze(fixture.holder_usdc, fixture.usdc, false, false);
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
}

#[test]
fn frozen_or_paused_underlying_fails_without_partial_settlement() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    fixture.activate();
    fixture.freeze(fixture.holder_underlying, fixture.underlying, true, true);
    assert!(fixture.holder_send(fixture.exercise_instruction()).is_err());
    fixture.freeze(fixture.holder_underlying, fixture.underlying, true, false);
    fixture
        .authority_send(to_vm_instruction(
            token::extension::pausable::instruction::pause(
                &token::ID,
                &fixture.underlying,
                &signer_pubkey(&fixture.authority),
                &[],
            )
            .unwrap(),
        ))
        .unwrap();
    assert!(fixture.holder_send(fixture.exercise_instruction()).is_err());
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
    assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
    // Refund has no dependency on transferring or closing issuer-restricted underlying.
    fixture.time(NOW + 200);
    fixture
        .writer_send(fixture.refund_instruction(true))
        .unwrap();
    assert_eq!(
        fixture.amount(fixture.writer_usdc),
        WRITER_BALANCE + PREMIUM
    );
}
