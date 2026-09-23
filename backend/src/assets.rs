//! Reviewed issuer identities and read-only observations, separate from settlement authority.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;

pub const PRESTOCKS_API: &str = "https://prestocks.com/api/prestocks";
pub const MAINNET_RPC: &str = "https://api.mainnet-beta.solana.com";
pub const MAINNET_GENESIS: &str = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub version: u8,
    pub genesis_hash: String,
    pub token_program: String,
    pub issuer_authority: String,
    pub extensions: Vec<String>,
    pub assets: Vec<ReviewedAsset>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedAsset {
    pub mint: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub source: String,
    pub reviewed_at: i64,
    pub reviewed_until: i64,
    pub max_expiry: i64,
    pub conversion_deadline: Option<i64>,
    pub expiry_buffer_seconds: i64,
}

impl Registry {
    pub fn embedded() -> Self {
        serde_json::from_str(include_str!("../../config/assets.json"))
            .expect("reviewed asset registry is validated by tests")
    }
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketContext {
    pub token_price: Option<String>,
    pub mark_price: Option<String>,
    pub implied_valuation: Option<String>,
    pub mark_valuation: Option<String>,
    pub supply: Option<String>,
    /// The public response supplies no price timestamp or verified price/display-unit contract.
    pub observed_at: Option<i64>,
    pub units_verified: bool,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeSchedule {
    pub epoch: String,
    pub basis_points: u16,
    pub maximum_raw: String,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MintEvidence {
    pub token_program: String,
    pub decimals: u8,
    pub supply_raw: String,
    pub extensions: Vec<String>,
    pub authorities: BTreeMap<String, Option<String>>,
    pub current_fee: Option<FeeSchedule>,
    pub next_fee: Option<FeeSchedule>,
    pub display_multiplier: Option<String>,
    pub next_display_multiplier: Option<String>,
    pub multiplier_effective_at: Option<i64>,
    pub transparent_transfer_supported: bool,
    pub restrictions: Vec<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Fresh,
    Stale,
    Unavailable,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceObservation {
    pub status: SourceStatus,
    pub received_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Eligibility {
    Compatible,
    Unsupported,
    Unreviewed,
    Expired,
    Stale,
    Unavailable,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OfficialAsset {
    pub mint: String,
    pub name: String,
    pub symbol: String,
    pub eligibility: Eligibility,
    pub reason: String,
    pub policy: Option<ReviewedAsset>,
    pub market: Option<MarketContext>,
    pub chain: Option<MintEvidence>,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OfficialCatalog {
    pub network: String,
    pub genesis_hash: String,
    pub source: String,
    pub market_source: SourceObservation,
    pub chain_source: SourceObservation,
    pub finalized_slot: Option<String>,
    pub assets: Vec<OfficialAsset>,
}

pub fn eligibility(
    registry: &Registry,
    policy: &ReviewedAsset,
    mint: &MintEvidence,
    now: i64,
) -> (Eligibility, String) {
    if policy
        .conversion_deadline
        .is_some_and(|deadline| now >= deadline - policy.expiry_buffer_seconds)
        || now >= policy.max_expiry
    {
        return (
            Eligibility::Expired,
            "The reviewed protection deadline has passed".into(),
        );
    }
    if now < policy.reviewed_at || now >= policy.reviewed_until {
        return (
            Eligibility::Stale,
            "The asset policy needs a new issuer review".into(),
        );
    }
    if !mint.transparent_transfer_supported
        || mint.token_program != registry.token_program
        || mint.decimals != policy.decimals
        || mint.extensions != registry.extensions
        || mint
            .authorities
            .values()
            .any(|authority| authority.as_deref() != Some(&registry.issuer_authority))
    {
        return (
            Eligibility::Unsupported,
            "Mint behavior or authorities differ from the reviewed configuration".into(),
        );
    }
    (Eligibility::Compatible, "Reviewed for transparent transfers; a matching on-chain policy and released deployment are still required for trading".into())
}
