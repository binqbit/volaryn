use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus, AssetPolicy, OfferSide, AGREEMENT_VERSION},
};
use anchor_lang::prelude::*;

pub(super) fn admit(policy: &AssetPolicy, expiry: i64, now: i64) -> Result<()> {
    require!(
        policy.enabled && now < policy.reviewed_until && expiry <= policy.max_expiry,
        VolarynError::IneligibleAsset
    );
    Ok(())
}

pub(super) fn check_state(agreement: &Agreement, expected: AgreementStatus) -> Result<()> {
    require_eq!(
        agreement.version,
        AGREEMENT_VERSION,
        VolarynError::UnsupportedVersion
    );
    require!(agreement.status == expected, VolarynError::InvalidState);
    Ok(())
}

pub(super) fn check_acceptance(
    agreement: &Agreement,
    side: OfferSide,
    counterparty: Pubkey,
    now: i64,
) -> Result<()> {
    check_state(agreement, AgreementStatus::Open)?;
    require!(agreement.side == side, VolarynError::WrongOfferSide);
    require_keys_neq!(
        agreement.creator,
        counterparty,
        VolarynError::WriterCannotBeHolder
    );
    require!(
        now < agreement.accept_before,
        VolarynError::AcceptanceClosed
    );
    require!(
        agreement
            .designated_counterparty
            .is_none_or(|designated| designated == counterparty),
        VolarynError::WrongCounterparty
    );
    Ok(())
}

pub(super) fn record_activation(
    agreement: &mut Agreement,
    counterparty: Pubkey,
    now: i64,
    policy_version: u32,
) {
    match agreement.side {
        OfferSide::Writer => agreement.holder = Some(counterparty),
        OfferSide::Holder => agreement.writer = Some(counterparty),
    }
    agreement.activated_at = Some(now);
    agreement.policy_version = policy_version;
    agreement.status = AgreementStatus::Active;
}
