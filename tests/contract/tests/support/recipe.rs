//! Keep the Rust scenario vocabulary aligned with the shared localnet recipe.

use super::{HOLDER_UNDERLYING, HOLDER_USDC, PAYOUT, PREMIUM, QUANTITY, WRITER_BALANCE};
use std::sync::OnceLock;

pub fn verify() {
    static VERIFIED: OnceLock<()> = OnceLock::new();
    VERIFIED.get_or_init(|| {
        let recipe: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/recipe.json")).unwrap();
        assert_eq!(recipe["version"], 1);
        assert_eq!(recipe["decimals"], 6);
        for (name, amount) in [
            ("quantityRaw", QUANTITY),
            ("payout", PAYOUT),
            ("premium", PREMIUM),
            ("writerBalance", WRITER_BALANCE),
            ("holderUsdc", HOLDER_USDC),
            ("holderUnderlying", HOLDER_UNDERLYING),
        ] {
            assert_eq!(
                recipe[name].as_str().unwrap().parse::<u64>().unwrap(),
                amount
            );
        }
        for (name, seed) in [
            ("authority", 1),
            ("writer", 2),
            ("holder", 3),
            ("usdc", 5),
            ("underlying", 6),
            ("writerUsdc", 7),
            ("holderUsdc", 8),
            ("holderUnderlying", 9),
        ] {
            assert_eq!(recipe["seeds"][name], seed);
        }
    });
}
