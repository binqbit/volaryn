//! Adversarial transactions use real instructions and preserve every affected account on failure.

use crate::support::{
    address, create_token, instruction, key, send, signer_pubkey, AssetFixture, Fixture, NOW,
};
use anchor_lang::prelude::Pubkey;
use solana_instruction::Instruction;
use solana_signer::Signer;
use volaryn::{AgreementStatus, OfferSide};

#[derive(Clone, Copy, Debug)]
enum Actor {
    Authority = 1,
    Writer = 2,
    Holder = 3,
    Outsider = 4,
}

fn reject_unchanged(fixture: &mut Fixture, ix: Instruction, actor: Actor, extra: &[Pubkey]) {
    // Include account existence, owner, lamports, and all token extension bytes. Wallet SOL is
    // deliberately excluded because a rejected transaction still charges its payer a fee.
    let mut accounts = vec![
        fixture.config,
        fixture.policy,
        fixture.usdc,
        fixture.underlying,
        fixture.agreement,
        fixture.reserve,
        fixture.settlement,
        fixture.writer_usdc,
        fixture.holder_usdc,
        fixture.holder_underlying,
    ];
    accounts.extend_from_slice(extra);
    let snapshot = |fixture: &Fixture| {
        accounts
            .iter()
            .map(|account| fixture.svm.get_account(&address(*account)))
            .collect::<Vec<_>>()
    };
    let before = snapshot(fixture);
    let signer = key(actor as u8);
    assert!(
        send(&mut fixture.svm, &[ix], &[&signer]).is_err(),
        "unauthorized or invalid transaction from {actor:?} succeeded"
    );
    assert_eq!(before, snapshot(fixture));
}

fn initialize_instruction(fixture: &Fixture) -> Instruction {
    instruction(
        volaryn::accounts::Initialize {
            authority: signer_pubkey(&fixture.authority),
            program_data: Pubkey::find_program_address(
                &[volaryn::ID.as_ref()],
                &anchor_lang::solana_program::bpf_loader_upgradeable::ID,
            )
            .0,
            config: fixture.config,
            usdc_mint: fixture.usdc,
            system_program: Pubkey::default(),
        },
        volaryn::instruction::Initialize {},
    )
}

fn sibling_accounts(fixture: &Fixture, nonce: u64) -> [Pubkey; 3] {
    let agreement = Pubkey::find_program_address(
        &[
            b"agreement",
            signer_pubkey(&fixture.writer).as_ref(),
            &nonce.to_le_bytes(),
        ],
        &volaryn::ID,
    )
    .0;
    [
        agreement,
        Pubkey::find_program_address(&[b"reserve", agreement.as_ref()], &volaryn::ID).0,
        Pubkey::find_program_address(&[b"settlement", agreement.as_ref()], &volaryn::ID).0,
    ]
}

#[test]
fn configuration_cannot_be_reinitialized_and_policy_changes_require_authority() {
    let mut fixture = Fixture::uninitialized();
    let mut ix = initialize_instruction(&fixture);
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, Actor::Writer, &[]);
    fixture
        .authority_send(initialize_instruction(&fixture))
        .unwrap();
    // Use the correct deployment authority: failure must not depend on an unauthorized caller.
    let ix = initialize_instruction(&fixture);
    reject_unchanged(&mut fixture, ix, Actor::Authority, &[]);

    let mut ix = fixture.create_policy_instruction();
    ix.accounts[0].pubkey = fixture.writer.pubkey();
    reject_unchanged(&mut fixture, ix, Actor::Writer, &[]);
    let mut ix = fixture.create_policy_instruction();
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, Actor::Writer, &[]);
    fixture
        .authority_send(fixture.create_policy_instruction())
        .unwrap();
    let mut ix = fixture.update_policy_instruction(fixture.policy_terms());
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, Actor::Writer, &[]);
    fixture
        .authority_send(fixture.update_policy_instruction(fixture.policy_terms()))
        .unwrap();
}

#[test]
fn creation_rejects_unowned_funding_wrong_programs_and_mismatched_pdas_atomically() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    let sibling = sibling_accounts(&fixture, 2);
    for (index, replacement) in [
        (5, fixture.holder_usdc),
        (6, sibling[0]),
        (7, sibling[1]),
        (8, sibling[2]),
        (9, anchor_spl::token::ID),
        (10, anchor_spl::token_2022::ID),
    ] {
        let mut ix = fixture.create_instruction(fixture.terms());
        ix.accounts[index].pubkey = address(replacement);
        reject_unchanged(&mut fixture, ix, Actor::Writer, &sibling);
    }
    let mut ix = fixture.create_instruction(fixture.terms());
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, Actor::Holder, &[]);
    fixture.create();
    assert_eq!(fixture.agreement().status, AgreementStatus::Open);
}

#[test]
fn activation_cannot_redirect_premium_or_use_another_wallets_funds() {
    let mut fixture = Fixture::new(AssetFixture::Plain);
    fixture.create();
    for (index, replacement) in [(6, fixture.writer_usdc), (7, fixture.holder_usdc)] {
        let mut ix = fixture.activate_instruction();
        ix.accounts[index].pubkey = address(replacement);
        reject_unchanged(&mut fixture, ix, Actor::Holder, &[]);
    }
    let mut ix = fixture.activate_instruction();
    ix.accounts[0].is_signer = false;
    reject_unchanged(&mut fixture, ix, Actor::Writer, &[]);
    fixture.activate();
    let ix = fixture.activate_instruction();
    reject_unchanged(&mut fixture, ix, Actor::Holder, &[]);
}

