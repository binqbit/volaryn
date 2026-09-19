use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus, AssetPolicy, AGREEMENT_VERSION},
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
