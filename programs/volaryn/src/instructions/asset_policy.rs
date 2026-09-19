use crate::{
    error::VolarynError,
    state::{AssetPolicy, PolicyTerms, ProtocolConfig},
    token,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

#[derive(Accounts)]
pub struct CreateAssetPolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump, has_one = authority)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(owner = anchor_spl::token_2022::ID)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + AssetPolicy::INIT_SPACE,
        seeds = [b"policy", mint.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, AssetPolicy>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAssetPolicy<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump, has_one = authority)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(owner = anchor_spl::token_2022::ID)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"policy", mint.key().as_ref()], bump, has_one = mint)]
    pub policy: Account<'info, AssetPolicy>,
}

pub fn handle_create_asset_policy(
    ctx: Context<CreateAssetPolicy>,
    terms: PolicyTerms,
) -> Result<()> {
    token::validate_mint(&ctx.accounts.mint.to_account_info(), terms.enabled)?;
    let policy = &mut ctx.accounts.policy;
    policy.mint = ctx.accounts.mint.key();
    policy.token_program = anchor_spl::token_2022::ID;
    policy.decimals = ctx.accounts.mint.decimals;
    write_policy(policy, terms)
}

pub fn handle_update_asset_policy(
    ctx: Context<UpdateAssetPolicy>,
    terms: PolicyTerms,
) -> Result<()> {
    // Disabling admission must remain possible even after an unsupported issuer change.
    if terms.enabled {
        token::validate_mint(&ctx.accounts.mint.to_account_info(), true)?;
    }
    write_policy(&mut ctx.accounts.policy, terms)
}

fn write_policy(policy: &mut AssetPolicy, terms: PolicyTerms) -> Result<()> {
    if terms.enabled {
        let now = Clock::get()?.unix_timestamp;
        require!(
            terms.reviewed_until > now && terms.max_expiry > now,
            VolarynError::IneligibleAsset
        );
    }
    policy.version = policy
        .version
        .checked_add(1)
        .ok_or(VolarynError::ArithmeticOverflow)?;
    policy.enabled = terms.enabled;
    policy.reviewed_until = terms.reviewed_until;
    policy.max_expiry = terms.max_expiry;
    Ok(())
}
