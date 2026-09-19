//! Explicit conversions between the Anchor and VM SDK address types.

use anchor_lang::prelude::Pubkey;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

pub fn key(seed: u8) -> Keypair {
    Keypair::new_from_array([seed; 32])
}

pub fn signer_pubkey(key: &Keypair) -> Pubkey {
    anchor_pubkey(key.pubkey())
}

pub fn anchor_pubkey(key: Address) -> Pubkey {
    Pubkey::new_from_array(key.to_bytes())
}

pub fn address(key: Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &volaryn::ID).0
}
