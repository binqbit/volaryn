use volaryn_backend::observations::{AgreementView, OfferSide};

pub fn agreement(slot: u64, observed_at: i64) -> AgreementView {
    let deployment = super::support::deployment();
    AgreementView {
        address: "agreement".into(),
        version: 2,
        creator: deployment.localnet.as_ref().unwrap().writer.clone(),
        side: OfferSide::Writer,
        writer: Some(deployment.localnet.as_ref().unwrap().writer.clone()),
        holder: None,
        designated_counterparty: None,
        underlying_mint: deployment.assets[0].mint.clone(),
        underlying_decimals: deployment.assets[0].decimals,
        underlying_program: "token".into(),
        usdc_mint: deployment.usdc_mint.clone(),
        quantity_raw: u64::MAX.to_string(),
        payout: u64::MAX.to_string(),
        premium: "1".into(),
        accept_before: "1800000000".into(),
        expires_at: "1800000010".into(),
        status: "open".into(),
        policy_version: 1,
        reserve: "reserve".into(),
        reserve_amount: u64::MAX.to_string(),
        settlement: "settlement".into(),
        net_received: "0".into(),
        finalized_slot: slot.to_string(),
        observed_at,
    }
}
