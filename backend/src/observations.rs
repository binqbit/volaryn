//! Public deployment and chain observations. Amounts retain their exact decimal representation.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deployment {
    pub schema_version: u8,
    pub mode: String,
    pub genesis_hash: String,
    pub program_id: String,
    pub program_sha256: String,
    pub program_length: usize,
    pub authority: String,
    pub upgrade_authority: Option<String>,
    pub usdc_mint: String,
    pub assets: Vec<AssetView>,
    /// Disposable participant identities exist only in a localnet deployment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub localnet: Option<LocalFixtures>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFixtures {
    pub fixture_version: u8,
    pub holder: String,
    pub writer: String,
    pub writer_usdc: String,
    pub holder_usdc: String,
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
    pub underlying_decimals: u8,
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

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetView {
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub reference_mint: String,
    pub source: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WalletTokenAccount {
    pub address: String,
    pub mint: String,
    pub token_program: String,
    pub amount_raw: String,
    pub frozen: bool,
    pub decimals: u8,
    pub finalized_slot: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WalletView {
    pub owner: String,
    pub accounts: Vec<WalletTokenAccount>,
}
