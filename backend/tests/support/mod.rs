use sha2::{Digest, Sha256};
use volaryn_backend::observations::Deployment;

pub fn deployment() -> Deployment {
    let identity = "11111111111111111111111111111111".to_owned();
    Deployment {
        schema_version: 2,
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
        assets: vec![{
            let reference = volaryn_backend::assets::Registry::embedded()
                .assets
                .remove(0);
            volaryn_backend::observations::AssetView {
                mint: anchor_lang::prelude::Pubkey::new_from_array([6; 32]).to_string(),
                reference_mint: reference.mint,
                symbol: reference.symbol,
                name: reference.name,
                decimals: reference.decimals,
                source: reference.source,
            }
        }],
        writer_usdc: identity.clone(),
        holder_usdc: identity.clone(),
    }
}
