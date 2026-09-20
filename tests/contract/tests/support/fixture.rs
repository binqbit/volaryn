//! Assemble a fresh VM and disposable participants for each scenario.

use super::{
    addresses::{address, anchor_pubkey, key, pda, signer_pubkey},
    tokens::{create_mint, create_token, AssetFixture},
    transactions::{instruction, send},
    HOLDER_UNDERLYING, HOLDER_USDC, NOW, WRITER_BALANCE,
};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022 as token;
use litesvm::LiteSVM;
use solana_address::Address;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_loader_v3_interface::state::UpgradeableLoaderState;
use solana_signer::Signer;
use std::path::PathBuf;

pub struct Fixture {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub writer: Keypair,
    pub holder: Keypair,
    pub usdc: Pubkey,
    pub underlying: Pubkey,
    pub writer_usdc: Pubkey,
    pub holder_usdc: Pubkey,
    pub holder_underlying: Pubkey,
    pub config: Pubkey,
    pub policy: Pubkey,
    pub agreement: Pubkey,
    pub reserve: Pubkey,
    pub settlement: Pubkey,
}

impl Fixture {
    pub fn new(kind: AssetFixture) -> Self {
        Self::build(kind, true)
    }

    pub fn uninitialized() -> Self {
        Self::build(AssetFixture::Plain, false)
    }

    fn build(kind: AssetFixture, initialized: bool) -> Self {
        super::recipe::verify();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut svm = LiteSVM::new()
            .with_sigverify(true)
            .with_blockhash_check(true);
        svm.add_program_from_file(
            address(anchor_spl::token::ID),
            root.join("target/fixtures/spl_token-3.5.0.so"),
        )
        .unwrap();
        svm.add_program_from_file(
            address(token::ID),
            root.join("target/fixtures/spl_token_2022-11.0.0.so"),
        )
        .unwrap();
        svm.add_program_from_file(address(volaryn::ID), root.join("target/deploy/volaryn.so"))
            .expect("build the SBF program with tools/test-host first");
        let authority = key(1);
        let writer = key(2);
        let holder = key(3);
        for signer in [&authority, &writer, &holder] {
            svm.airdrop(&signer.pubkey(), 10_000_000_000).unwrap();
        }
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = NOW;
        clock.epoch = 10;
        svm.set_sysvar(&clock);
        // Model deployment metadata only. Agreement and token states are created through instructions.
        let loader = address(anchor_lang::solana_program::bpf_loader_upgradeable::ID);
        let program_data = Address::find_program_address(&[volaryn::ID.as_ref()], &loader).0;
        let mut data = svm.get_account(&program_data).unwrap();
        let metadata = bincode::serialize(&UpgradeableLoaderState::ProgramData {
            slot: clock.slot,
            upgrade_authority_address: Some(authority.pubkey()),
        })
        .unwrap();
        data.data[..metadata.len()].copy_from_slice(&metadata);
        svm.set_account(program_data, data).unwrap();
        let usdc = create_mint(&mut svm, &authority, 5, None);
        let underlying = create_mint(&mut svm, &authority, 6, Some(kind));
        let writer_usdc = create_token(
            &mut svm,
            &authority,
            7,
            usdc,
            signer_pubkey(&writer),
            WRITER_BALANCE,
            false,
        );
        let holder_usdc = create_token(
            &mut svm,
            &authority,
            8,
            usdc,
            signer_pubkey(&holder),
            HOLDER_USDC,
            false,
        );
        let holder_underlying = create_token(
            &mut svm,
            &authority,
            9,
            underlying,
            signer_pubkey(&holder),
            HOLDER_UNDERLYING,
            true,
        );
        let config = pda(&[b"config"]);
        let policy = pda(&[b"policy", underlying.as_ref()]);
        let agreement = pda(&[
            b"agreement",
            signer_pubkey(&writer).as_ref(),
            &1u64.to_le_bytes(),
        ]);
        let reserve = pda(&[b"reserve", agreement.as_ref()]);
        let settlement = pda(&[b"settlement", agreement.as_ref()]);
        let ix = instruction(
            volaryn::accounts::Initialize {
                authority: signer_pubkey(&authority),
                program_data: anchor_pubkey(program_data),
                config,
                usdc_mint: usdc,
                system_program: Pubkey::default(),
            },
            volaryn::instruction::Initialize {},
        );
        if initialized {
            send(&mut svm, &[ix], &[&authority]).unwrap();
        }
        let mut fixture = Self {
            svm,
            authority,
            writer,
            holder,
            usdc,
            underlying,
            writer_usdc,
            holder_usdc,
            holder_underlying,
            config,
            policy,
            agreement,
            reserve,
            settlement,
        };
        if initialized && !matches!(kind, AssetFixture::UnsupportedHook) {
            let ix = fixture.create_policy_instruction();
            fixture.authority_send(ix).unwrap();
        }
        fixture
    }
}
