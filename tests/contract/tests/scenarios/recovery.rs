use crate::support::{
    address, assert_error, create_token, signer_pubkey, to_vm_instruction, AssetFixture, Fixture,
    NOW, QUANTITY, WRITER_BALANCE,
};
use anchor_spl::token_2022::spl_token_2022 as token;
use token::extension::{
    transfer_fee::TransferFeeAmount, BaseStateWithExtensions, StateWithExtensions,
};
use volaryn::{error::VolarynError, AgreementStatus};

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

#[test]
fn frozen_terminal_settlement_does_not_block_surplus_and_can_be_handed_off_after_thaw() {
    for request in [false, true] {
        for expired in [false, true] {
            let mut fixture = if request {
                Fixture::request(AssetFixture::Extended)
            } else {
                Fixture::new(AssetFixture::Extended)
            };
            fixture.create();
            if expired {
                fixture.activate();
                fixture.time(NOW + 200);
            }
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
            fixture.freeze(fixture.settlement, fixture.underlying, true, true);
            let holder_beneficiary = request && !expired;
            let refund = fixture.refund_instruction(expired);
            if holder_beneficiary {
                fixture.holder_send(refund).unwrap();
            } else {
                fixture.writer_send(refund).unwrap();
            }
            let (beneficiary, cash) = if holder_beneficiary {
                (signer_pubkey(&fixture.holder), fixture.holder_usdc)
            } else {
                (signer_pubkey(&fixture.writer), fixture.writer_usdc)
            };
            let balance = fixture.amount(cash);
            let terminal = fixture
                .svm
                .get_account(&address(fixture.agreement))
                .unwrap();
            let cleanup = |fixture: &mut Fixture| {
                let ix = fixture.cleanup_instruction();
                if holder_beneficiary {
                    fixture.holder_send(ix)
                } else {
                    fixture.writer_send(ix)
                }
            };
            assert_eq!(fixture.amount(fixture.reserve), 123);
            cleanup(&mut fixture).unwrap();
            assert_eq!(fixture.amount(fixture.reserve), 0);
            assert_eq!(fixture.amount(cash), balance + 123);
            assert_eq!(fixture.token(fixture.settlement).owner, fixture.agreement);
            assert!(fixture.token(fixture.settlement).is_frozen());
            cleanup(&mut fixture).unwrap();
            assert_eq!(fixture.amount(cash), balance + 123);

            fixture.freeze(fixture.settlement, fixture.underlying, true, false);
            cleanup(&mut fixture).unwrap();
            assert_eq!(fixture.token(fixture.settlement).owner, beneficiary);
            assert_eq!(fixture.amount(cash), balance + 123);
            assert_eq!(
                fixture
                    .svm
                    .get_account(&address(fixture.agreement))
                    .unwrap(),
                terminal
            );
        }
    }
}

#[test]
fn settlement_owner_changes_do_not_transfer_the_right_to_late_reserve_surplus() {
    for request in [false, true] {
        for expired in [false, true] {
            let mut fixture = if request {
                Fixture::request(AssetFixture::Extended)
            } else {
                Fixture::new(AssetFixture::Extended)
            };
            fixture.create();
            if expired {
                fixture.activate();
                fixture.time(NOW + 200);
            }
            let holder_beneficiary = request && !expired;
            let send_beneficiary = |fixture: &mut Fixture, ix| {
                if holder_beneficiary {
                    fixture.holder_send(ix)
                } else {
                    fixture.writer_send(ix)
                }
            };
            let ix = fixture.refund_instruction(expired);
            send_beneficiary(&mut fixture, ix).unwrap();
            let ix = fixture.cleanup_instruction();
            send_beneficiary(&mut fixture, ix).unwrap();
            let (beneficiary, cash) = if holder_beneficiary {
                (signer_pubkey(&fixture.holder), fixture.holder_usdc)
            } else {
                (signer_pubkey(&fixture.writer), fixture.writer_usdc)
            };
            let new_owner = signer_pubkey(&fixture.authority);
            let ix = to_vm_instruction(
                token::instruction::set_authority(
                    &token::ID,
                    &fixture.settlement,
                    Some(&new_owner),
                    token::instruction::AuthorityType::AccountOwner,
                    &beneficiary,
                    &[],
                )
                .unwrap(),
            );
            send_beneficiary(&mut fixture, ix).unwrap();
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
            let new_owner_cash = create_token(
                &mut fixture.svm,
                &fixture.authority,
                31,
                fixture.usdc,
                new_owner,
                0,
                false,
            );
            let accounts = [
                fixture.agreement,
                fixture.settlement,
                fixture.reserve,
                cash,
                new_owner_cash,
            ];
            let snapshot = |fixture: &Fixture| {
                accounts.map(|key| fixture.svm.get_account(&address(key)).unwrap())
            };
            let before = snapshot(&fixture);
            let mut unauthorized = fixture.cleanup_instruction();
            unauthorized.accounts[0].pubkey = address(new_owner);
            unauthorized.accounts[4].pubkey = address(new_owner_cash);
            assert_error(
                fixture.authority_send(unauthorized),
                VolarynError::UnauthorizedActor,
            );
            assert_eq!(snapshot(&fixture), before);

            let balance = fixture.amount(cash);
            let ix = fixture.cleanup_instruction();
            send_beneficiary(&mut fixture, ix).unwrap();
            assert_eq!(fixture.amount(fixture.reserve), 0);
            assert_eq!(fixture.amount(cash), balance + 123);
            assert_eq!(fixture.amount(new_owner_cash), 0);
            assert_eq!(fixture.token(fixture.settlement).owner, new_owner);
            assert_eq!(snapshot(&fixture)[..2], before[..2]);
        }
    }
}
