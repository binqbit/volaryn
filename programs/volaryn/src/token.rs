use anchor_lang::{prelude::*, solana_program::program::invoke_signed, system_program};
use anchor_spl::token_2022::spl_token_2022;
use spl_token_2022::{
    extension::{
        pausable::PausableConfig, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    instruction::{self, AuthorityType},
    state::{Account as TokenAccount, Mint},
};

use crate::error::VolarynError;

/// Admission is deliberately limited to the extension combinations covered by contract fixtures.
pub fn validate_mint(mint: &AccountInfo, require_unpaused: bool) -> Result<()> {
    require_keys_eq!(*mint.owner, spl_token_2022::ID);
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data)?;
    for extension in state.get_extension_types()? {
        require!(
            matches!(
                extension,
                ExtensionType::TransferFeeConfig
                    | ExtensionType::ScaledUiAmount
                    | ExtensionType::Pausable
                    | ExtensionType::PermanentDelegate
            ),
            VolarynError::UnsupportedMint
        );
    }
    if require_unpaused {
        if let Ok(pause) = state.get_extension::<PausableConfig>() {
            require!(!bool::from(pause.paused), VolarynError::UnsupportedMint);
        }
    }
    Ok(())
}

pub fn account_size(mint: &AccountInfo) -> Result<usize> {
    let data = mint.try_borrow_data()?;
    let mint = StateWithExtensions::<Mint>::unpack(&data)?;
    let required =
        ExtensionType::get_required_init_account_extensions(&mint.get_extension_types()?);
    Ok(ExtensionType::try_calculate_account_len::<TokenAccount>(
        &required,
    )?)
}

pub fn validate_settlement(account: &AccountInfo, authority: &Pubkey, mint: &Pubkey) -> Result<()> {
    require_keys_eq!(*account.owner, spl_token_2022::ID);
    let data = account.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccount>::unpack(&data)?;
    require_keys_eq!(state.base.owner, *authority);
    require_keys_eq!(state.base.mint, *mint);
    require!(
        state.base.delegate.is_none() && state.base.close_authority.is_none(),
        VolarynError::InvalidSettlementAccount
    );
    for extension in state.get_extension_types()? {
        require!(
            matches!(
                extension,
                ExtensionType::TransferFeeAmount | ExtensionType::PausableAccount
            ),
            VolarynError::InvalidSettlementAccount
        );
    }
    Ok(())
}

/// Allocate a custom token PDA without the ATA program's immutable-owner extension.
/// A harmless prefunding of this PDA must not prevent offer creation.
pub fn create_account<'info>(
    payer: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &Pubkey,
    token_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(*account.owner, system_program::ID);
    require!(
        account.data_is_empty(),
        VolarynError::InvalidSettlementAccount
    );
    let space = account_size(mint)?;
    let rent = Rent::get()?.minimum_balance(space);
    if account.lamports() == 0 {
        system_program::create_account(
            CpiContext::new(
                system.key(),
                system_program::CreateAccount {
                    from: payer.clone(),
                    to: account.clone(),
                },
            )
            .with_signer(&[seeds]),
            rent,
            space as u64,
            token_program.key,
        )?;
    } else {
        let top_up = rent.saturating_sub(account.lamports());
        if top_up > 0 {
            system_program::transfer(
                CpiContext::new(
                    system.key(),
                    system_program::Transfer {
                        from: payer.clone(),
                        to: account.clone(),
                    },
                ),
                top_up,
            )?;
        }
        system_program::allocate(
            CpiContext::new(
                system.key(),
                system_program::Allocate {
                    account_to_allocate: account.clone(),
                },
            )
            .with_signer(&[seeds]),
            space as u64,
        )?;
        system_program::assign(
            CpiContext::new(
                system.key(),
                system_program::Assign {
                    account_to_assign: account.clone(),
                },
            )
            .with_signer(&[seeds]),
            token_program.key,
        )?;
    }
    invoke_signed(
        &instruction::initialize_account3(token_program.key, account.key, mint.key, authority)?,
        &[account.clone(), mint.clone()],
        &[],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)] // Mirrors the token CPI's explicit account and amount contract.
pub fn transfer<'info>(
    program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    invoke_signed(
        &instruction::transfer_checked(
            program.key,
            from.key,
            mint.key,
            to.key,
            authority.key,
            &[],
            amount,
            decimals,
        )?,
        &[from.clone(), mint.clone(), to.clone(), authority.clone()],
        seeds,
    )?;
    Ok(())
}

pub fn handoff<'info>(
    program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    writer: &Pubkey,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    invoke_signed(
        &instruction::set_authority(
            program.key,
            account.key,
            Some(writer),
            AuthorityType::AccountOwner,
            authority.key,
            &[],
        )?,
        &[account.clone(), authority.clone()],
        seeds,
    )?;
    Ok(())
}
