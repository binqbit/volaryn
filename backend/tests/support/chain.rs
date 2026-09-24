use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_lang::{prelude::Pubkey, AccountSerialize};
use anchor_spl::token::spl_token::state::{Account as TokenAccount, AccountState};
use axum::{extract::State, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use volaryn::state::{Agreement, AgreementStatus};

pub struct Ledger {
    pub accounts: BTreeMap<String, Value>,
    pub addresses: Vec<String>,
    pub discoveries: AtomicUsize,
    pub batches: AtomicUsize,
}

impl Ledger {
    pub fn new(count: u64) -> Arc<Self> {
        let mut accounts = BTreeMap::new();
        let mut addresses = Vec::new();
        let writer = Pubkey::new_unique();
        for nonce in 0..count {
            let (key, bump) = Pubkey::find_program_address(
                &[b"agreement", writer.as_ref(), &nonce.to_le_bytes()],
                &volaryn::ID,
            );
            let active = nonce == 0;
            let agreement = Agreement {
                version: 1,
                bump,
                writer,
                nonce,
                designated_holder: None,
                holder: Some(writer),
                underlying_mint: Pubkey::new_from_array([6; 32]),
                underlying_program: anchor_spl::token_2022::ID,
                underlying_decimals: 9,
                usdc_mint: Pubkey::default(),
                usdc_program: anchor_spl::token::ID,
                quantity_raw: 10,
                payout: 20,
                premium: 1,
                accept_before: 1800000000,
                expires_at: 1800000010,
                policy_version: 1,
                created_at: 1,
                activated_at: Some(2),
                settled_at: if active { None } else { Some(3) },
                net_received: if active { 0 } else { 10 },
                status: if active {
                    AgreementStatus::Active
                } else {
                    AgreementStatus::Exercised
                },
            };
            let mut bytes = Vec::new();
            agreement.try_serialize(&mut bytes).unwrap();
            accounts.insert(
                key.to_string(),
                json!({"owner":volaryn::ID.to_string(),"data":[STANDARD.encode(bytes),"base64"]}),
            );
            let reserve = Pubkey::find_program_address(&[b"reserve", key.as_ref()], &volaryn::ID).0;
            let token = TokenAccount {
                mint: Pubkey::default(),
                owner: key,
                amount: if active { 20 } else { 0 },
                delegate: COption::None,
                state: AccountState::Initialized,
                is_native: COption::None,
                delegated_amount: 0,
                close_authority: COption::None,
            };
            let mut bytes = vec![0; TokenAccount::LEN];
            TokenAccount::pack(token, &mut bytes).unwrap();
            accounts.insert(reserve.to_string(), json!({"owner":anchor_spl::token::ID.to_string(),"data":[STANDARD.encode(bytes),"base64"]}));
            addresses.push(key.to_string());
        }
        Arc::new(Self {
            accounts,
            addresses,
            discoveries: AtomicUsize::new(0),
            batches: AtomicUsize::new(0),
        })
    }

    pub async fn serve(self: &Arc<Self>) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new()
            .route("/", post(respond))
            .with_state(Arc::clone(self));
        (
            url,
            tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            }),
        )
    }
}

async fn respond(State(ledger): State<Arc<Ledger>>, Json(request): Json<Value>) -> Json<Value> {
    let result = match request["method"].as_str().unwrap() {
        "getGenesisHash" => json!("11111111111111111111111111111111"),
        "getMultipleAccounts"
            if crate::support::identity::response(&request, &crate::support::deployment())
                .is_some() =>
        {
            crate::support::identity::response(&request, &crate::support::deployment()).unwrap()
        }
        "getProgramAccounts" => {
            ledger.discoveries.fetch_add(1, Ordering::Relaxed);
            assert_eq!(request["params"][1]["dataSlice"]["length"], 0);
            assert_eq!(request["params"][1]["filters"][0]["memcmp"]["offset"], 0);
            let values: Vec<_> = ledger.addresses.iter().map(|key| json!({"pubkey":key,"account":{"owner":volaryn::ID.to_string(),"data":["","base64"]}})).collect();
            json!({"context":{"slot":10},"value":values})
        }
        "getMultipleAccounts" => {
            ledger.batches.fetch_add(1, Ordering::Relaxed);
            let keys = request["params"][0].as_array().unwrap();
            assert!(keys.len() <= 100 && keys.len().is_multiple_of(2));
            assert_eq!(request["params"][1]["commitment"], "finalized");
            let values: Vec<_> = keys
                .iter()
                .map(|key| {
                    ledger
                        .accounts
                        .get(key.as_str().unwrap())
                        .cloned()
                        .unwrap_or(Value::Null)
                })
                .collect();
            json!({"context":{"slot":11},"value":values})
        }
        method => panic!("Unexpected RPC method: {method}"),
    };
    Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
}
