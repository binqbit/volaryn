use super::{Operation, Terms};
use crate::domain::AppError;
use anchor_lang::{prelude::Pubkey, AnchorDeserialize, Discriminator};
use base64::{engine::general_purpose::STANDARD, Engine};
use bincode::Options;
use serde_json::Value;
use solana_transaction::Transaction;

pub(super) struct Intent {
    pub signature: String,
    pub owner: String,
    pub agreement: String,
    pub operation: Operation,
    pub created_terms: Option<Terms>,
    pub blockhash: String,
}

pub(super) fn decode(params: &Value) -> Result<Option<Intent>, AppError> {
    let encoded = params[0].as_str().ok_or(AppError::Invalid)?;
    if params[1]["encoding"] != "base64" || encoded.len() > 1644 {
        return Err(AppError::Invalid);
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| AppError::Invalid)?;
    if bytes.len() > 1232 {
        return Err(AppError::Invalid);
    }
    let transaction: Transaction = bincode::options()
        .with_fixint_encoding()
        .with_limit(1232)
        .reject_trailing_bytes()
        .deserialize(&bytes)
        .map_err(|_| AppError::Invalid)?;
    let message = &transaction.message;
    if transaction.signatures.is_empty()
        || transaction.signatures.len() != usize::from(message.header.num_required_signatures)
        || transaction.signatures.len() > message.account_keys.len()
    {
        return Err(AppError::Invalid);
    }
    transaction.verify().map_err(|_| AppError::Invalid)?;
    let key = |index: u8| {
        message
            .account_keys
            .get(usize::from(index))
            .map(ToString::to_string)
            .ok_or(AppError::Invalid)
    };
    let mut supported = None;
    for instruction in &message.instructions {
        if key(instruction.program_id_index)? != volaryn::ID.to_string() {
            continue;
        }
        // The app's transaction contract is one operation, signed by its actor as fee payer.
        if message.instructions.len() != 1
            || transaction.signatures.len() != 1
            || message.header.num_readonly_signed_accounts != 0
            || instruction.accounts.first() != Some(&0)
        {
            return Err(AppError::Invalid);
        }
        let data = instruction.data.as_slice();
        let (operation, position) =
            if data.starts_with(volaryn::instruction::CreateOffer::DISCRIMINATOR) {
                (Operation::Create, 6)
            } else if data == volaryn::instruction::Activate::DISCRIMINATOR {
                (Operation::Activate, 1)
            } else if data == volaryn::instruction::Exercise::DISCRIMINATOR {
                (Operation::Exercise, 1)
            } else if data == volaryn::instruction::CancelOffer::DISCRIMINATOR {
                (Operation::Cancel, 1)
            } else if data == volaryn::instruction::ReclaimExpired::DISCRIMINATOR {
                (Operation::Reclaim, 1)
            } else if data == volaryn::instruction::CleanupTerminal::DISCRIMINATOR {
                (Operation::Cleanup, 1)
            } else {
                return Err(AppError::Invalid);
            };
        // Validate every index before it can be interpreted as a public account identity.
        for index in &instruction.accounts {
            key(*index)?;
        }
        let owner = key(0)?;
        let agreement = key(*instruction
            .accounts
            .get(position)
            .ok_or(AppError::Invalid)?)?;
        let created_terms = if operation == Operation::Create {
            let terms = volaryn::state::OfferTerms::try_from_slice(&data[8..])
                .map_err(|_| AppError::Invalid)?;
            let writer = owner.parse::<Pubkey>().map_err(|_| AppError::Invalid)?;
            let expected = Pubkey::find_program_address(
                &[b"agreement", writer.as_ref(), &terms.nonce.to_le_bytes()],
                &volaryn::ID,
            )
            .0;
            if expected.to_string() != agreement || terms.accept_before < 0 || terms.expires_at < 0
            {
                return Err(AppError::Invalid);
            }
            Some(Terms {
                underlying_mint: key(*instruction.accounts.get(3).ok_or(AppError::Invalid)?)?,
                nonce: terms.nonce.to_string(),
                quantity_raw: terms.quantity_raw.to_string(),
                payout: terms.payout.to_string(),
                premium: terms.premium.to_string(),
                accept_before: terms.accept_before.to_string(),
                expires_at: terms.expires_at.to_string(),
                designated_holder: terms.designated_holder.map(|key| key.to_string()),
            })
        } else {
            None
        };
        supported = Some(Intent {
            signature: transaction.signatures[0].to_string(),
            owner,
            agreement,
            operation,
            created_terms,
            blockhash: message.recent_blockhash.to_string(),
        });
    }
    Ok(supported)
}
