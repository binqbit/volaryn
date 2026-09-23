//! Ordinary transfers with the extension set observed on official PreStocks mints.

use crate::support::{
    assert_error, signer_pubkey, to_vm_instruction, AssetFixture, Fixture, HOLDER_UNDERLYING,
    HOLDER_USDC, PAYOUT, PREMIUM, QUANTITY,
};
use anchor_spl::token_2022::spl_token_2022 as token;
use volaryn::error::VolarynError;

#[test]
fn prestocks_configuration_settles_with_nine_decimals_and_hands_off_tokens() {
    let mut fixture = Fixture::new(AssetFixture::PreStocks);
    fixture.create();
    fixture.activate();
    let result = fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert!(result.compute_units_consumed < 200_000);
    assert_eq!(fixture.agreement().underlying_decimals, 9);
    assert_eq!(fixture.agreement().net_received, QUANTITY - QUANTITY / 100);
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
}

#[test]
fn frozen_default_blocks_new_commitments_without_vetoing_existing_delivery() {
    let mut fixture = Fixture::new(AssetFixture::PreStocks);
    fixture.create();
    let change = |state| {
        to_vm_instruction(
            token::extension::default_account_state::instruction::update_default_account_state(
                &token::ID,
                &fixture.underlying,
                &signer_pubkey(&fixture.authority),
                &[],
                &state,
            )
            .unwrap(),
        )
    };
    let freeze = change(token::state::AccountState::Frozen);
    let thaw = change(token::state::AccountState::Initialized);
    fixture.authority_send(freeze.clone()).unwrap();
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::UnsupportedMint,
    );
    fixture.authority_send(thaw).unwrap();
    fixture.activate();
    fixture.authority_send(freeze).unwrap();
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    assert_eq!(
        fixture.amount(fixture.holder_usdc),
        HOLDER_USDC - PREMIUM + PAYOUT
    );
}

#[test]
fn enabling_an_unreviewed_hook_cannot_partially_settle() {
    let mut fixture = Fixture::new(AssetFixture::PreStocks);
    fixture.create();
    fixture.activate();
    fixture
        .authority_send(to_vm_instruction(
            token::extension::transfer_hook::instruction::update(
                &token::ID,
                &fixture.underlying,
                &signer_pubkey(&fixture.authority),
                &[],
                Some(signer_pubkey(&fixture.writer)),
            )
            .unwrap(),
        ))
        .unwrap();
    assert_error(
        fixture.holder_send(fixture.exercise_instruction()),
        VolarynError::UnsupportedMint,
    );
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
    assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
}
