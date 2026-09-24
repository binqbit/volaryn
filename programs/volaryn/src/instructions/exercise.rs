use super::validation::check_state;
use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct Exercise<'info> {
    pub holder: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agreement", agreement.creator.as_ref(), &agreement.nonce.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Box<Account<'info, Agreement>>,
    #[account(address = agreement.underlying_mint, owner = underlying_program.key())]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = agreement.usdc_mint, owner = usdc_program.key())]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"reserve", agreement.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = agreement,
        token::token_program = usdc_program
    )]
    pub reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = holder,
        token::token_program = underlying_program
    )]
    pub holder_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = holder,
        token::token_program = usdc_program
    )]
    pub holder_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"settlement", agreement.key().as_ref()],
        bump,
        token::mint = underlying_mint,
        token::authority = agreement,
        token::token_program = underlying_program
    )]
    pub settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = agreement.underlying_program)]
    pub underlying_program: Program<'info, Token2022>,
    #[account(address = agreement.usdc_program)]
    pub usdc_program: Program<'info, Token>,
}

pub fn handle_exercise(ctx: Context<Exercise>) -> Result<()> {
    let agreement = &ctx.accounts.agreement;
    check_state(agreement, AgreementStatus::Active)?;
    require!(
        agreement.holder == Some(ctx.accounts.holder.key()),
        VolarynError::WrongHolder
    );
    let writer = agreement.writer.ok_or(VolarynError::InvalidState)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now < agreement.expires_at, VolarynError::Expired);
    require!(
        ctx.accounts.reserve.amount >= agreement.payout,
        VolarynError::InsufficientReserve
    );
    require!(
        ctx.accounts.holder_underlying.amount >= agreement.quantity_raw,
        VolarynError::InsufficientDelivery
    );
    token::validate_mint(&ctx.accounts.underlying_mint.to_account_info(), false)?;
    token::validate_settlement(
        &ctx.accounts.settlement.to_account_info(),
        &agreement.key(),
        &agreement.underlying_mint,
    )?;
    let before = ctx.accounts.settlement.amount;
    token::transfer(
        &ctx.accounts.underlying_program.to_account_info(),
        &ctx.accounts.holder_underlying.to_account_info(),
        &ctx.accounts.underlying_mint.to_account_info(),
        &ctx.accounts.settlement.to_account_info(),
        &ctx.accounts.holder.to_account_info(),
        agreement.quantity_raw,
        agreement.underlying_decimals,
        &[],
    )?;
    ctx.accounts.settlement.reload()?;
    let credited = ctx
        .accounts
        .settlement
        .amount
        .checked_sub(before)
        .ok_or(VolarynError::ArithmeticOverflow)?;
    let nonce = agreement.nonce.to_le_bytes();
    let bump = [agreement.bump];
    let seeds: &[&[u8]] = &[b"agreement", agreement.creator.as_ref(), &nonce, &bump];
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.holder_usdc.to_account_info(),
        &agreement.to_account_info(),
        agreement.payout,
        ctx.accounts.usdc_mint.decimals,
        &[seeds],
    )?;
    token::handoff(
        &ctx.accounts.underlying_program.to_account_info(),
        &ctx.accounts.settlement.to_account_info(),
        &agreement.to_account_info(),
        &writer,
        &[seeds],
    )?;
    let agreement = &mut ctx.accounts.agreement;
    agreement.status = AgreementStatus::Exercised;
    agreement.settled_at = Some(now);
    agreement.net_received = credited;
    Ok(())
}
