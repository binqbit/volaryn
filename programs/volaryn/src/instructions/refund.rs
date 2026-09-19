use super::validation::check_state;
use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct Refund<'info> {
    pub writer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agreement", writer.key().as_ref(), &agreement.nonce.to_le_bytes()],
        bump = agreement.bump,
        has_one = writer
    )]
    pub agreement: Box<Account<'info, Agreement>>,
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

pub fn handle_refund(ctx: Context<Refund>, expired: bool) -> Result<()> {
    let agreement = &ctx.accounts.agreement;
    let now = Clock::get()?.unix_timestamp;
    check_state(
        agreement,
        if expired {
            AgreementStatus::Active
        } else {
            AgreementStatus::Funded
        },
    )?;
    if expired {
        require!(now >= agreement.expires_at, VolarynError::NotExpired);
    }
    require!(
        ctx.accounts.reserve.amount >= agreement.payout,
        VolarynError::InsufficientReserve
    );
    let nonce = agreement.nonce.to_le_bytes();
    let bump = [agreement.bump];
    let seeds: &[&[u8]] = &[b"agreement", agreement.writer.as_ref(), &nonce, &bump];
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.writer_usdc.to_account_info(),
        &agreement.to_account_info(),
        agreement.payout,
        ctx.accounts.usdc_mint.decimals,
        &[seeds],
    )?;
    let agreement = &mut ctx.accounts.agreement;
    agreement.status = if expired {
        AgreementStatus::Expired
    } else {
        AgreementStatus::Cancelled
    };
    agreement.settled_at = Some(now);
    Ok(())
}
