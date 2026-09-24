use super::validation::check_state;
use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus, OfferSide},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct Refund<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agreement", agreement.creator.as_ref(), &agreement.nonce.to_le_bytes()],
        bump = agreement.bump
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
        token::authority = actor,
        token::token_program = usdc_program
    )]
    pub actor_usdc: InterfaceAccount<'info, TokenAccount>,
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
            AgreementStatus::Open
        },
    )?;
    let recipient = if expired {
        agreement.writer.ok_or(VolarynError::InvalidState)?
    } else {
        agreement.creator
    };
    require_keys_eq!(
        ctx.accounts.actor.key(),
        recipient,
        VolarynError::UnauthorizedActor
    );
    let amount = if !expired && agreement.side == OfferSide::Holder {
        agreement.premium
    } else {
        agreement.payout
    };
    if expired {
        require!(now >= agreement.expires_at, VolarynError::NotExpired);
    }
    require!(
        ctx.accounts.reserve.amount >= amount,
        VolarynError::InsufficientReserve
    );
    let nonce = agreement.nonce.to_le_bytes();
    let bump = [agreement.bump];
    let seeds: &[&[u8]] = &[b"agreement", agreement.creator.as_ref(), &nonce, &bump];
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.actor_usdc.to_account_info(),
        &agreement.to_account_info(),
        amount,
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
