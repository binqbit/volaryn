use anchor_lang::{prelude::Pubkey, InstructionData};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use solana_keypair::Keypair;
use solana_message::{compiled_instruction::CompiledInstruction, Message, MessageHeader};
use solana_signer::Signer;
use solana_transaction::Transaction;

pub struct SignedAction {
    pub transaction: Transaction,
    pub agreement: Pubkey,
    pub owner: String,
}

impl SignedAction {
    pub fn create(nonce: u64) -> Self {
        let writer = Keypair::new_from_array([9; 32]);
        let owner: Pubkey = writer.pubkey().to_string().parse().unwrap();
        let agreement = Pubkey::find_program_address(
            &[b"agreement", owner.as_ref(), &nonce.to_le_bytes()],
            &volaryn::ID,
        )
        .0;
        let terms = volaryn::state::OfferTerms {
            nonce,
            designated_holder: None,
            quantity_raw: 10,
            payout: 20,
            premium: 1,
            accept_before: 1800000000,
            expires_at: 1800000010,
        };
        let message = Message {
            header: MessageHeader {
                num_required_signatures: 1,
                num_readonly_signed_accounts: 0,
                num_readonly_unsigned_accounts: 1,
            },
            account_keys: vec![
                writer.pubkey(),
                agreement.to_string().parse().unwrap(),
                Pubkey::new_from_array([6; 32]).to_string().parse().unwrap(),
                volaryn::ID.to_string().parse().unwrap(),
            ],
            recent_blockhash: Default::default(),
            instructions: vec![CompiledInstruction {
                program_id_index: 3,
                accounts: vec![0, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2],
                data: volaryn::instruction::CreateOffer { terms }.data(),
            }],
        };
        let mut transaction = Transaction::new_unsigned(message);
        transaction.sign(&[&writer], Default::default());
        Self {
            transaction,
            agreement,
            owner: owner.to_string(),
        }
    }
    pub fn signature(&self) -> String {
        self.transaction.signatures[0].to_string()
    }
    pub fn params(&self) -> Value {
        json!([STANDARD.encode(bincode::serialize(&self.transaction).unwrap()), {"encoding":"base64"}])
    }
    pub fn resign(&mut self) {
        self.transaction
            .sign(&[&Keypair::new_from_array([9; 32])], Default::default());
    }
}
