use sha2::{Digest, Sha256};
use volaryn_backend::observations::Deployment;

pub fn deployment() -> Deployment {
    let identity = "11111111111111111111111111111111".to_owned();
    Deployment {
        schema_version: 1,
        fixture_version: 1,
        mode: "localnet".into(),
        genesis_hash: identity.clone(),
        program_id: volaryn::ID.to_string(),
        program_sha256: format!("{:x}", Sha256::digest([7])),
        program_length: 1,
        authority: identity.clone(),
        holder: identity.clone(),
        writer: identity.clone(),
        usdc_mint: identity.clone(),
        underlying_mint: identity.clone(),
        writer_usdc: identity.clone(),
        holder_usdc: identity.clone(),
        holder_underlying: identity,
    }
}
