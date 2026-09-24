//! Typed instruction builders with the fixture participants and PDAs.

use super::{
    addresses::signer_pubkey, fixture::Fixture, transactions::instruction, NOW, PAYOUT, PREMIUM,
    QUANTITY,
};
use anchor_lang::prelude::Pubkey;
use anchor_spl::token_2022::spl_token_2022 as token;
use solana_instruction::Instruction;
use volaryn::{AgreementStatus, OfferSide, OfferTerms, PolicyTerms};

impl Fixture {
    pub fn creator(&self) -> Pubkey {
        match self.side {
            OfferSide::Writer => signer_pubkey(&self.writer),
            OfferSide::Holder => signer_pubkey(&self.holder),
        }
    }

    pub fn creator_usdc(&self) -> Pubkey {
        match self.side {
            OfferSide::Writer => self.writer_usdc,
            OfferSide::Holder => self.holder_usdc,
        }
    }

    pub fn accept_request_instruction(&self) -> Instruction {
        instruction(
            volaryn::accounts::AcceptRequest {
                writer: signer_pubkey(&self.writer),
                agreement: self.agreement,
                policy: self.policy,
                underlying_mint: self.underlying,
                usdc_mint: self.usdc,
                reserve: self.reserve,
                writer_usdc: self.writer_usdc,
                usdc_program: anchor_spl::token::ID,
            },
            volaryn::instruction::AcceptRequest {},
        )
    }

    pub fn terms(&self) -> OfferTerms {
        OfferTerms {
            nonce: 1,
            side: self.side,
            designated_counterparty: None,
            quantity_raw: QUANTITY,
            payout: PAYOUT,
            premium: PREMIUM,
            accept_before: NOW + 100,
            expires_at: NOW + 200,
        }
    }

    pub fn policy_terms(&self) -> PolicyTerms {
        PolicyTerms {
            enabled: true,
            reviewed_until: NOW + 1000,
            max_expiry: NOW + 1000,
        }
    }

    pub fn create_policy_instruction(&self) -> Instruction {
        instruction(
            volaryn::accounts::CreateAssetPolicy {
                authority: signer_pubkey(&self.authority),
                config: self.config,
                mint: self.underlying,
                policy: self.policy,
                system_program: Pubkey::default(),
            },
            volaryn::instruction::CreateAssetPolicy {
                terms: self.policy_terms(),
            },
        )
    }

    pub fn update_policy_instruction(&self, terms: PolicyTerms) -> Instruction {
        instruction(
            volaryn::accounts::UpdateAssetPolicy {
                authority: signer_pubkey(&self.authority),
                config: self.config,
                mint: self.underlying,
                policy: self.policy,
            },
            volaryn::instruction::UpdateAssetPolicy { terms },
        )
    }

    pub fn create_instruction(&self, terms: OfferTerms) -> Instruction {
        instruction(
            volaryn::accounts::CreateOffer {
                creator: self.creator(),
                config: self.config,
                policy: self.policy,
                underlying_mint: self.underlying,
                usdc_mint: self.usdc,
                creator_usdc: self.creator_usdc(),
                agreement: self.agreement,
                reserve: self.reserve,
                settlement: self.settlement,
                underlying_program: token::ID,
                usdc_program: anchor_spl::token::ID,
                system_program: Pubkey::default(),
            },
            volaryn::instruction::CreateOffer { terms },
        )
    }

    pub fn activate_instruction(&self) -> Instruction {
        instruction(
            volaryn::accounts::Activate {
                holder: signer_pubkey(&self.holder),
                agreement: self.agreement,
                policy: self.policy,
                underlying_mint: self.underlying,
                usdc_mint: self.usdc,
                reserve: self.reserve,
                holder_usdc: self.holder_usdc,
                writer_usdc: self.writer_usdc,
                usdc_program: anchor_spl::token::ID,
            },
            volaryn::instruction::Activate {},
        )
    }

    pub fn exercise_instruction(&self) -> Instruction {
        instruction(
            volaryn::accounts::Exercise {
                holder: signer_pubkey(&self.holder),
                agreement: self.agreement,
                underlying_mint: self.underlying,
                usdc_mint: self.usdc,
                reserve: self.reserve,
                holder_underlying: self.holder_underlying,
                holder_usdc: self.holder_usdc,
                settlement: self.settlement,
                underlying_program: token::ID,
                usdc_program: anchor_spl::token::ID,
            },
            volaryn::instruction::Exercise {},
        )
    }

    pub fn refund_instruction(&self, expired: bool) -> Instruction {
        let creator_refund = !expired && self.side == OfferSide::Holder;
        let accounts = volaryn::accounts::Refund {
            actor: if creator_refund {
                signer_pubkey(&self.holder)
            } else {
                signer_pubkey(&self.writer)
            },
            agreement: self.agreement,
            usdc_mint: self.usdc,
            reserve: self.reserve,
            actor_usdc: if creator_refund {
                self.holder_usdc
            } else {
                self.writer_usdc
            },
            usdc_program: anchor_spl::token::ID,
        };
        if expired {
            instruction(accounts, volaryn::instruction::ReclaimExpired {})
        } else {
            instruction(accounts, volaryn::instruction::CancelOffer {})
        }
    }

    pub fn cleanup_instruction(&self) -> Instruction {
        let creator_refund =
            self.side == OfferSide::Holder && self.agreement().status == AgreementStatus::Cancelled;
        instruction(
            volaryn::accounts::CleanupTerminal {
                actor: if creator_refund {
                    signer_pubkey(&self.holder)
                } else {
                    signer_pubkey(&self.writer)
                },
                agreement: self.agreement,
                usdc_mint: self.usdc,
                reserve: self.reserve,
                actor_usdc: if creator_refund {
                    self.holder_usdc
                } else {
                    self.writer_usdc
                },
                settlement: self.settlement,
                underlying_program: token::ID,
                usdc_program: anchor_spl::token::ID,
            },
            volaryn::instruction::CleanupTerminal {},
        )
    }
}
