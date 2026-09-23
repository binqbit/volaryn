use super::{reconcile::effect_status, Activity, Operation, Status};
use anchor_lang::prelude::Pubkey;
use volaryn::state::{Agreement, AgreementStatus};

fn agreement() -> Agreement {
    Agreement {
        version: 1,
        bump: 0,
        writer: Pubkey::new_from_array([1; 32]),
        nonce: 42,
        designated_holder: None,
        holder: Some(Pubkey::new_from_array([2; 32])),
        underlying_mint: Pubkey::new_from_array([3; 32]),
        underlying_program: anchor_spl::token_2022::ID,
        underlying_decimals: 9,
        usdc_mint: Pubkey::default(),
        usdc_program: anchor_spl::token::ID,
        quantity_raw: 100,
        payout: 20,
        premium: 1,
        accept_before: 1000,
        expires_at: 2000,
        policy_version: 1,
        created_at: 100,
        activated_at: Some(200),
        settled_at: None,
        net_received: 0,
        status: AgreementStatus::Active,
    }
}
fn attempt(owner: Pubkey, operation: Operation) -> Activity {
    Activity {
        id: "1".into(),
        signature: "signature".into(),
        owner: owner.to_string(),
        agreement: "agreement".into(),
        operation,
        created_terms: None,
        last_valid_block_height: "10".into(),
        status: Status::Pending,
        created_at: 100,
        updated_at: 100,
    }
}

#[test]
fn finalized_effect_proofs_keep_holder_writer_and_repeatable_cleanup_distinct() {
    let mut agreement = agreement();
    let holder = agreement.holder.unwrap();
    assert_eq!(
        effect_status(&attempt(holder, Operation::Activate), &agreement),
        Status::Reconciled
    );
    assert_eq!(
        effect_status(&attempt(agreement.writer, Operation::Activate), &agreement),
        Status::Expired
    );
    assert_eq!(
        effect_status(&attempt(holder, Operation::Exercise), &agreement),
        Status::Expired
    );
    agreement.status = AgreementStatus::Exercised;
    assert_eq!(
        effect_status(&attempt(holder, Operation::Exercise), &agreement),
        Status::Reconciled
    );
    assert_eq!(
        effect_status(&attempt(agreement.writer, Operation::Exercise), &agreement),
        Status::Unresolved
    );
    assert_eq!(
        effect_status(&attempt(agreement.writer, Operation::Cleanup), &agreement),
        Status::Unresolved
    );
    agreement.status = AgreementStatus::Expired;
    assert_eq!(
        effect_status(&attempt(agreement.writer, Operation::Reclaim), &agreement),
        Status::Reconciled
    );
    assert_eq!(
        effect_status(&attempt(holder, Operation::Exercise), &agreement),
        Status::Expired
    );
    agreement.status = AgreementStatus::Cancelled;
    assert_eq!(
        effect_status(&attempt(agreement.writer, Operation::Cancel), &agreement),
        Status::Reconciled
    );
    assert_eq!(
        effect_status(&attempt(holder, Operation::Cancel), &agreement),
        Status::Unresolved
    );
}

#[test]
fn creation_proof_requires_all_immutable_terms() {
    let agreement = agreement();
    let mut attempt = attempt(agreement.writer, Operation::Create);
    assert_eq!(effect_status(&attempt, &agreement), Status::Unresolved);
    let terms = super::Terms {
        underlying_mint: agreement.underlying_mint.to_string(),
        nonce: agreement.nonce.to_string(),
        quantity_raw: agreement.quantity_raw.to_string(),
        payout: agreement.payout.to_string(),
        premium: agreement.premium.to_string(),
        accept_before: agreement.accept_before.to_string(),
        expires_at: agreement.expires_at.to_string(),
        designated_holder: None,
    };
    attempt.created_terms = Some(terms.clone());
    assert_eq!(effect_status(&attempt, &agreement), Status::Reconciled);
    attempt.created_terms = Some(super::Terms {
        payout: "21".into(),
        ..terms
    });
    assert_eq!(effect_status(&attempt, &agreement), Status::Unresolved);
}
