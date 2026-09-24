use anchor_lang::prelude::*;

pub const AGREEMENT_VERSION: u8 = 2;

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_program: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct AssetPolicy {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub version: u32,
    pub enabled: bool,
    pub reviewed_until: i64,
    pub max_expiry: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum AgreementStatus {
    Open,
    Active,
    Exercised,
    Cancelled,
    Expired,
}

/// The role of the creator; the opposite role accepts the open agreement.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum OfferSide {
    Writer,
    Holder,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Agreement {
    pub version: u8,
    pub bump: u8,
    pub creator: Pubkey,
    pub side: OfferSide,
    pub nonce: u64,
    pub designated_counterparty: Option<Pubkey>,
    pub writer: Option<Pubkey>,
    pub holder: Option<Pubkey>,
    pub underlying_mint: Pubkey,
    pub underlying_program: Pubkey,
    pub underlying_decimals: u8,
    pub usdc_mint: Pubkey,
    pub usdc_program: Pubkey,
    /// Gross debit from the holder, independent of issuer fees and UI scaling.
    pub quantity_raw: u64,
    pub payout: u64,
    pub premium: u64,
    pub accept_before: i64,
    pub expires_at: i64,
    pub policy_version: u32,
    pub created_at: i64,
    pub activated_at: Option<i64>,
    pub settled_at: Option<i64>,
    pub net_received: u64,
    pub status: AgreementStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OfferTerms {
    pub nonce: u64,
    pub side: OfferSide,
    pub designated_counterparty: Option<Pubkey>,
    pub quantity_raw: u64,
    pub payout: u64,
    pub premium: u64,
    pub accept_before: i64,
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PolicyTerms {
    pub enabled: bool,
    pub reviewed_until: i64,
    pub max_expiry: i64,
}
