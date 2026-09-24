//! Both origins converge on the same fully backed, holder-exercised active agreement.

use crate::support::{
    address, assert_error, create_token, send, signer_pubkey, to_vm_instruction, AssetFixture,
    Fixture, HOLDER_UNDERLYING, HOLDER_USDC, NOW, PAYOUT, PREMIUM, QUANTITY, WRITER_BALANCE,
};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022 as token;
use solana_instruction::Instruction;
use volaryn::{error::VolarynError, AgreementStatus, OfferSide};

fn snapshot(fixture: &Fixture) -> Vec<Option<solana_account::Account>> {
    [
        fixture.agreement,
        fixture.reserve,
        fixture.settlement,
        fixture.holder_usdc,
        fixture.writer_usdc,
        fixture.holder_underlying,
    ]
    .map(|account| fixture.svm.get_account(&address(account)))
    .into()
}

fn reject_unchanged(fixture: &mut Fixture, ix: Instruction, writer: bool) {
    let before = snapshot(fixture);
    let result = if writer {
        fixture.writer_send(ix)
    } else {
        fixture.holder_send(ix)
    };
    assert!(
        result.is_err(),
        "invalid request action unexpectedly succeeded"
    );
    assert_eq!(snapshot(fixture), before);
}

fn donate(fixture: &mut Fixture, amount: u64) {
    fixture
        .writer_send(to_vm_instruction(
            token::instruction::transfer_checked(
                &anchor_spl::token::ID,
                &fixture.writer_usdc,
                &fixture.usdc,
                &fixture.reserve,
                &signer_pubkey(&fixture.writer),
                &[],
                amount,
                6,
            )
            .unwrap(),
        ))
        .unwrap();
}

#[test]
fn holder_prepays_only_premium_and_provider_funds_the_same_offline_exercise() {
    for kind in [
        AssetFixture::Plain,
        AssetFixture::Extended,
        AssetFixture::PreStocks,
    ] {
        let mut fixture = Fixture::request(kind);
        fixture.create();
        let open = fixture.agreement();
        assert_eq!(open.version, 2);
        assert_eq!(open.creator, signer_pubkey(&fixture.holder));
        assert_eq!(open.side, OfferSide::Holder);
        assert_eq!(open.status, AgreementStatus::Open);
        assert_eq!(open.holder, Some(signer_pubkey(&fixture.holder)));
        assert_eq!(open.writer, None);
        assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
        assert_eq!(fixture.amount(fixture.writer_usdc), WRITER_BALANCE);
        assert_eq!(fixture.amount(fixture.reserve), PREMIUM);
        assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
        assert_eq!(fixture.amount(fixture.settlement), 0);
        fixture.activate();
        assert_eq!(
            fixture.agreement().writer,
            Some(signer_pubkey(&fixture.writer))
        );
        assert_eq!(fixture.agreement().status, AgreementStatus::Active);
        assert_eq!(
            fixture.amount(fixture.writer_usdc),
            WRITER_BALANCE - PAYOUT + PREMIUM
        );
        assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
        assert_eq!(fixture.amount(fixture.reserve), PAYOUT);
        assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
        fixture.holder_send(fixture.exercise_instruction()).unwrap();
        let net = if matches!(kind, AssetFixture::Plain) {
            QUANTITY
        } else {
            QUANTITY - QUANTITY / 100
        };
        assert_eq!(fixture.agreement().net_received, net);
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
}

#[test]
fn unaccepted_request_cancels_to_creator_and_cannot_be_accepted_or_recreated() {
    let mut fixture = Fixture::request(AssetFixture::Extended);
    fixture.create();
    donate(&mut fixture, 123);
    let mut wrong_actor = fixture.refund_instruction(false);
    wrong_actor.accounts[0].pubkey = address(signer_pubkey(&fixture.writer));
    wrong_actor.accounts[4].pubkey = address(fixture.writer_usdc);
    reject_unchanged(&mut fixture, wrong_actor, true);
    // The holder can recover an unaccepted premium after the acceptance deadline too.
    fixture.time(NOW + 200);
    fixture
        .holder_send(fixture.refund_instruction(false))
        .unwrap();
    assert_eq!(fixture.agreement().status, AgreementStatus::Cancelled);
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC);
    assert_eq!(fixture.amount(fixture.reserve), 123);
    assert_eq!(fixture.agreement().writer, None);
    let mut wrong_actor = fixture.cleanup_instruction();
    wrong_actor.accounts[0].pubkey = address(signer_pubkey(&fixture.writer));
    wrong_actor.accounts[4].pubkey = address(fixture.writer_usdc);
    reject_unchanged(&mut fixture, wrong_actor, true);
    fixture.holder_send(fixture.cleanup_instruction()).unwrap();
    fixture.holder_send(fixture.cleanup_instruction()).unwrap();
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC + 123);
    assert_eq!(
        fixture.token(fixture.settlement).owner,
        signer_pubkey(&fixture.holder)
    );
    let ix = fixture.accept_request_instruction();
    reject_unchanged(&mut fixture, ix, true);
    let ix = fixture.create_instruction(fixture.terms());
    reject_unchanged(&mut fixture, ix, false);
}

