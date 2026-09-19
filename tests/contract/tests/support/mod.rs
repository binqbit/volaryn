//! Shared test vocabulary; fixture construction never mutates financial state directly.

mod addresses;
mod fixture;
mod instructions;
mod ledger;
mod tokens;
mod transactions;

pub use addresses::{address, key, signer_pubkey};
pub use fixture::Fixture;
pub use tokens::{create_token, AssetFixture};
pub use transactions::{assert_error, instruction, send, to_vm_instruction};

pub const NOW: i64 = 1_800_000_000;
pub const QUANTITY: u64 = 1_000_000;
pub const PAYOUT: u64 = 20_000_000;
pub const PREMIUM: u64 = 500_000;
pub const WRITER_BALANCE: u64 = 100_000_000;
pub const HOLDER_USDC: u64 = 1_000_000;
pub const HOLDER_UNDERLYING: u64 = 2_000_000;
