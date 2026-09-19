//! Scenario actions and observations on the isolated ledger.

use super::{
    addresses::{address, signer_pubkey},
    fixture::Fixture,
    transactions::{send, to_vm_instruction},
};
use anchor_lang::{prelude::Pubkey, AccountDeserialize};
use anchor_spl::token_2022::spl_token_2022 as token;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_clock::Clock;
use solana_instruction::Instruction;
use token::{extension::StateWithExtensions, state::Account};
use volaryn::Agreement;

impl Fixture {
    pub fn create(&mut self) {
        let ix = self.create_instruction(self.terms());
        self.writer_send(ix).unwrap();
    }

    pub fn activate(&mut self) {
        let ix = self.activate_instruction();
        self.holder_send(ix).unwrap();
    }

    pub fn writer_send(
        &mut self,
        ix: Instruction,
    ) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
        send(&mut self.svm, &[ix], &[&self.writer])
    }

    pub fn holder_send(
        &mut self,
        ix: Instruction,
    ) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
        send(&mut self.svm, &[ix], &[&self.holder])
    }

    pub fn authority_send(
        &mut self,
        ix: Instruction,
    ) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
        send(&mut self.svm, &[ix], &[&self.authority])
    }

    pub fn agreement(&self) -> Agreement {
        let a = self.svm.get_account(&address(self.agreement)).unwrap();
        Agreement::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn token(&self, key: Pubkey) -> Account {
        let a = self.svm.get_account(&address(key)).unwrap();
        StateWithExtensions::<Account>::unpack(&a.data)
            .unwrap()
            .base
    }

    pub fn amount(&self, key: Pubkey) -> u64 {
        self.token(key).amount
    }

    pub fn time(&mut self, timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = timestamp;
        self.svm.set_sysvar(&clock);
    }

    pub fn freeze(&mut self, account: Pubkey, mint: Pubkey, extended: bool, frozen: bool) {
        let program = if extended {
            token::ID
        } else {
            anchor_spl::token::ID
        };
        let builder = if frozen {
            token::instruction::freeze_account
        } else {
            token::instruction::thaw_account
        };
        self.authority_send(to_vm_instruction(
            builder(
                &program,
                &account,
                &mint,
                &signer_pubkey(&self.authority),
                &[],
            )
            .unwrap(),
        ))
        .unwrap();
    }
}