#[test]
fn equally_funded_agreements_cannot_substitute_each_others_reserve_or_settlement() {
    let mut fixture = Fixture::new(AssetFixture::Extended);
    fixture.create();
    let sibling = sibling_accounts(&fixture, 2);
    let mut terms = fixture.terms();
    terms.nonce = 2;
    let mut ix = fixture.create_instruction(terms);
    for (account, pubkey) in ix.accounts[6..9].iter_mut().zip(sibling) {
        account.pubkey = address(pubkey);
    }
    fixture.writer_send(ix).unwrap();

    let mut ix = fixture.activate_instruction();
    ix.accounts[5].pubkey = address(sibling[1]);
    reject_unchanged(&mut fixture, ix, Actor::Holder, &sibling);
    let mut ix = fixture.refund_instruction(false);
    ix.accounts[3].pubkey = address(sibling[1]);
    reject_unchanged(&mut fixture, ix, Actor::Writer, &sibling);
    fixture.activate();
    for (index, replacement) in [(4, sibling[1]), (7, sibling[2])] {
        let mut ix = fixture.exercise_instruction();
        ix.accounts[index].pubkey = address(replacement);
        reject_unchanged(&mut fixture, ix, Actor::Holder, &sibling);
    }
    fixture.holder_send(fixture.exercise_instruction()).unwrap();
    for (index, replacement) in [(3, sibling[1]), (5, sibling[2])] {
        let mut ix = fixture.cleanup_instruction();
        ix.accounts[index].pubkey = address(replacement);
        reject_unchanged(&mut fixture, ix, Actor::Writer, &sibling);
    }
    fixture.writer_send(fixture.cleanup_instruction()).unwrap();
}

#[test]
fn refunds_and_terminal_cleanup_cannot_be_taken_over_or_redirected() {
    for expired in [false, true] {
        let mut fixture = Fixture::new(AssetFixture::Plain);
        let outsider = key(4);
        fixture
            .svm
            .airdrop(&outsider.pubkey(), 1_000_000_000)
            .unwrap();
        let outsider_usdc = create_token(
            &mut fixture.svm,
            &fixture.authority,
            31,
            fixture.usdc,
            signer_pubkey(&outsider),
            0,
            false,
        );
        fixture.create();
        if expired {
            fixture.activate();
            fixture.time(NOW + 200);
        }
        for cleanup in [false, true] {
            let base = if cleanup {
                fixture.cleanup_instruction()
            } else {
                fixture.refund_instruction(expired)
            };
            let mut ix = base.clone();
            ix.accounts[0].pubkey = outsider.pubkey();
            ix.accounts[4].pubkey = address(outsider_usdc);
            reject_unchanged(&mut fixture, ix, Actor::Outsider, &[outsider_usdc]);
            let mut ix = base.clone();
            ix.accounts[4].pubkey = address(outsider_usdc);
            reject_unchanged(&mut fixture, ix, Actor::Writer, &[outsider_usdc]);
            let mut ix = base.clone();
            ix.accounts[0].is_signer = false;
            reject_unchanged(&mut fixture, ix, Actor::Holder, &[outsider_usdc]);
            fixture.writer_send(base).unwrap();
        }
    }
}

#[test]
fn illegal_lifecycle_transitions_and_terminal_replays_preserve_all_accounts() {
    use AgreementStatus::{Active, Cancelled, Exercised, Expired, Open};
    for side in [OfferSide::Writer, OfferSide::Holder] {
        for status in [Open, Active, Exercised, Cancelled, Expired] {
            let mut fixture = match side {
                OfferSide::Writer => Fixture::new(AssetFixture::Plain),
                OfferSide::Holder => Fixture::request(AssetFixture::Plain),
            };
            fixture.create();
            if matches!(status, Active | Exercised | Expired) {
                fixture.activate();
            }
            match status {
                Exercised => {
                    fixture.holder_send(fixture.exercise_instruction()).unwrap();
                }
                Cancelled | Expired => {
                    if status == Expired {
                        fixture.time(NOW + 200);
                    }
                    let ix = fixture.refund_instruction(status == Expired);
                    if status == Cancelled && side == OfferSide::Holder {
                        fixture.holder_send(ix).unwrap();
                    } else {
                        fixture.writer_send(ix).unwrap();
                    }
                }
                _ => {}
            }
            assert_eq!(fixture.agreement().status, status);
            let creator = if side == OfferSide::Holder {
                Actor::Holder
            } else {
                Actor::Writer
            };
            let cleanup_actor = if status == Cancelled {
                creator
            } else {
                Actor::Writer
            };
            let actions = [
                (
                    fixture.activate_instruction(),
                    Actor::Holder,
                    status != Open || side != OfferSide::Writer,
                ),
                (
                    fixture.accept_request_instruction(),
                    Actor::Writer,
                    status != Open || side != OfferSide::Holder,
                ),
                (
                    fixture.exercise_instruction(),
                    Actor::Holder,
                    status != Active,
                ),
                (fixture.refund_instruction(false), creator, status != Open),
                (fixture.refund_instruction(true), Actor::Writer, true),
                (
                    fixture.cleanup_instruction(),
                    cleanup_actor,
                    matches!(status, Open | Active),
                ),
                (fixture.create_instruction(fixture.terms()), creator, true),
            ];
            for (ix, actor, invalid) in actions {
                if invalid {
                    reject_unchanged(&mut fixture, ix, actor, &[]);
                }
            }
        }
    }
}