#[test]
fn accepted_request_reserves_and_surplus_belong_to_provider_at_expiry() {
    let mut fixture = Fixture::request(AssetFixture::Plain);
    fixture.create();
    donate(&mut fixture, 123);
    fixture.activate();
    assert_eq!(fixture.amount(fixture.reserve), PAYOUT + 123);
    let ix = fixture.refund_instruction(false);
    reject_unchanged(&mut fixture, ix, false);
    assert_error(
        fixture.writer_send(fixture.refund_instruction(true)),
        VolarynError::NotExpired,
    );
    fixture.time(NOW + 200);
    assert_error(
        fixture.holder_send(fixture.exercise_instruction()),
        VolarynError::Expired,
    );
    let mut ix = fixture.refund_instruction(true);
    ix.accounts[0].pubkey = address(signer_pubkey(&fixture.holder));
    ix.accounts[4].pubkey = address(fixture.holder_usdc);
    reject_unchanged(&mut fixture, ix, false);
    fixture
        .writer_send(fixture.refund_instruction(true))
        .unwrap();
    let mut ix = fixture.cleanup_instruction();
    ix.accounts[0].pubkey = address(signer_pubkey(&fixture.holder));
    ix.accounts[4].pubkey = address(fixture.holder_usdc);
    reject_unchanged(&mut fixture, ix, false);
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
    assert_eq!(
        fixture.amount(fixture.writer_usdc),
        WRITER_BALANCE + PREMIUM
    );
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC - PREMIUM);
    assert_eq!(fixture.amount(fixture.holder_underlying), HOLDER_UNDERLYING);
    assert_eq!(
        fixture.token(fixture.settlement).owner,
        signer_pubkey(&fixture.writer)
    );
    let ix = fixture.accept_request_instruction();
    reject_unchanged(&mut fixture, ix, true);
}

