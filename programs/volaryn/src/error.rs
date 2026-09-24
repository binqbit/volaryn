use anchor_lang::prelude::*;

#[error_code]
pub enum VolarynError {
    #[msg("Only the deployment upgrade authority can initialize the protocol")]
    UnauthorizedInitializer,
    #[msg("The asset policy is disabled, stale, or does not admit this expiry")]
    IneligibleAsset,
    #[msg("The mint has unsupported extensions or is paused")]
    UnsupportedMint,
    #[msg("Amounts must be positive and deadlines must be ordered")]
    InvalidTerms,
    #[msg("The agreement is in the wrong state")]
    InvalidState,
    #[msg("The agreement version is unsupported")]
    UnsupportedVersion,
    #[msg("The acceptance deadline has passed")]
    AcceptanceClosed,
    #[msg("The signer is not the authorized holder")]
    WrongHolder,
    #[msg("The reserve does not cover the required escrow")]
    InsufficientReserve,
    #[msg("The agreement has expired")]
    Expired,
    #[msg("The agreement has not expired")]
    NotExpired,
    #[msg("One holder-owned source account must cover the full gross quantity")]
    InsufficientDelivery,
    #[msg("The settlement account has unsafe authorities or extensions")]
    InvalidSettlementAccount,
    #[msg("Checked arithmetic failed")]
    ArithmeticOverflow,
    #[msg("The settlement currency must use the configured six-decimal SPL mint")]
    InvalidSettlementCurrency,
    #[msg("The writer cannot be the protection holder")]
    WriterCannotBeHolder,
    #[msg("This acceptance instruction does not match the offer side")]
    WrongOfferSide,
    #[msg("The signer is not the designated counterparty")]
    WrongCounterparty,
    #[msg("The signer is not authorized for this agreement action")]
    UnauthorizedActor,
}
