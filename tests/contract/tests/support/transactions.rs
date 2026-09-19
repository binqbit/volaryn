use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_address::Address;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

pub fn to_vm_instruction(ix: anchor_lang::solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: Address::new_from_array(ix.program_id.to_bytes()),
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: Address::new_from_array(a.pubkey.to_bytes()),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

pub fn instruction(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    to_vm_instruction(anchor_lang::solana_program::instruction::Instruction {
        program_id: volaryn::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    })
}

pub fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<TransactionMetadata, Box<FailedTransactionMetadata>> {
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&signers[0].pubkey()),
        signers,
        svm.latest_blockhash(),
    );
    let bytes = bincode::serialize(&tx).unwrap();
    assert!(
        bytes.len() <= 1232,
        "legacy transaction exceeds packet limit: {}",
        bytes.len()
    );
    svm.send_transaction(tx).map_err(Box::new)
}

pub fn assert_error(
    result: Result<TransactionMetadata, Box<FailedTransactionMetadata>>,
    expected: volaryn::error::VolarynError,
) {
    let failure = result.expect_err("transaction unexpectedly succeeded");
    let expected = u32::from(expected);
    assert!(
        matches!(
            failure.err,
            TransactionError::InstructionError(_, InstructionError::Custom(code)) if code == expected
        ),
        "expected program error {expected}, got {failure:#?}"
    );
}
