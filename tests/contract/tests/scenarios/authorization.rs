use crate::support::{
    address, assert_error, create_token, instruction, key, send, signer_pubkey, AssetFixture,
    Fixture, HOLDER_UNDERLYING, HOLDER_USDC, PAYOUT, PREMIUM, QUANTITY,
};
use anchor_lang::prelude::Pubkey;
use solana_signer::Signer;
use volaryn::{error::VolarynError, AgreementStatus};

#[test]
fn designated_holder_and_full_delivery_are_enforced() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.designated_holder = Some(signer_pubkey(&key(4)));
    fixture
        .writer_send(fixture.create_instruction(terms))
        .unwrap();
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::WrongHolder,
    );

    let mut fixture = Fixture::new(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.quantity_raw = HOLDER_UNDERLYING + 1;
    fixture
        .writer_send(fixture.create_instruction(terms))
        .unwrap();
    fixture.activate();
    assert_error(
        fixture.holder_send(fixture.exercise_instruction()),
        VolarynError::InsufficientDelivery,
    );
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
    assert_eq!(fixture.agreement().status, AgreementStatus::Active);
}

#[test]
fn wrong_accounts_missing_signatures_and_repeated_actions_are_rejected() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture.activate();
    assert_error(
        fixture.writer_send(fixture.cleanup_instruction()),
        VolarynError::InvalidState,
    );
    for (index, replacement) in [
        (2, fixture.usdc),
        (4, fixture.writer_usdc),
        (5, fixture.settlement),
        (8, anchor_spl::token::ID),
        (6, fixture.writer_usdc),
    ] {
        let mut ix = fixture.exercise_instruction();
        ix.accounts[index].pubkey = address(replacement);
        assert!(fixture.holder_send(ix).is_err());
        assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
    }
    let mut ix = fixture.exercise_instruction();
    ix.accounts[0].is_signer = false;
    assert!(fixture.writer_send(ix).is_err());
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    // The already handed-off account also fails the PDA authority constraint.
    assert!(fixture.holder_send(fixture.exercise_instruction()).is_err());
    assert!(fixture
        .writer_send(fixture.refund_instruction(true))
        .is_err());
    assert_eq!(
        fixture.amount(fixture.holder_usdc),
        HOLDER_USDC - PREMIUM + PAYOUT
    );
}

#[test]
fn policy_authority_and_protocol_reinitialization_are_protected() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    let mut ix = fixture.update_policy_instruction(fixture.policy_terms());
    ix.accounts[0].pubkey = fixture.writer.pubkey();
    assert!(fixture.writer_send(ix).is_err());
    let program_data = Pubkey::find_program_address(
        &[volaryn::ID.as_ref()],
        &anchor_lang::solana_program::bpf_loader_upgradeable::ID,
    )
    .0;
    let ix = instruction(
        volaryn::accounts::Initialize {
            authority: signer_pubkey(&fixture.writer),
            program_data,
            config: fixture.config,
            usdc_mint: fixture.usdc,
            system_program: Pubkey::default(),
        },
        volaryn::instruction::Initialize {},
    );
    assert!(fixture.writer_send(ix).is_err());
}

#[test]
fn only_deployment_authority_can_initialize_the_protocol() {
    let mut fixture = Fixture::uninitialized();
    let program_data = Pubkey::find_program_address(
        &[volaryn::ID.as_ref()],
        &anchor_lang::solana_program::bpf_loader_upgradeable::ID,
    )
    .0;
    let ix = instruction(
        volaryn::accounts::Initialize {
            authority: signer_pubkey(&fixture.writer),
            program_data,
            config: fixture.config,
            usdc_mint: fixture.usdc,
            system_program: Pubkey::default(),
        },
        volaryn::instruction::Initialize {},
    );
    assert_error(
        fixture.writer_send(ix),
        VolarynError::UnauthorizedInitializer,
    );
    assert!(fixture.svm.get_account(&address(fixture.config)).is_none());
}

#[test]
fn holder_bound_right_cannot_be_exercised_by_another_funded_wallet() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    fixture.activate();
    let outsider = key(4);
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let cash = create_token(
        &mut fixture.svm,
        &fixture.authority,
        10,
        fixture.usdc,
        signer_pubkey(&outsider),
        0,
        false,
    );
    let tokens = create_token(
        &mut fixture.svm,
        &fixture.authority,
        11,
        fixture.underlying,
        signer_pubkey(&outsider),
        QUANTITY,
        true,
    );
    let mut ix = fixture.exercise_instruction();
    ix.accounts[0].pubkey = outsider.pubkey();
    ix.accounts[5].pubkey = address(tokens);
    ix.accounts[6].pubkey = address(cash);
    assert_error(
        send(&mut fixture.svm, &[ix], &[&outsider]),
        VolarynError::WrongHolder,
    );
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
}
