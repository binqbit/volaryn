import {
  address,
  getBase64Encoder,
  some,
  unwrapOption,
  type Address,
  type TransactionSigner,
} from '@solana/kit';
import {
  AccountState,
  fetchToken,
  getTokenDecoder,
  getTokenSize,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  fetchMint,
  fetchToken as fetchUnderlying,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  AgreementStatus,
  estimateFee,
  fetchAgreement,
  fetchAssetPolicy,
  fetchMaybeAgreement,
  getAgreementEncoder,
  getActivateInstruction,
  getCancelOfferInstruction,
  getCleanupTerminalInstruction,
  getCreateOfferInstruction,
  getExerciseInstruction,
  getReclaimExpiredInstruction,
  protocolAddresses,
  VOLARYN_PROGRAM_ADDRESS,
} from '@volaryn/protocol';
import { api, amount, type Deployment } from '../api/client';
import type { AppClient } from './client';
import type { ActionPlan, ActionRequest } from './actionTypes';
import { mintTerms } from './mint';

export async function chainTime(client: AppClient) {
  const slot = await client.rpc.getSlot({ commitment: 'confirmed' }).send();
  const now = await client.rpc.getBlockTime(slot).send();
  if (now === null) throw new Error('Validator clock is unavailable');
  return now;
}

