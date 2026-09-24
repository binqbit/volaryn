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
    nonce: u64,
    side: volaryn::state::OfferSide,
    creator: Pubkey,
    signer_seed: u8,
}

impl SignedAction {
    pub fn create(nonce: u64) -> Self {
        Self::create_side(nonce, volaryn::state::OfferSide::Writer)
    }
    pub fn create_side(nonce: u64, side: volaryn::state::OfferSide) -> Self {
        let writer = Keypair::new_from_array([9; 32]);
        let owner: Pubkey = writer.pubkey().to_string().parse().unwrap();
        let agreement = Pubkey::find_program_address(
            &[b"agreement", owner.as_ref(), &nonce.to_le_bytes()],
            &volaryn::ID,
        )
        .0;
        let terms = volaryn::state::OfferTerms {
            nonce,
            side,
            designated_counterparty: None,
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
            nonce,
            side,
            creator: owner,
            signer_seed: 9,
        }
    }
    pub fn signature(&self) -> String {
        self.transaction.signatures[0].to_string()
    }
    pub fn params(&self) -> Value {
        json!([STANDARD.encode(bincode::serialize(&self.transaction).unwrap()), {"encoding":"base64"}])
    }
    pub fn resign(&mut self) {
        self.transaction.sign(
            &[&Keypair::new_from_array([self.signer_seed; 32])],
            Default::default(),
        );
    }

    pub fn operation(&self, data: Vec<u8>, signer_seed: u8) -> Self {
        let signer = Keypair::new_from_array([signer_seed; 32]);
        let mut transaction = self.transaction.clone();
        transaction.message.account_keys[0] = signer.pubkey();
        transaction.message.instructions[0].data = data;
        transaction.message.instructions[0].accounts = vec![0, 1, 2, 2, 2, 2, 2, 2];
        transaction.sign(&[&signer], Default::default());
        Self {
            transaction,
            agreement: self.agreement,
            owner: signer.pubkey().to_string(),
            nonce: self.nonce,
            side: self.side,
            creator: self.creator,
            signer_seed,
        }
    }

    pub fn state(&self) -> volaryn::state::Agreement {
        use volaryn::state::{Agreement, AgreementStatus, OfferSide};
        let bump = Pubkey::find_program_address(
            &[
                b"agreement",
                self.creator.as_ref(),
                &self.nonce.to_le_bytes(),
            ],
            &volaryn::ID,
        )
        .1;
        Agreement {
            version: 2,
            bump,
            creator: self.creator,
            side: self.side,
            nonce: self.nonce,
            designated_counterparty: None,
            writer: (self.side == OfferSide::Writer).then_some(self.creator),
            holder: (self.side == OfferSide::Holder).then_some(self.creator),
            underlying_mint: Pubkey::new_from_array([6; 32]),
            underlying_program: anchor_spl::token_2022::ID,
            underlying_decimals: 9,
            usdc_mint: Pubkey::default(),
            usdc_program: anchor_spl::token::ID,
            quantity_raw: 10,
            payout: 20,
            premium: 1,
            accept_before: 1800000000,
            expires_at: 1800000010,
            policy_version: 1,
            created_at: 1,
            activated_at: None,
            settled_at: None,
            net_received: 0,
            status: AgreementStatus::Open,
        }
    }
}

pub fn accounts(
    agreement: &volaryn::state::Agreement,
    reserve_amount: u64,
) -> std::collections::BTreeMap<String, Value> {
    use anchor_lang::{
        solana_program::{program_option::COption, program_pack::Pack},
        AccountSerialize,
    };
    use anchor_spl::token::spl_token::state::{Account, AccountState};
    let address = Pubkey::find_program_address(
        &[
            b"agreement",
            agreement.creator.as_ref(),
            &agreement.nonce.to_le_bytes(),
        ],
        &volaryn::ID,
    )
    .0;
    let reserve = Pubkey::find_program_address(&[b"reserve", address.as_ref()], &volaryn::ID).0;
    let mut bytes = Vec::new();
    agreement.try_serialize(&mut bytes).unwrap();
    let mut tokens = vec![0; Account::LEN];
    Account::pack(
        Account {
            mint: agreement.usdc_mint,
            owner: address,
            amount: reserve_amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut tokens,
    )
    .unwrap();
    [
        (address.to_string(), json!({"owner":volaryn::ID.to_string(),"data":[STANDARD.encode(bytes),"base64"]})),
        (reserve.to_string(), json!({"owner":anchor_spl::token::ID.to_string(),"data":[STANDARD.encode(tokens),"base64"]})),
    ].into_iter().collect()
}
