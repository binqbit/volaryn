use super::validation::admit;
use crate::{
    error::VolarynError,
    state::{
        Agreement, AgreementStatus, AssetPolicy, OfferSide, OfferTerms, ProtocolConfig,
        AGREEMENT_VERSION,
    },
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
#[instruction(terms: OfferTerms)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"policy", underlying_mint.key().as_ref()], bump)]
    pub policy: Account<'info, AssetPolicy>,
    #[account(owner = underlying_program.key())]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.usdc_mint, owner = usdc_program.key())]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = creator,
        token::token_program = usdc_program
    )]
    pub creator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Agreement::INIT_SPACE,
        seeds = [b"agreement", creator.key().as_ref(), &terms.nonce.to_le_bytes()],
        bump
    )]
    pub agreement: Box<Account<'info, Agreement>>,
    /// CHECK: PDA allocation and token initialization are performed atomically in the handler.
    #[account(mut, seeds = [b"reserve", agreement.key().as_ref()], bump)]
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: Custom Token-2022 PDA is allocated for the mint-required extensions in the handler.
    #[account(mut, seeds = [b"settlement", agreement.key().as_ref()], bump)]
    pub settlement: UncheckedAccount<'info>,
    pub underlying_program: Program<'info, Token2022>,
    #[account(address = config.usdc_program)]
    pub usdc_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_offer(ctx: Context<CreateOffer>, terms: OfferTerms) -> Result<()> {
    require!(
        terms.designated_counterparty != Some(ctx.accounts.creator.key()),
        VolarynError::WriterCannotBeHolder
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        terms.quantity_raw > 0
            && terms.payout > 0
            && terms.premium > 0
            && now < terms.accept_before
            && terms.accept_before <= terms.expires_at,
        VolarynError::InvalidTerms
    );
    admit(&ctx.accounts.policy, terms.expires_at, now)?;
    token::validate_mint(&ctx.accounts.underlying_mint.to_account_info(), true)?;
    let agreement_key = ctx.accounts.agreement.key();
    token::create_account(
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &agreement_key,
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &[b"reserve", agreement_key.as_ref(), &[ctx.bumps.reserve]],
    )?;
    token::create_account(
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.settlement.to_account_info(),
        &ctx.accounts.underlying_mint.to_account_info(),
        &agreement_key,
        &ctx.accounts.underlying_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &[
            b"settlement",
            agreement_key.as_ref(),
            &[ctx.bumps.settlement],
        ],
    )?;
    token::validate_settlement(
        &ctx.accounts.settlement.to_account_info(),
        &agreement_key,
        &ctx.accounts.underlying_mint.key(),
    )?;
    token::transfer(
        &ctx.accounts.usdc_program.to_account_info(),
        &ctx.accounts.creator_usdc.to_account_info(),
        &ctx.accounts.usdc_mint.to_account_info(),
        &ctx.accounts.reserve.to_account_info(),
        &ctx.accounts.creator.to_account_info(),
        match terms.side {
            OfferSide::Writer => terms.payout,
            OfferSide::Holder => terms.premium,
        },
        ctx.accounts.usdc_mint.decimals,
        &[],
    )?;
    ctx.accounts.agreement.set_inner(Agreement {
        version: AGREEMENT_VERSION,
        bump: ctx.bumps.agreement,
        creator: ctx.accounts.creator.key(),
        side: terms.side,
        nonce: terms.nonce,
        designated_counterparty: terms.designated_counterparty,
        writer: (terms.side == OfferSide::Writer).then_some(ctx.accounts.creator.key()),
        holder: (terms.side == OfferSide::Holder).then_some(ctx.accounts.creator.key()),
        underlying_mint: ctx.accounts.underlying_mint.key(),
        underlying_program: ctx.accounts.underlying_program.key(),
        underlying_decimals: ctx.accounts.underlying_mint.decimals,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        usdc_program: ctx.accounts.usdc_program.key(),
        quantity_raw: terms.quantity_raw,
        payout: terms.payout,
        premium: terms.premium,
        accept_before: terms.accept_before,
        expires_at: terms.expires_at,
        policy_version: ctx.accounts.policy.version,
        created_at: now,
        activated_at: None,
        settled_at: None,
        net_received: 0,
        status: AgreementStatus::Open,
    });
    Ok(())
}