async function writerDestination(client: AppClient, mint: Address, owner: Address) {
  const { value } = await client.rpc
    .getTokenAccountsByOwner(owner, { mint }, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  for (const entry of value) {
    if (entry.account.owner !== TOKEN_PROGRAM_ADDRESS) continue;
    const token = getTokenDecoder().decode(getBase64Encoder().encode(entry.account.data[0]));
    if (token.owner === owner && token.mint === mint && token.state === AccountState.Initialized)
      return entry.pubkey;
  }
  throw new Error('The writer has no usable USDC account to receive the premium');
}

export async function buildAction(
  client: AppClient,
  deployment: Deployment,
  request: ActionRequest,
  signer: TransactionSigner,
): Promise<ActionPlan> {
  const { rpc } = client;
  if ((await rpc.getGenesisHash().send()) !== deployment.genesisHash)
    throw new Error('Wrong network: the ledger identity changed');
  const now = await chainTime(client);
  const mintAddress = address(
    request.operation === 'create'
      ? request.terms.underlyingMint
      : request.agreement.underlyingMint,
  );
  const asset = deployment.assets.find((item) => item.mint === mintAddress);
  if (request.operation === 'create' && !asset)
    throw new Error('Choose a supported PreStocks token');
  if (deployment.mode === 'mainnet' && ['create', 'activate'].includes(request.operation)) {
    const admission = await api.GET('/api/admission', { params: { query: { mint: mintAddress } } });
    if (!admission.data)
      throw new Error('Asset admission is unavailable; try again before signing');
    if (!admission.data.newCommitments) throw new Error(admission.data.reason);
  }
  const usdcMint = address(deployment.usdcMint);
  const usdcAddress = address(request.usdcAccount);
  const { data: usdc, programAddress: usdcProgram } = await fetchToken(rpc, usdcAddress, {
    commitment: 'confirmed',
  });
  if (
    usdcProgram !== TOKEN_PROGRAM_ADDRESS ||
    usdc.owner !== signer.address ||
    usdc.mint !== usdcMint ||
    usdc.state !== AccountState.Initialized
  )
    throw new Error('Select an unfrozen USDC account belonging to this wallet');
  const creating = request.operation === 'create';
  const terms = creating ? request.terms : request.agreement;
  const quantity = amount(terms.quantityRaw);
  const payout = amount(terms.payout);
  const premium = amount(terms.premium);
  const acceptBefore = amount(terms.acceptBefore);
  const expiresAt = amount(terms.expiresAt);
  const transferRequired = ['create', 'activate', 'exercise'].includes(request.operation);
  // Refunds depend only on USDC and agreement state, never on issuer mint availability.
  let mint = {
    decimals:
      request.operation === 'create' ? asset!.decimals : request.agreement.underlyingDecimals,
    netReceipt: 0n,
    issuerFee: 0n,
    accountSize: 0,
    restrictions: [] as string[],
  };
  if (transferRequired) {
    const [mintAccount, epoch] = await Promise.all([
      fetchMint(rpc, mintAddress, { commitment: 'confirmed' }),
      rpc.getEpochInfo({ commitment: 'confirmed' }).send(),
    ]);
    if (mintAccount.programAddress !== TOKEN_2022_PROGRAM_ADDRESS)
      throw new Error('Unsupported underlying token program');
    if (mintAccount.data.decimals !== mint.decimals)
      throw new Error('Token precision differs from the reviewed terms');
    mint = mintTerms(mintAccount.data, quantity, epoch.epoch, request.operation !== 'exercise');
  }
  let addresses;
  let instruction;
  let rent = 0n;
  let reserveAmount: string | null = null;
  let underlyingAccount: string | null = null;
  if (creating) {
    if (
      !quantity ||
      !payout ||
      !premium ||
      now >= acceptBefore ||
      acceptBefore > expiresAt ||
      expiresAt > 9223372036854775807n
    )
      throw new Error('Amounts must be positive and deadlines must be ordered in the future');
    const nonce = amount(request.terms.nonce);
    addresses = await protocolAddresses(mintAddress, signer.address, nonce);
    if ((await fetchMaybeAgreement(rpc, addresses.agreement, { commitment: 'confirmed' })).exists)
      throw new Error(
        'This offer identity already exists; refresh its agreement before creating another',
      );
    if (usdc.amount < payout)
      throw new Error('The selected USDC account cannot fund the full payout');
    const policy = await fetchAssetPolicy(rpc, addresses.policy, { commitment: 'confirmed' });
    if (
      policy.programAddress !== VOLARYN_PROGRAM_ADDRESS ||
      policy.data.mint !== mintAddress ||
      policy.data.tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS ||
      policy.data.decimals !== mint.decimals
    )
      throw new Error('The asset policy does not match the selected token');
    if (!policy.data.enabled) throw new Error('New offers are disabled for this asset');
    if (now >= policy.data.reviewedUntil)
      throw new Error(
        'This asset’s approval has expired. New offers are unavailable until it is renewed.',
      );
    if (expiresAt > policy.data.maxExpiry)
      throw new Error(
        `Protection must expire by ${new Date(Number(policy.data.maxExpiry) * 1000).toISOString()}. Choose an earlier expiry.`,
      );
    instruction = getCreateOfferInstruction({
      ...addresses,
      writer: signer,
      writerUsdc: usdcAddress,
      underlyingMint: mintAddress,
      usdcMint,
      nonce,
      designatedHolder: terms.designatedHolder ? address(terms.designatedHolder) : null,
      quantityRaw: quantity,
      payout,
      premium,
      acceptBefore,
      expiresAt,
    });
    // Anchor allocates maximum option sizes, even when initial values are None.
    const space = getAgreementEncoder().encode({
      version: 1,
      bump: 0,
      writer: signer.address,
      nonce,
      designatedHolder: some(signer.address),
      holder: some(signer.address),
      underlyingMint: mintAddress,
      underlyingProgram: TOKEN_2022_PROGRAM_ADDRESS,
      underlyingDecimals: mint.decimals,
      usdcMint,
      usdcProgram: TOKEN_PROGRAM_ADDRESS,
      quantityRaw: quantity,
      payout,
      premium,
      acceptBefore,
      expiresAt,
      policyVersion: 1,
      createdAt: now,
      activatedAt: some(now),
      settledAt: some(now),
      netReceived: 0n,
      status: AgreementStatus.Funded,
    }).length;
    const rents = await Promise.all(
      [space, getTokenSize(), mint.accountSize].map((size) =>
        rpc.getMinimumBalanceForRentExemption(BigInt(size)).send(),
      ),
    );
    rent = rents.reduce((total, value) => total + value, 0n);
  } else {
    const account = await fetchAgreement(rpc, address(request.agreement.address), {
      commitment: 'confirmed',
    });
    const agreement = account.data;
    addresses = await protocolAddresses(mintAddress, agreement.writer, agreement.nonce);
    if (
      account.programAddress !== VOLARYN_PROGRAM_ADDRESS ||
      agreement.version !== 1 ||
      addresses.agreement !== request.agreement.address ||
      agreement.underlyingMint !== mintAddress ||
      agreement.usdcMint !== usdcMint ||
      agreement.underlyingProgram !== TOKEN_2022_PROGRAM_ADDRESS ||
      agreement.usdcProgram !== TOKEN_PROGRAM_ADDRESS
    )
      throw new Error('Agreement identity is not supported');
    if (
      agreement.underlyingDecimals !== request.agreement.underlyingDecimals ||
      agreement.quantityRaw !== quantity ||
      agreement.payout !== payout ||
      agreement.premium !== premium ||
      agreement.acceptBefore !== acceptBefore ||
      agreement.expiresAt !== expiresAt ||
      agreement.writer !== request.agreement.writer ||
      unwrapOption(agreement.designatedHolder) !== (terms.designatedHolder ?? null)
    )
      throw new Error('Agreement terms changed; refresh before signing');
    const { data: reserve, programAddress } = await fetchToken(rpc, addresses.reserve, {
      commitment: 'confirmed',
    });
    if (
      programAddress !== TOKEN_PROGRAM_ADDRESS ||
      reserve.owner !== addresses.agreement ||
      reserve.mint !== usdcMint ||
      reserve.state !== AccountState.Initialized
    )
      throw new Error('The reserve is unavailable');
    reserveAmount = reserve.amount.toString();
    if (request.operation !== 'cleanup' && reserve.amount < payout)
      throw new Error('The full payout is not available in reserve');
    const writerInput = { ...addresses, writer: signer, writerUsdc: usdcAddress, usdcMint };
    if (request.operation === 'activate') {
      const { data: policy, programAddress: policyProgram } = await fetchAssetPolicy(
        rpc,
        addresses.policy,
        {
          commitment: 'confirmed',
        },
      );
      if (
        policyProgram !== VOLARYN_PROGRAM_ADDRESS ||
        policy.mint !== mintAddress ||
        policy.tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS ||
        policy.decimals !== mint.decimals ||
        agreement.status !== AgreementStatus.Funded ||
        now >= acceptBefore ||
        !policy.enabled ||
        now >= policy.reviewedUntil ||
        expiresAt > policy.maxExpiry
      )
        throw new Error('This offer is no longer available for activation');
      const designated = unwrapOption(agreement.designatedHolder);
      if (designated && designated !== signer.address)
        throw new Error('This offer is reserved for another wallet');
      if (usdc.amount < premium)
        throw new Error('The selected USDC account cannot pay the premium');
      instruction = getActivateInstruction({
        ...addresses,
        holder: signer,
        holderUsdc: usdcAddress,
        writerUsdc: await writerDestination(client, usdcMint, agreement.writer),
        underlyingMint: mintAddress,
        usdcMint,
      });
    } else if (request.operation === 'exercise') {
      if (
        agreement.status !== AgreementStatus.Active ||
        unwrapOption(agreement.holder) !== signer.address ||
        now >= expiresAt
      )
        throw new Error('Exercise requires the active holder before expiry');
      if (!request.underlyingAccount) throw new Error('Select an underlying token account');
      underlyingAccount = request.underlyingAccount;
      const underlying = await fetchUnderlying(rpc, address(underlyingAccount), {
        commitment: 'confirmed',
      });
      if (
        underlying.programAddress !== TOKEN_2022_PROGRAM_ADDRESS ||
        underlying.data.owner !== signer.address ||
        underlying.data.mint !== mintAddress ||
        underlying.data.state !== AccountState.Initialized
      )
        throw new Error('The underlying account is unavailable or frozen');
      if (underlying.data.amount < quantity)
        throw new Error(
          'The selected account needs the full deliverable quantity; balances in other accounts are not combined',
        );
      instruction = getExerciseInstruction({
        ...addresses,
        holder: signer,
        holderUsdc: usdcAddress,
        holderUnderlying: address(underlyingAccount),
        underlyingMint: mintAddress,
        usdcMint,
      });
    } else {
      if (agreement.writer !== signer.address)
        throw new Error('Only the writer can manage this reserve');
      if (request.operation === 'cancel') {
        if (agreement.status !== AgreementStatus.Funded)
          throw new Error('Only an unaccepted offer can be cancelled');
        instruction = getCancelOfferInstruction(writerInput);
      } else if (request.operation === 'reclaim') {
        if (agreement.status !== AgreementStatus.Active || now < expiresAt)
          throw new Error('An active reserve cannot be withdrawn before expiry');
        instruction = getReclaimExpiredInstruction(writerInput);
      } else {
        if (
          ![AgreementStatus.Exercised, AgreementStatus.Cancelled, AgreementStatus.Expired].includes(
            agreement.status as 2 | 3 | 4,
          )
        )
          throw new Error('Residual recovery requires a terminal agreement');
        instruction = getCleanupTerminalInstruction(writerInput);
      }
    }
  }
  const instructions = [instruction];
  const fee = await estimateFee(rpc, signer, instructions);
  if ((await rpc.getBalance(signer.address, { commitment: 'confirmed' }).send()).value < fee + rent)
    throw new Error('Insufficient SOL for the estimated network fee and account rent');
  return {
    instructions,
    review: {
      underlyingMint: mintAddress,
      underlyingDecimals: mint.decimals,
      owner: signer.address,
      agreement: addresses.agreement,
      operation: request.operation,
      quantityRaw: quantity.toString(),
      payout: payout.toString(),
      premium: premium.toString(),
      acceptBefore: acceptBefore.toString(),
      expiresAt: expiresAt.toString(),
      designatedHolder: terms.designatedHolder ?? null,
      usdcAccount: usdcAddress,
      underlyingAccount,
      estimatedNetReceipt: mint.netReceipt.toString(),
      issuerFee: mint.issuerFee.toString(),
      networkFee: fee.toString(),
      accountRent: rent.toString(),
      reserveAmount,
      restrictions: mint.restrictions,
    },
  };
}
