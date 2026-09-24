mod support;

use anchor_lang::{prelude::Pubkey, AccountSerialize};
use axum::{extract::State, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    future::IntoFuture,
    str::FromStr,
    sync::{Arc, Mutex},
};
use volaryn::state::AssetPolicy;
use volaryn_backend::{adapters::chain::Chain, domain::now};

struct Snapshot {
    mint: Value,
    policy: AssetPolicy,
    policy_owner: Pubkey,
    slot: u64,
    time: i64,
}

#[tokio::test]
async fn admission_requires_current_consistent_policy_and_reviewed_limits() {
    let mut deployment = support::deployment();
    let captured: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/prestocks/accounts.json")).unwrap();
    let snapshot = Arc::new(Mutex::new(Snapshot {
        mint: captured["result"]["value"][0].clone(),
        policy: AssetPolicy {
            mint: Pubkey::from_str(&deployment.assets[0].mint).unwrap(),
            token_program: anchor_spl::token_2022::ID,
            decimals: deployment.assets[0].decimals,
            version: 1,
            enabled: true,
            reviewed_until: now() + 3600,
            max_expiry: now() + 1800,
        },
        policy_owner: volaryn::ID,
        slot: 10,
        time: now(),
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let chain = Chain::new(format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(axum::serve(listener, Router::new().route("/", post(
        |State(snapshot): State<Arc<Mutex<Snapshot>>>, Json(request): Json<Value>| async move {
            let snapshot = snapshot.lock().unwrap();
            let result = match request["method"].as_str().unwrap() {
                "getEpochInfo" => json!({"epoch":1,"absoluteSlot":10,"slotIndex":0,"slotsInEpoch":10}),
                "getBlockTime" => json!(snapshot.time),
                "getMultipleAccounts" => {
                    assert_eq!(request["params"][1]["minContextSlot"], 10);
                    let mut bytes = Vec::new();
                    snapshot.policy.try_serialize(&mut bytes).unwrap();
                    json!({"context":{"slot":snapshot.slot}, "value":[snapshot.mint, {
                        "owner":snapshot.policy_owner.to_string(), "data":[STANDARD.encode(bytes),"base64"]
                    }]})
                }
                _ => panic!("Admission may only read the current mint and policy"),
            };
            Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
        }
    )).with_state(Arc::clone(&snapshot))).into_future());
    let asset = deployment.assets[0].mint.clone();
    assert!(
        chain
            .admission(&deployment, &asset)
            .await
            .unwrap()
            .new_commitments
    );
    snapshot.lock().unwrap().policy.enabled = false;
    assert!(
        !chain
            .admission(&deployment, &asset)
            .await
            .unwrap()
            .new_commitments
    );
    {
        let mut snapshot = snapshot.lock().unwrap();
        snapshot.policy.enabled = true;
        snapshot.policy.reviewed_until = now() - 1;
    }
    assert!(
        !chain
            .admission(&deployment, &asset)
            .await
            .unwrap()
            .new_commitments
    );
    snapshot.lock().unwrap().policy.reviewed_until = now() + 3600;
    for slot in [9, 20] {
        snapshot.lock().unwrap().slot = slot;
        assert!(chain.admission(&deployment, &asset).await.is_err());
    }
    snapshot.lock().unwrap().slot = 10;
    snapshot.lock().unwrap().time = now() - 120;
    assert!(chain.admission(&deployment, &asset).await.is_err());
    snapshot.lock().unwrap().time = now();
    snapshot.lock().unwrap().policy_owner = Pubkey::default();
    assert!(chain.admission(&deployment, &asset).await.is_err());
    snapshot.lock().unwrap().policy_owner = volaryn::ID;
    snapshot.lock().unwrap().policy.decimals = 0;
    assert!(chain.admission(&deployment, &asset).await.is_err());
    snapshot.lock().unwrap().policy.decimals = deployment.assets[0].decimals;
    assert!(chain
        .admission(&deployment, &Pubkey::default().to_string())
        .await
        .is_err());

    // A permissive on-chain policy cannot widen the reviewed release's admission window.
    deployment.mode = "mainnet".into();
    snapshot.lock().unwrap().policy.reviewed_until = i64::MAX;
    assert!(
        !chain
            .admission(&deployment, &asset)
            .await
            .unwrap()
            .new_commitments
    );
    server.abort();
}
