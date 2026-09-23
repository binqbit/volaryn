import type { Address, Instruction, Rpc, SolanaRpcApi, TransactionSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import * as token from '@solana-program/token';
import * as token2022 from '@solana-program/token-2022';
import { sendAndFinalize } from '@volaryn/protocol';
import { recipe } from './identity';
import { fixtureUnits } from './assets';
import { withProgress } from './progress';

/** Existing balances are preserved unless the caller explicitly requests a top-up. */
export function fixtureTokens(rpc: Rpc<SolanaRpcApi>, authority: TransactionSigner) {
  const exists = async (key: Address) =>
    (await rpc.getAccountInfo(key, { encoding: 'base64', commitment: 'finalized' }).send()).value;
  const execute = (label: string, instructions: Instruction[]) =>
    withProgress(label, () => sendAndFinalize(rpc, authority, instructions));
  const allocate = async (signer: TransactionSigner, space: number, programAddress: Address) =>
    getCreateAccountInstruction({
      payer: authority,
      newAccount: signer,
      space,
      programAddress,
      lamports: await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
    });

  async function createMint(mint: TransactionSigner, decimals: number, extended: boolean) {
    const programAddress = extended
      ? token2022.TOKEN_2022_PROGRAM_ADDRESS
      : token.TOKEN_PROGRAM_ADDRESS;
    const previous = await exists(mint.address);
    if (previous) {
      if (
        previous.owner !== programAddress ||
        token2022.getMintDecoder().decode(Buffer.from(previous.data[0], 'base64')).decimals !==
          decimals
      )
        throw new Error('Existing fixture mint is incompatible');
      return;
    }
    const maximumFee = fixtureUnits(recipe.maximumFee, decimals);
    const fee = { epoch: 0n, maximumFee, transferFeeBasisPoints: recipe.transferFeeBasisPoints };
    const extensions: token2022.ExtensionArgs[] = extended
      ? [
          token2022.extension('TransferFeeConfig', {
            transferFeeConfigAuthority: authority.address,
            withdrawWithheldAuthority: authority.address,
            withheldAmount: 0n,
            olderTransferFee: fee,
            newerTransferFee: fee,
          }),
          token2022.extension('ScaledUiAmountConfig', {
            authority: authority.address,
            multiplier: recipe.displayMultiplier,
            newMultiplier: recipe.displayMultiplier,
            newMultiplierEffectiveTimestamp: 0n,
          }),
        ]
      : [];
    await execute(`Creating fixture mint ${mint.address}`, [
      await allocate(
        mint,
        extended ? token2022.getMintSize(extensions) : token.getMintSize(),
        programAddress,
      ),
      ...(extended
        ? [
            token2022.getInitializeTransferFeeConfigInstruction({
              mint: mint.address,
              transferFeeConfigAuthority: authority.address,
              withdrawWithheldAuthority: authority.address,
              transferFeeBasisPoints: recipe.transferFeeBasisPoints,
              maximumFee,
            }),
            token2022.getInitializeScaledUiAmountMintInstruction({
              mint: mint.address,
              authority: authority.address,
              multiplier: recipe.displayMultiplier,
            }),
          ]
        : []),
      token.getInitializeMint2Instruction(
        {
          mint: mint.address,
          decimals,
          mintAuthority: authority.address,
          freezeAuthority: extended ? authority.address : null,
        },
        { programAddress },
      ),
    ]);
  }

  async function fundAccount(
    account: TransactionSigner,
    owner: Address,
    mint: Address,
    amount: bigint,
    decimals: number,
    extended: boolean,
    topUp = false,
  ) {
    const programAddress = extended
      ? token2022.TOKEN_2022_PROGRAM_ADDRESS
      : token.TOKEN_PROGRAM_ADDRESS;
    const previous = await exists(account.address);
    if (previous) {
      const decoded = token2022.getTokenDecoder().decode(Buffer.from(previous.data[0], 'base64'));
      if (previous.owner !== programAddress || decoded.owner !== owner || decoded.mint !== mint)
        throw new Error('Existing fixture token account has incompatible ownership');
      if (topUp && decoded.amount < amount)
        await execute(`Topping up fixture account ${account.address}`, [
          token.getMintToCheckedInstruction(
            {
              mint,
              token: account.address,
              mintAuthority: authority,
              amount: amount - decoded.amount,
              decimals,
            },
            { programAddress },
          ),
        ]);
      return;
    }
    const space = extended
      ? token2022.getTokenSize([token2022.extension('TransferFeeAmount', { withheldAmount: 0n })])
      : token.getTokenSize();
    await execute(`Funding fixture account ${account.address}`, [
      await allocate(account, space, programAddress),
      token.getInitializeAccount3Instruction(
        { account: account.address, mint, owner },
        { programAddress },
      ),
      token.getMintToCheckedInstruction(
        { mint, token: account.address, mintAuthority: authority, amount, decimals },
        { programAddress },
      ),
    ]);
  }
  return { createMint, fundAccount };
}
