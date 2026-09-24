//! Application query parameters; SQL and HTTP extraction stay at their boundaries.

use crate::domain::AppError;
use anchor_lang::prelude::Pubkey;
use serde::Deserialize;
use std::str::FromStr;
use utoipa::{IntoParams, ToSchema};

/// Display lifecycle, including deadlines that do not mutate the stored contract state.
#[derive(Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgreementLifecycle {
    Available,
    AcceptanceEnded,
    Active,
    Exercised,
    Cancelled,
    Expired,
}

impl AgreementLifecycle {
    pub fn needs_time(self) -> bool {
        !matches!(self, Self::Exercised | Self::Cancelled)
    }
}

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AgreementQuery {
    /// Last address from the previous page (exclusive).
    pub after: Option<String>,
    /// Page size, from 1 to 200. Defaults to 50.
    pub limit: Option<u16>,
    pub holder: Option<String>,
    pub writer: Option<String>,
    /// Agreements written or held by this wallet. Applied before pagination.
    pub owner: Option<String>,
    pub mint: Option<String>,
    pub status: Option<String>,
    /// Display lifecycle evaluated against chain time; status remains the stored contract state.
    pub lifecycle: Option<AgreementLifecycle>,
    /// Exact underlying quantity in base units; offers are never resized.
    pub quantity_raw: Option<String>,
    pub min_payout: Option<String>,
    pub max_premium: Option<String>,
    /// Include unrestricted offers and offers reserved for this holder, excluding their own offers.
    pub eligible_holder: Option<String>,
}

impl AgreementQuery {
    pub fn page_size(&self) -> Result<i64, AppError> {
        let limit = self.limit.unwrap_or(50);
        if !(1..=200).contains(&limit) {
            return Err(AppError::Invalid);
        }
        for value in [
            &self.after,
            &self.holder,
            &self.writer,
            &self.owner,
            &self.mint,
            &self.eligible_holder,
        ]
        .into_iter()
        .flatten()
        {
            Pubkey::from_str(value).map_err(|_| AppError::Invalid)?;
        }
        for value in [&self.quantity_raw, &self.min_payout, &self.max_premium]
            .into_iter()
            .flatten()
        {
            let parsed = value.parse::<u64>().map_err(|_| AppError::Invalid)?;
            if parsed.to_string() != *value {
                return Err(AppError::Invalid);
            }
        }
        if self.status.as_deref().is_some_and(|status| {
            !matches!(
                status,
                "funded" | "active" | "exercised" | "cancelled" | "expired"
            )
        }) {
            return Err(AppError::Invalid);
        }
        Ok(i64::from(limit))
    }
}
