use crate::support::{
    address, signer_pubkey, to_vm_instruction, AssetFixture, Fixture, QUANTITY, WRITER_BALANCE,
};
use anchor_spl::token_2022::spl_token_2022 as token;
use token::extension::{
    transfer_fee::TransferFeeAmount, BaseStateWithExtensions, StateWithExtensions,
};
use volaryn::AgreementStatus;

#[test]
fn donated_surplus_and_withheld_fees_do_not_block_settlement_or_cleanup() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    let donate_usdc = to_vm_instruction(
        token::instruction::transfer_checked(
            &anchor_spl::token::ID,
            &fixture.writer_usdc,
            &fixture.usdc,
            &fixture.reserve,
            &signer_pubkey(&fixture.writer),
            &[],
            123,
            6,
        )
        .unwrap(),
    );
    fixture.writer_send(donate_usdc).unwrap();
    let donate_underlying = to_vm_instruction(
        token::instruction::transfer_checked(
            &token::ID,
            &fixture.holder_underlying,
            &fixture.underlying,
            &fixture.settlement,
            &signer_pubkey(&fixture.holder),
            &[],
            100,
            6,
        )
        .unwrap(),
    );
    fixture.holder_send(donate_underlying).unwrap();
    fixture.activate();
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(fixture.agreement().net_received, QUANTITY - QUANTITY / 100);
    assert_eq!(
        fixture.amount(fixture.settlement),
        QUANTITY - QUANTITY / 100 + 99
    );
    let data = fixture
        .svm
        .get_account(&address(fixture.settlement))
        .unwrap();
    let state = StateWithExtensions::<token::state::Account>::unpack(&data.data).unwrap();
    assert_eq!(
        u64::from(
            state
                .get_extension::<TransferFeeAmount>()
                .unwrap()
                .withheld_amount
        ),
        QUANTITY / 100 + 1
    );
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    assert_eq!(fixture.amount(fixture.reserve), 0);
    assert_eq!(fixture.agreement().status, AgreementStatus::Exercised);
}

#[test]
fn prefunded_token_pdas_cannot_deny_offer_creation() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    for destination in [fixture.reserve, fixture.settlement] {
        let ix = to_vm_instruction(system_interface::instruction::transfer(
            &signer_pubkey(&fixture.writer),
            &destination,
            fixture.svm.minimum_balance_for_rent_exemption(0),
        ));
        fixture.writer_send(ix).unwrap();
    }
    fixture.create();
    fixture.activate();
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
}

#[test]
fn cleanup_recovers_late_surplus_after_writer_closes_delivered_account() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture
        .writer_send(fixture.refund_instruction(false))
        .unwrap();
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    fixture
        .writer_send(to_vm_instruction(
            token::instruction::close_account(
                &token::ID,
                &fixture.settlement,
                &signer_pubkey(&fixture.writer),
                &signer_pubkey(&fixture.writer),
                &[],
            )
            .unwrap(),
        ))
        .unwrap();
    fixture
        .writer_send(to_vm_instruction(
            token::instruction::transfer_checked(
                &anchor_spl::token::ID,
                &fixture.writer_usdc,
                &fixture.usdc,
                &fixture.reserve,
                &signer_pubkey(&fixture.writer),
                &[],
                123,
                6,
            )
            .unwrap(),
        ))
        .unwrap();
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    assert_eq!(fixture.amount(fixture.reserve), 0);
    assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE);
}
