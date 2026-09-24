use crate::support::{
    signer_pubkey, to_vm_instruction, AssetFixture, Fixture, HOLDER_UNDERLYING, HOLDER_USDC, NOW,
    PAYOUT, PREMIUM, QUANTITY,
};
use anchor_spl::token_2022::spl_token_2022 as token;
use solana_clock::Clock;

#[test]
fn every_admitted_extension_combination_settles() {
    for request in [false, true] {
        for mask in 0..16 {
            let mut fixture = if request {
                Fixture::request(AssetFixture::Subset(mask))
            } else {
                Fixture::new(AssetFixture::Subset(mask))
            };
            fixture.create();
            fixture.activate();
            let meta = fixture.holder_send(fixture.exercise_instruction()).unwrap();
            assert!(meta.compute_units_consumed < 200_000);
            let net = if mask & 1 != 0 {
                QUANTITY - QUANTITY / 100
            } else {
                QUANTITY
            };
            assert_eq!(
                fixture.agreement().net_received,
                net,
                "extension mask {mask}"
            );
            assert_eq!(
                fixture.amount(fixture.holder_usdc),
                HOLDER_USDC - PREMIUM + PAYOUT
            );
            assert_eq!(
                fixture.token(fixture.settlement).owner,
                signer_pubkey(&fixture.writer)
            );
        }
    }
}

#[test]
fn issuer_fee_and_scaling_changes_do_not_change_the_gross_obligation() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    fixture.activate();
    let fee = to_vm_instruction(
        token::extension::transfer_fee::instruction::set_transfer_fee(
            &token::ID,
            &fixture.underlying,
            &signer_pubkey(&fixture.authority),
            &[],
            500,
            10_000_000,
        )
        .unwrap(),
    );
    fixture.authority_send(fee).unwrap();
    let scaling = to_vm_instruction(
        token::extension::scaled_ui_amount::instruction::update_multiplier(
            &token::ID,
            &fixture.underlying,
            &signer_pubkey(&fixture.authority),
            &[],
            3.0,
            NOW,
        )
        .unwrap(),
    );
    fixture.authority_send(scaling).unwrap();
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.epoch += 2;
    fixture.svm.set_sysvar(&clock);
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(
        fixture.amount(fixture.holder_underlying),
        HOLDER_UNDERLYING - QUANTITY
    );
    assert_eq!(fixture.agreement().quantity_raw, QUANTITY);
    assert_eq!(fixture.agreement().net_received, QUANTITY - QUANTITY / 20);
    assert_eq!(
        fixture.amount(fixture.holder_usdc),
        HOLDER_USDC - PREMIUM + PAYOUT
    );
}

#[test]
fn full_u64_quantity_is_exact_and_fee_arithmetic_does_not_overflow() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture
        .holder_send(to_vm_instruction(
            token::instruction::burn_checked(
                &token::ID,
                &fixture.holder_underlying,
                &fixture.underlying,
                &signer_pubkey(&fixture.holder),
                &[],
                HOLDER_UNDERLYING,
                6,
            )
            .unwrap(),
        ))
        .unwrap();
    fixture
        .authority_send(to_vm_instruction(
            token::instruction::mint_to_checked(
                &token::ID,
                &fixture.underlying,
                &fixture.holder_underlying,
                &signer_pubkey(&fixture.authority),
                &[],
                u64::MAX,
                6,
            )
            .unwrap(),
        ))
        .unwrap();
    let mut terms = fixture.terms();
    terms.quantity_raw = u64::MAX;
    fixture
        .writer_send(fixture.create_instruction(terms))
        .unwrap();
    fixture.activate();
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(fixture.agreement().quantity_raw, u64::MAX);
    assert_eq!(fixture.agreement().net_received, u64::MAX - 10_000_000);
    assert_eq!(fixture.amount(fixture.holder_underlying), 0);
    assert_eq!(
        fixture.amount(fixture.holder_usdc),
        HOLDER_USDC - PREMIUM + PAYOUT
    );
}
