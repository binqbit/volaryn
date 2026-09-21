mod support;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_spl::token::spl_token::state::{Account, AccountState};
use axum::{routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use volaryn_backend::{adapters::chain::Chain, domain::AppError};

fn token(mint: Pubkey, owner: Pubkey, amount: u64, frozen: bool) -> Value {
    let mut data = vec![0; Account::LEN];
    Account::pack(
        Account {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: if frozen {
                AccountState::Frozen
            } else {
                AccountState::Initialized
            },
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    json!({"pubkey":Pubkey::new_unique().to_string(),"account":{"owner":anchor_spl::token::ID.to_string(),"data":[STANDARD.encode(data),"base64"]}})
}

#[tokio::test]
async fn wallet_preserves_separate_balances_and_supports_usdc_only_writers() {
    let mut deployment = support::deployment();
    let mint = Pubkey::new_unique();
    deployment.usdc_mint = mint.to_string();
    let owner = Pubkey::new_unique();
    let values = vec![
        token(mint, owner, u64::MAX, false),
        token(mint, owner, 12, true),
        token(mint, owner, 19, false),
    ];
    let expected_addresses: Vec<_> = values
        .iter()
        .map(|value| value["pubkey"].as_str().unwrap().to_owned())
        .collect();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let rpc = Chain::new(format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/", post(move |Json(request): Json<Value>| {
            let values = values.clone();
            async move {
                assert_eq!(request["params"][2]["commitment"], "finalized");
                let selected = request["params"][1]["mint"] == mint.to_string();
                Json(json!({"jsonrpc":"2.0","id":request["id"],"result":{"context":{"slot":42},"value":if selected {values} else {vec![]}}}))
            }
        }))).await.unwrap();
    });
    let wallet = rpc.wallet(&deployment, &owner.to_string()).await.unwrap();
    assert_eq!(wallet.accounts.len(), 3);
    assert_eq!(wallet.owner, owner.to_string());
    assert!(wallet
        .accounts
        .iter()
        .all(|account| expected_addresses.contains(&account.address)
            && account.finalized_slot == "42"));
    assert!(wallet
        .accounts
        .iter()
        .any(|account| account.amount_raw == u64::MAX.to_string() && !account.frozen));
    assert!(wallet
        .accounts
        .iter()
        .any(|account| account.amount_raw == "12" && account.frozen));
    assert!(matches!(
        rpc.wallet(&deployment, &Pubkey::new_unique().to_string())
            .await,
        Err(AppError::Chain)
    ));
    assert!(matches!(
        rpc.wallet(&deployment, "invalid").await,
        Err(AppError::Invalid)
    ));
    server.abort();
}
