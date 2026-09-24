use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod token;

pub use instructions::*;
pub use state::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZcEYKpEjzMTB7zLZJwQYQ");

#[program]
pub mod volaryn {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::handle_initialize(ctx)
    }

    pub fn create_asset_policy(ctx: Context<CreateAssetPolicy>, terms: PolicyTerms) -> Result<()> {
        instructions::handle_create_asset_policy(ctx, terms)
    }

    pub fn update_asset_policy(ctx: Context<UpdateAssetPolicy>, terms: PolicyTerms) -> Result<()> {
        instructions::handle_update_asset_policy(ctx, terms)
    }

    pub fn create_offer(ctx: Context<CreateOffer>, terms: OfferTerms) -> Result<()> {
        instructions::handle_create_offer(ctx, terms)
    }

    pub fn activate(ctx: Context<Activate>) -> Result<()> {
        instructions::handle_activate(ctx)
    }

    pub fn accept_request(ctx: Context<AcceptRequest>) -> Result<()> {
        instructions::handle_accept_request(ctx)
    }

    pub fn exercise(ctx: Context<Exercise>) -> Result<()> {
        instructions::handle_exercise(ctx)
    }

    pub fn cancel_offer(ctx: Context<Refund>) -> Result<()> {
        instructions::handle_refund(ctx, false)
    }

    pub fn reclaim_expired(ctx: Context<Refund>) -> Result<()> {
        instructions::handle_refund(ctx, true)
    }

    pub fn cleanup_terminal(ctx: Context<CleanupTerminal>) -> Result<()> {
        instructions::handle_cleanup_terminal(ctx)
    }
}
