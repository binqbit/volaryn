//! Application query parameters; SQL and HTTP extraction stay at their boundaries.

use crate::domain::AppError;
use anchor_lang::prelude::Pubkey;
use serde::Deserialize;
use std::str::FromStr;
use utoipa::IntoParams;

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AgreementQuery {
    /// Last address from the previous page (exclusive).
    pub after: Option<String>,
    /// Page size, from 1 to 200. Defaults to 50.
    pub limit: Option<u16>,
    pub holder: Option<String>,
    pub writer: Option<String>,
    pub mint: Option<String>,
    pub status: Option<String>,
}

impl AgreementQuery {
    pub fn page_size(&self) -> Result<i64, AppError> {
        let limit = self.limit.unwrap_or(50);
        if !(1..=200).contains(&limit) {
            return Err(AppError::Invalid);
        }
        for value in [&self.after, &self.holder, &self.writer, &self.mint]
            .into_iter()
            .flatten()
        {
            Pubkey::from_str(value).map_err(|_| AppError::Invalid)?;
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
