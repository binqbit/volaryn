use super::validation::{admit, check_state};
use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus, AssetPolicy},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct Activate<'info> {
    pub holder: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agreement", agreement.writer.as_ref(), &agreement.nonce.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Box<Account<'info, Agreement>>,
    #[account(seeds = [b"policy", agreement.underlying_mint.as_ref()], bump)]
    pub policy: Account<'info, AssetPolicy>,
    #[account(address = agreement.underlying_mint, owner = agreement.underlying_program)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(address = agreement.usdc_mint, owner = usdc_program.key())]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [b"reserve", agreement.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = agreement,
        token::token_program = usdc_program
    )]
    pub reserve: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = holder,
        token::token_program = usdc_program
    )]
    pub holder_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = agreement.writer,
        token::token_program = usdc_program
    )]
    pub writer_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(address = agreement.usdc_program)]
    pub usdc_program: Program<'info, Token>,
}

pub fn handle_activate(ctx: Context<Activate>) -> Result<()> {
    let agreement = &mut ctx.accounts.agreement;
    check_state(agreement, AgreementStatus::Funded)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < agreement.accept_before,
        VolarynError::AcceptanceClosed
    );
    require!(
        agreement
            .designated_holder
            .is_none_or(|holder| holder == ctx.accounts.holder.key()),
        VolarynError::WrongHolder
    );
    admit(&ctx.accounts.policy, agreement.expires_at, now)?;
    token::validate_mint(&ctx.accounts.underlying_mint.to_account_info(), true)?;
    require!(
        ctx.accounts.reserve.amount >= agreement.payout,
        VolarynError::InsufficientReserve
    );
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.holder_usdc.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.writer_usdc.to_account_info(),
        &ctx.accounts.holder.to_account_info(),
        agreement.premium,
        ctx.accounts.usdc_mint.decimals,
        &[],
    )?;
    agreement.holder = Some(ctx.accounts.holder.key());
    agreement.activated_at = Some(now);
    agreement.policy_version = ctx.accounts.policy.version;
    agreement.status = AgreementStatus::Active;
    Ok(())
}
