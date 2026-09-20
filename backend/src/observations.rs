//! Public deployment and chain observations. Amounts retain their exact decimal representation.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deployment {
    pub schema_version: u8,
    pub fixture_version: u8,
    pub mode: String,
    pub genesis_hash: String,
    pub program_id: String,
    pub program_sha256: String,
    pub program_length: usize,
    pub authority: String,
    pub holder: String,
    pub writer: String,
    pub usdc_mint: String,
    pub underlying_mint: String,
    pub writer_usdc: String,
    pub holder_usdc: String,
    pub holder_underlying: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgreementView {
    pub address: String,
    pub version: u8,
    pub writer: String,
    pub holder: Option<String>,
    pub designated_holder: Option<String>,
    pub underlying_mint: String,
    pub underlying_program: String,
    pub usdc_mint: String,
    pub quantity_raw: String,
    pub payout: String,
    pub premium: String,
    pub accept_before: String,
    pub expires_at: String,
    pub status: String,
    pub policy_version: u32,
    pub reserve: String,
    pub reserve_amount: String,
    pub settlement: String,
    pub net_received: String,
    pub finalized_slot: String,
    pub observed_at: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PositionView {
    pub owner: String,
    pub mint: String,
    pub token_account: String,
    pub amount_raw: String,
    pub usdc_token_account: String,
    pub usdc_amount_raw: String,
    pub decimals: u8,
    pub finalized_slot: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetView {
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub provenance: String,
}
