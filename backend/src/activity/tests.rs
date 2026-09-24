use super::{reconcile::effect_status, Activity, Operation, Status};
use crate::observations::OfferSide;
use anchor_lang::prelude::Pubkey;
use volaryn::state::{Agreement, AgreementStatus};

fn agreement() -> Agreement {
    Agreement {
        version: 2,
        bump: 0,
        creator: Pubkey::new_from_array([1; 32]),
        side: volaryn::state::OfferSide::Writer,
        writer: Some(Pubkey::new_from_array([1; 32])),
        nonce: 42,
        designated_counterparty: None,
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
    let actor_role = match operation {
        Operation::Activate | Operation::Exercise => OfferSide::Holder,
        _ => OfferSide::Writer,
    };
    Activity {
        id: "1".into(),
        signature: "signature".into(),
        owner: owner.to_string(),
        agreement: "agreement".into(),
        operation,
        side: OfferSide::Writer,
        actor_role,
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
        effect_status(
            &attempt(agreement.writer.unwrap(), Operation::Activate),
            &agreement
        ),
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
        effect_status(
            &attempt(agreement.writer.unwrap(), Operation::Exercise),
            &agreement
        ),
        Status::Unresolved
    );
    assert_eq!(
        effect_status(
            &attempt(agreement.writer.unwrap(), Operation::Cleanup),
            &agreement
        ),
        Status::Unresolved
    );
    agreement.status = AgreementStatus::Expired;
    assert_eq!(
        effect_status(
            &attempt(agreement.writer.unwrap(), Operation::Reclaim),
            &agreement
        ),
        Status::Reconciled
    );
    assert_eq!(
        effect_status(&attempt(holder, Operation::Exercise), &agreement),
        Status::Expired
    );
    agreement.status = AgreementStatus::Cancelled;
    assert_eq!(
        effect_status(
            &attempt(agreement.writer.unwrap(), Operation::Cancel),
            &agreement
        ),
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
    let mut attempt = attempt(agreement.writer.unwrap(), Operation::Create);
    assert_eq!(effect_status(&attempt, &agreement), Status::Unresolved);
    let terms = super::Terms {
        side: OfferSide::Writer,
        underlying_mint: agreement.underlying_mint.to_string(),
        nonce: agreement.nonce.to_string(),
        quantity_raw: agreement.quantity_raw.to_string(),
        payout: agreement.payout.to_string(),
        premium: agreement.premium.to_string(),
        accept_before: agreement.accept_before.to_string(),
        expires_at: agreement.expires_at.to_string(),
        designated_counterparty: None,
    };
    attempt.created_terms = Some(terms.clone());
    assert_eq!(effect_status(&attempt, &agreement), Status::Reconciled);
    attempt.created_terms = Some(super::Terms {
        payout: "21".into(),
        ..terms
    });
    assert_eq!(effect_status(&attempt, &agreement), Status::Unresolved);
}

#[test]
fn holder_origin_recovery_uses_creator_and_accepting_writer_roles() {
    let mut agreement = agreement();
    agreement.side = volaryn::state::OfferSide::Holder;
    agreement.creator = agreement.holder.unwrap();
    let holder = agreement.holder.unwrap();
    let writer = agreement.writer.unwrap();
    let mut activation = attempt(writer, Operation::Activate);
    activation.side = OfferSide::Holder;
    activation.actor_role = OfferSide::Writer;
    assert_eq!(effect_status(&activation, &agreement), Status::Reconciled);
    activation.owner = holder.to_string();
    assert_eq!(effect_status(&activation, &agreement), Status::Expired);
    activation.owner = writer.to_string();
    activation.actor_role = OfferSide::Holder;
    assert_eq!(effect_status(&activation, &agreement), Status::Unresolved);

    agreement.writer = None;
    agreement.activated_at = None;
    agreement.status = AgreementStatus::Open;
    activation.actor_role = OfferSide::Writer;
    assert_eq!(effect_status(&activation, &agreement), Status::Expired);
    let mut creation = attempt(holder, Operation::Create);
    creation.side = OfferSide::Holder;
    creation.actor_role = OfferSide::Holder;
    creation.created_terms = Some(super::Terms {
        side: OfferSide::Holder,
        underlying_mint: agreement.underlying_mint.to_string(),
        nonce: "42".into(),
        quantity_raw: "100".into(),
        payout: "20".into(),
        premium: "1".into(),
        accept_before: "1000".into(),
        expires_at: "2000".into(),
        designated_counterparty: None,
    });
    assert_eq!(effect_status(&creation, &agreement), Status::Reconciled);
    creation.created_terms.as_mut().unwrap().side = OfferSide::Writer;
    assert_eq!(effect_status(&creation, &agreement), Status::Unresolved);
    agreement.status = AgreementStatus::Cancelled;
    let mut cancel = attempt(holder, Operation::Cancel);
    cancel.side = OfferSide::Holder;
    cancel.actor_role = OfferSide::Holder;
    assert_eq!(effect_status(&cancel, &agreement), Status::Reconciled);
    cancel.owner = writer.to_string();
    assert_eq!(effect_status(&cancel, &agreement), Status::Unresolved);
    let mut cleanup = attempt(holder, Operation::Cleanup);
    cleanup.side = OfferSide::Holder;
    cleanup.actor_role = OfferSide::Holder;
    assert_eq!(effect_status(&cleanup, &agreement), Status::Unresolved);
}
