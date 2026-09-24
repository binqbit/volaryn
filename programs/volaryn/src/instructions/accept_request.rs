use super::validation::{admit, check_acceptance, record_activation};
use crate::{
    error::VolarynError,
    state::{Agreement, AssetPolicy, OfferSide},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};

/// The holder's premium is already escrowed; the provider supplies the full payout.
#[derive(Accounts)]
pub struct AcceptRequest<'info> {
    pub writer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agreement", agreement.creator.as_ref(), &agreement.nonce.to_le_bytes()],
        bump = agreement.bump,
        constraint = agreement.side == OfferSide::Holder @ VolarynError::WrongOfferSide
    )]
    pub agreement: Box<Account<'info, Agreement>>,
    #[account(seeds = [b"policy", agreement.underlying_mint.as_ref()], bump)]
    pub policy: Account<'info, AssetPolicy>,
    #[account(address = agreement.underlying_mint, owner = agreement.underlying_program)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    #[account(address = agreement.usdc_mint, owner = usdc_program.key())]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
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
        token::authority = writer,
        token::token_program = usdc_program
    )]
    pub writer_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(address = agreement.usdc_program)]
    pub usdc_program: Program<'info, Token>,
}

pub fn handle_accept_request(ctx: Context<AcceptRequest>) -> Result<()> {
    let agreement = &ctx.accounts.agreement;
    let now = Clock::get()?.unix_timestamp;
    check_acceptance(agreement, OfferSide::Holder, ctx.accounts.writer.key(), now)?;
    admit(&ctx.accounts.policy, agreement.expires_at, now)?;
    token::validate_mint(&ctx.accounts.underlying_mint.to_account_info(), true)?;
    require!(
        ctx.accounts.reserve.amount >= agreement.premium,
        VolarynError::InsufficientReserve
    );
    // Deposit before releasing the premium. Any failed CPI rolls back both transfers.
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.writer_usdc.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.writer.to_account_info(),
        agreement.payout,
        ctx.accounts.usdc_mint.decimals,
        &[],
    )?;
    let nonce = agreement.nonce.to_le_bytes();
    let bump = [agreement.bump];
    let seeds: &[&[u8]] = &[b"agreement", agreement.creator.as_ref(), &nonce, &bump];
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.writer_usdc.to_account_info(),
        &agreement.to_account_info(),
        agreement.premium,
        ctx.accounts.usdc_mint.decimals,
        &[seeds],
    )?;
    record_activation(
        &mut ctx.accounts.agreement,
        ctx.accounts.writer.key(),
        now,
        ctx.accounts.policy.version,
    );
    Ok(())
}
