//! Real loader/config/mint encodings shared by deterministic chain tests.
use anchor_lang::{prelude::Pubkey, solana_program::program_pack::Pack, AccountSerialize};
use anchor_spl::token::spl_token::state::Mint;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use volaryn_backend::observations::Deployment;

pub fn accounts(deployment: &Deployment) -> Vec<Value> {
    let loader = anchor_lang::solana_program::bpf_loader_upgradeable::ID;
    let program_data = Pubkey::find_program_address(&[volaryn::ID.as_ref()], &loader).0;
    let mut pointer = 2u32.to_le_bytes().to_vec();
    pointer.extend(program_data.as_ref());
    let mut code = 3u32.to_le_bytes().to_vec();
    code.extend(0u64.to_le_bytes());
    code.push(u8::from(deployment.upgrade_authority.is_some()));
    code.extend(
        deployment
            .upgrade_authority
            .as_ref()
            .map(|value| value.parse::<Pubkey>().unwrap())
            .unwrap_or_default()
            .as_ref(),
    );
    code.push(7);
    let mut config = Vec::new();
    volaryn::state::ProtocolConfig {
        authority: deployment.authority.parse().unwrap(),
        usdc_mint: deployment.usdc_mint.parse().unwrap(),
        usdc_program: anchor_spl::token::ID,
    }
    .try_serialize(&mut config)
    .unwrap();
    let mut currency = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            decimals: 6,
            is_initialized: true,
            ..Mint::default()
        },
        &mut currency,
    )
    .unwrap();
    [
        (loader, pointer, true), (loader, code, false),
        (volaryn::ID, config, false), (anchor_spl::token::ID, currency, false),
    ].into_iter().map(|(owner, bytes, executable)| json!({"owner":owner.to_string(),"executable":executable,"data":[STANDARD.encode(bytes),"base64"]})).collect()
}

pub fn response(request: &Value, deployment: &Deployment) -> Option<Value> {
    (request["method"] == "getMultipleAccounts" && request["params"][0][0] == deployment.program_id)
        .then(|| json!({"context":{"slot":10},"value":accounts(deployment)}))
}
