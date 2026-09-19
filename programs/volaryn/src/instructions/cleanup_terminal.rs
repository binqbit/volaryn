use crate::{
    error::VolarynError,
    state::{Agreement, AgreementStatus, AGREEMENT_VERSION},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct CleanupTerminal<'info> {
    pub writer: Signer<'info>,
    #[account(
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
    /// CHECK: Fixed PDA; authority and mint are decoded before handoff. Exercised accounts belong to the writer.
    #[account(mut, seeds = [b"settlement", agreement.key().as_ref()], bump)]
    pub settlement: UncheckedAccount<'info>,
    #[account(address = agreement.underlying_program)]
    pub underlying_program: Program<'info, Token2022>,
    #[account(address = agreement.usdc_program)]
    pub usdc_program: Program<'info, Token>,
}

pub fn handle_cleanup_terminal(ctx: Context<CleanupTerminal>) -> Result<()> {
    let agreement = &ctx.accounts.agreement;
    require_eq!(
        agreement.version,
        AGREEMENT_VERSION,
        VolarynError::UnsupportedVersion
    );
    require!(
        matches!(
            agreement.status,
            AgreementStatus::Exercised | AgreementStatus::Cancelled | AgreementStatus::Expired
        ),
        VolarynError::InvalidState
    );
    let nonce = agreement.nonce.to_le_bytes();
    let bump = [agreement.bump];
    let seeds: &[&[u8]] = &[b"agreement", agreement.writer.as_ref(), &nonce, &bump];
    if ctx.accounts.reserve.amount > 0 {
        token::transfer(
            &ctx.accounts.usdc_program.to_account_info(),
            &ctx.accounts.reserve.to_account_info(),
            &ctx.accounts.usdc_mint.to_account_info(),
            &ctx.accounts.writer_usdc.to_account_info(),
            &agreement.to_account_info(),
            ctx.accounts.reserve.amount,
            ctx.accounts.usdc_mint.decimals,
            &[seeds],
        )?;
    }
    // After handoff the writer may close the account. Late reserve donations remain recoverable.
    let closed = ctx.accounts.settlement.data_is_empty()
        && ctx.accounts.settlement.owner == &anchor_lang::system_program::ID;
    if agreement.status != AgreementStatus::Exercised && !closed {
        use anchor_spl::token_2022::spl_token_2022::{
            extension::StateWithExtensions, state::Account as TokenState,
        };
        let authority = {
            let data = ctx.accounts.settlement.try_borrow_data()?;
            StateWithExtensions::<TokenState>::unpack(&data)?.base.owner
        };
        if authority == agreement.key() {
            token::validate_settlement(
                &ctx.accounts.settlement.to_account_info(),
                &agreement.key(),
                &agreement.underlying_mint,
            )?;
            token::handoff(
                &ctx.accounts.underlying_program.to_account_info(),
                &ctx.accounts.settlement.to_account_info(),
                &agreement.to_account_info(),
                &agreement.writer,
                &[seeds],
            )?;
        } else {
            require_keys_eq!(
                authority,
                agreement.writer,
                VolarynError::InvalidSettlementAccount
            );
        }
    }
    Ok(())
}