#[test]
fn holder_request_rejects_self_designation_self_acceptance_and_wrong_counterparty() {
    let mut fixture = Fixture::request(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.designated_counterparty = Some(signer_pubkey(&fixture.holder));
    let before = snapshot(&fixture);
    assert_error(
        fixture.holder_send(fixture.create_instruction(terms)),
        VolarynError::WriterCannotBeHolder,
    );
    assert_eq!(snapshot(&fixture), before);
    fixture.create();
    let mut ix = fixture.accept_request_instruction();
    ix.accounts[0].pubkey = address(signer_pubkey(&fixture.holder));
    ix.accounts[6].pubkey = address(fixture.holder_usdc);
    assert_error(fixture.holder_send(ix), VolarynError::WriterCannotBeHolder);
    assert_eq!(fixture.agreement().writer, None);

    let mut fixture = Fixture::request(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.designated_counterparty = Some(signer_pubkey(&fixture.authority));
    fixture
        .holder_send(fixture.create_instruction(terms))
        .unwrap();
    assert_error(
        fixture.writer_send(fixture.accept_request_instruction()),
        VolarynError::WrongCounterparty,
    );
    assert_eq!(fixture.amount(fixture.reserve), PREMIUM);
    let mut fixture = Fixture::request(AssetFixture::Plain);
    let mut terms = fixture.terms();
    terms.designated_counterparty = Some(signer_pubkey(&fixture.writer));
    fixture
        .holder_send(fixture.create_instruction(terms))
        .unwrap();
    fixture.activate();
}

#[test]
fn origin_specific_acceptance_and_exact_deadline_cannot_be_bypassed() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    assert_error(
        fixture.writer_send(fixture.accept_request_instruction()),
        VolarynError::WrongOfferSide,
    );
    let mut fixture = Fixture::request(AssetFixture::Plain);
    fixture.create();
    assert_error(
        fixture.holder_send(fixture.activate_instruction()),
        VolarynError::WrongOfferSide,
    );
    fixture.time(NOW + 100);
    assert_error(
        fixture.writer_send(fixture.accept_request_instruction()),
        VolarynError::AcceptanceClosed,
    );
    assert_eq!(fixture.agreement().status, AgreementStatus::Open);
    assert_eq!(fixture.amount(fixture.reserve), PREMIUM);
    fixture
        .holder_send(fixture.refund_instruction(false))
        .unwrap();
    let mut fixture = Fixture::request(AssetFixture::Plain);
    fixture.create();
    fixture.time(NOW + 99);
    fixture.activate();
    fixture.time(NOW + 199);
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
}

#[test]
fn paused_assets_block_acceptance_without_blocking_creator_premium_refund() {
    let mut fixture = Fixture::request(AssetFixture::Extended);
    fixture.create();
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
    assert_error(
        fixture.writer_send(fixture.accept_request_instruction()),
        VolarynError::UnsupportedMint,
    );
    assert_eq!(fixture.amount(fixture.reserve), PREMIUM);
    fixture
        .holder_send(fixture.refund_instruction(false))
        .unwrap();
    assert_eq!(fixture.amount(fixture.holder_usdc), HOLDER_USDC);
}

#[test]
fn provider_must_fund_the_full_payout_before_receiving_escrowed_premium() {
    let mut fixture = Fixture::request(AssetFixture::Plain);
    fixture.create();
    let original_cash = fixture.writer_usdc;
    fixture.writer_usdc = create_token(
        &mut fixture.svm,
        &fixture.authority,
        31,
        fixture.usdc,
        signer_pubkey(&fixture.writer),
        PAYOUT - 1,
        false,
    );
    let ix = fixture.accept_request_instruction();
    reject_unchanged(&mut fixture, ix, true);
    assert_eq!(fixture.agreement().writer, None);
    assert_eq!(fixture.amount(fixture.reserve), PREMIUM);
    fixture.writer_usdc = original_cash;
    fixture.activate();
}

#[test]
fn holder_without_the_premium_cannot_create_partial_request_state() {
    let mut fixture = Fixture::request(AssetFixture::Extended);
    let mut terms = fixture.terms();
    terms.premium = HOLDER_USDC + 1;
    let ix = fixture.create_instruction(terms);
    reject_unchanged(&mut fixture, ix, false);
    fixture.create();
}

#[test]
fn failed_acceptance_transaction_rolls_back_deposit_premium_and_role_assignment() {
    let mut fixture = Fixture::request(AssetFixture::Extended);
    fixture.create();
    let before = snapshot(&fixture);
    let failure = to_vm_instruction(system_interface::instruction::transfer(
        &signer_pubkey(&fixture.writer),
        &signer_pubkey(&fixture.holder),
        u64::MAX,
    ));
    let ix = fixture.accept_request_instruction();
    let err = send(&mut fixture.svm, &[ix, failure], &[&fixture.writer]).unwrap_err();
    assert!(
        err.meta
            .logs
            .iter()
            .filter(|line| line.contains("Instruction: TransferChecked"))
            .count()
            >= 2
    );
    assert_eq!(snapshot(&fixture), before);
    fixture.activate();
    let before = snapshot(&fixture);
    fixture.freeze(fixture.holder_usdc, fixture.usdc, false, true);
    let ix = fixture.exercise_instruction();
    reject_unchanged(&mut fixture, ix, false);
    fixture.freeze(fixture.holder_usdc, fixture.usdc, false, false);
    assert_eq!(snapshot(&fixture), before);
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
}

#[test]
fn request_acceptance_rechecks_policy_but_active_exercise_is_not_revoked() {
    for limit in 0..3 {
        let mut fixture = Fixture::request(AssetFixture::Plain);
        fixture.create();
        let mut terms = fixture.policy_terms();
        match limit {
            0 => terms.enabled = false,
            1 => terms.reviewed_until = NOW + 1,
            _ => terms.max_expiry = NOW + 199,
        }
        fixture
            .authority_send(fixture.update_policy_instruction(terms))
            .unwrap();
        if limit == 1 {
            fixture.time(NOW + 1);
        }
        assert_error(
            fixture.writer_send(fixture.accept_request_instruction()),
            VolarynError::IneligibleAsset,
        );
        fixture
            .authority_send(fixture.update_policy_instruction(fixture.policy_terms()))
            .unwrap();
        fixture.activate();
        let mut disabled = fixture.policy_terms();
        disabled.enabled = false;
        fixture
            .authority_send(fixture.update_policy_instruction(disabled))
            .unwrap();
        fixture.holder_send(fixture.exercise_instruction()).unwrap();
    }
}

#[test]
fn request_acceptance_rejects_signer_token_and_cross_agreement_substitution() {
    let mut fixture = Fixture::request(AssetFixture::Plain);
    fixture.create();
    let mut terms = fixture.terms();
    terms.nonce = 2;
    let sibling = Pubkey::find_program_address(
        &[
            b"agreement",
            fixture.creator().as_ref(),
            &2u64.to_le_bytes(),
        ],
        &volaryn::ID,
    )
    .0;
    let reserve = Pubkey::find_program_address(&[b"reserve", sibling.as_ref()], &volaryn::ID).0;
    let settlement =
        Pubkey::find_program_address(&[b"settlement", sibling.as_ref()], &volaryn::ID).0;
    let mut create = fixture.create_instruction(terms);
    for (account, key) in create.accounts[6..9]
        .iter_mut()
        .zip([sibling, reserve, settlement])
    {
        account.pubkey = address(key);
    }
    fixture.holder_send(create).unwrap();
    for (position, replacement) in [(5, reserve), (6, fixture.holder_usdc), (7, token::ID)] {
        let mut ix = fixture.accept_request_instruction();
        ix.accounts[position].pubkey = address(replacement);
        reject_unchanged(&mut fixture, ix, true);
        assert_eq!(fixture.amount(reserve), PREMIUM);
    }
    let mut ix = fixture.accept_request_instruction();
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, false);
    fixture.activate();
    let ix = fixture.accept_request_instruction();
    reject_unchanged(&mut fixture, ix, true);
}

#[test]
fn acceptance_does_not_depend_on_the_holders_original_payment_account_remaining_open() {
    let mut fixture = Fixture::request(AssetFixture::Plain);
    let original = fixture.holder_usdc;
    fixture.holder_usdc = create_token(
        &mut fixture.svm,
        &fixture.authority,
        31,
        fixture.usdc,
        signer_pubkey(&fixture.holder),
        PREMIUM,
        false,
    );
    fixture.create();
    fixture
        .holder_send(to_vm_instruction(
            token::instruction::close_account(
                &anchor_spl::token::ID,
                &fixture.holder_usdc,
                &signer_pubkey(&fixture.holder),
                &signer_pubkey(&fixture.holder),
                &[],
            )
            .unwrap(),
        ))
        .unwrap();
    fixture.activate();
    fixture.holder_usdc = original;
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
}
