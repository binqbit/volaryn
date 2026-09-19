//! Mint and account fixtures initialized through real token instructions.

use super::{
    addresses::{address, key, signer_pubkey},
    transactions::{send, to_vm_instruction},
};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022 as token;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use token::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account, Mint},
};

#[derive(Clone, Copy)]
pub enum AssetFixture {
    Plain,
    Extended,
    Subset(u8),
    UnsupportedHook,
}

pub(super) fn create_mint(
    svm: &mut LiteSVM,
    authority: &Keypair,
    seed: u8,
    kind: Option<AssetFixture>,
) -> Pubkey {
    let mint = key(seed);
    let mint_pk = signer_pubkey(&mint);
    let auth = signer_pubkey(authority);
    let program = if kind.is_some() {
        token::ID
    } else {
        anchor_spl::token::ID
    };
    let mask = match kind {
        Some(AssetFixture::Extended) => 15,
        Some(AssetFixture::Subset(mask)) => mask,
        _ => 0,
    };
    let mut extensions: Vec<_> = [
        ExtensionType::TransferFeeConfig,
        ExtensionType::ScaledUiAmount,
        ExtensionType::Pausable,
        ExtensionType::PermanentDelegate,
    ]
    .into_iter()
    .enumerate()
    .filter(|(bit, _)| mask & (1 << bit) != 0)
    .map(|(_, extension)| extension)
    .collect();
    if matches!(kind, Some(AssetFixture::UnsupportedHook)) {
        extensions.push(ExtensionType::TransferHook);
    }
    let size = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut ixs = Vec::new();
    ixs.push(to_vm_instruction(
        system_interface::instruction::create_account(
            &auth,
            &mint_pk,
            svm.minimum_balance_for_rent_exemption(size),
            size as u64,
            &program,
        ),
    ));
    if mask & 1 != 0 {
        ixs.push(to_vm_instruction(
            token::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &program,
                &mint_pk,
                Some(&auth),
                Some(&auth),
                100,
                10_000_000,
            )
            .unwrap(),
        ));
    }
    if mask & 2 != 0 {
        ixs.push(to_vm_instruction(
            token::extension::scaled_ui_amount::instruction::initialize(
                &program,
                &mint_pk,
                Some(auth),
                1.0,
            )
            .unwrap(),
        ));
    }
    if mask & 4 != 0 {
        ixs.push(to_vm_instruction(
            token::extension::pausable::instruction::initialize(&program, &mint_pk, &auth).unwrap(),
        ));
    }
    if mask & 8 != 0 {
        ixs.push(to_vm_instruction(
            token::instruction::initialize_permanent_delegate(&program, &mint_pk, &auth).unwrap(),
        ));
    }
    if matches!(kind, Some(AssetFixture::UnsupportedHook)) {
        ixs.push(to_vm_instruction(
            token::extension::transfer_hook::instruction::initialize(
                &program,
                &mint_pk,
                Some(auth),
                Some(signer_pubkey(&key(12))),
            )
            .unwrap(),
        ));
    }
    ixs.push(to_vm_instruction(
        token::instruction::initialize_mint2(&program, &mint_pk, &auth, Some(&auth), 6).unwrap(),
    ));
    send(svm, &ixs, &[authority, &mint]).unwrap();
    mint_pk
}

pub fn create_token(
    svm: &mut LiteSVM,
    authority: &Keypair,
    seed: u8,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
    extended: bool,
) -> Pubkey {
    let account = key(seed);
    let account_pk = signer_pubkey(&account);
    let program = if extended {
        token::ID
    } else {
        anchor_spl::token::ID
    };
    let mint_data = svm.get_account(&address(mint)).unwrap();
    let state = StateWithExtensions::<Mint>::unpack(&mint_data.data).unwrap();
    let extensions =
        ExtensionType::get_required_init_account_extensions(&state.get_extension_types().unwrap());
    let size = ExtensionType::try_calculate_account_len::<Account>(&extensions).unwrap();
    let ixs = [
        to_vm_instruction(system_interface::instruction::create_account(
            &signer_pubkey(authority),
            &account_pk,
            svm.minimum_balance_for_rent_exemption(size),
            size as u64,
            &program,
        )),
        to_vm_instruction(
            token::instruction::initialize_account3(&program, &account_pk, &mint, &owner).unwrap(),
        ),
        to_vm_instruction(
            token::instruction::mint_to_checked(
                &program,
                &mint,
                &account_pk,
                &signer_pubkey(authority),
                &[],
                amount,
                6,
            )
            .unwrap(),
        ),
    ];
    send(svm, &ixs, &[authority, &account]).unwrap();
    account_pk
}
