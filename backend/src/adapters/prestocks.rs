//! Consume only documented/observed public fields; missing numbers never become zero.

use crate::assets::MarketContext;
use anchor_lang::prelude::Pubkey;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, str::FromStr};

#[derive(Deserialize)]
pub struct ProviderAsset {
    pub contract_address: String,
    pub name: String,
    pub symbol: String,
    #[serde(flatten)]
    fields: BTreeMap<String, Value>,
}

impl ProviderAsset {
    pub fn market(&self) -> Result<MarketContext, &'static str> {
        let number = |field| match self.fields.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(number))
                if !number.to_string().starts_with('-')
                    && number.as_f64().is_some_and(|n| n.is_finite()) =>
            {
                Ok(Some(number.to_string()))
            }
            _ => Err("invalid_response"),
        };
        Ok(MarketContext {
            token_price: number("tokenPrice")?,
            mark_price: number("markPrice")?,
            implied_valuation: number("impliedValuation")?,
            mark_valuation: number("markValuation")?,
            supply: number("supply")?,
            observed_at: None,
            units_verified: false,
        })
    }
}

pub fn parse(value: Value) -> Result<BTreeMap<String, ProviderAsset>, &'static str> {
    let rows: Vec<Value> = serde_json::from_value(value).map_err(|_| "invalid_response")?;
    if rows.is_empty() || rows.len() > 200 {
        return Err("invalid_response");
    }
    let mut assets = BTreeMap::new();
    for row in rows {
        let asset: ProviderAsset = serde_json::from_value(row).map_err(|_| "invalid_response")?;
        Pubkey::from_str(&asset.contract_address).map_err(|_| "invalid_response")?;
        if asset.name.is_empty()
            || asset.name.len() > 160
            || asset.symbol.is_empty()
            || asset.symbol.len() > 32
        {
            return Err("invalid_response");
        }
        if assets
            .insert(asset.contract_address.clone(), asset)
            .is_some()
        {
            return Err("invalid_response");
        }
    }
    Ok(assets)
}
