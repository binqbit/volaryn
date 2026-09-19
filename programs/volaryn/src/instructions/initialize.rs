use crate::{error::VolarynError, state::ProtocolConfig};
use anchor_lang::{prelude::*, solana_program::bpf_loader_upgradeable};
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [crate::ID.as_ref()], bump,
        seeds::program = bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ VolarynError::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        owner = anchor_spl::token::ID,
        constraint = usdc_mint.decimals == 6 @ VolarynError::InvalidSettlementCurrency
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.config.set_inner(ProtocolConfig {
        authority: ctx.accounts.authority.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        usdc_program: anchor_spl::token::ID,
    });
    Ok(())
}
