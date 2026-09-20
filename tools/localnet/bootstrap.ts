import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createSolanaRpc,
  lamports,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import * as token from '@solana-program/token';
import * as token2022 from '@solana-program/token-2022';
import {
  VOLARYN_PROGRAM_ADDRESS,
  getCreateAssetPolicyInstruction,
  getCreateOfferInstruction,
  getInitializeInstruction,
  fetchMaybeAgreement,
  fetchMaybeProtocolConfig,
  fetchMaybeAssetPolicy,
  protocolAddresses,
  sendAndFinalize,
} from '@volaryn/protocol';
import { fixtureSigners, recipe } from './identity';
import { withProgress } from './progress';
import type { components } from '../../frontend/src/lib/api/schema';

const { values } = parseArgs({
  options: {
    'rpc-url': { type: 'string', default: 'http://127.0.0.1:8899' },
    manifest: { type: 'string', default: 'target/localnet/deployment.json' },
    program: { type: 'string', default: 'target/deploy/volaryn.so' },
  },
});
const endpoint = new URL(values['rpc-url']);
if (!['127.0.0.1', 'localhost', 'validator'].includes(endpoint.hostname))
  throw new Error('Bootstrap is restricted to the local validator');
const rpc = createSolanaRpc(endpoint.toString());
const started = Date.now();
console.log('[bootstrap] Verifying the local ledger and program');
const keys = await fixtureSigners();
const program = await readFile(values.program);
const programSha256 = createHash('sha256').update(program).digest('hex');
const genesisHash = await rpc.getGenesisHash().send();
const accounts = await protocolAddresses(keys.underlying.address, keys.writer.address, 1n);
const deployed = await rpc
  .getAccountInfo(accounts.programData, { encoding: 'base64', commitment: 'finalized' })
  .send();
if (!deployed.value) throw new Error('Start the validator with the upgradeable Volaryn program');
const deployedBytes = Buffer.from(deployed.value.data[0], 'base64');
if (
  createHash('sha256')
    .update(deployedBytes.subarray(45, 45 + program.length))
    .digest('hex') !== programSha256
)
  throw new Error(
    'The ledger contains a different program build; it will not be reset automatically',
  );

const manifest: components['schemas']['Deployment'] = {
  schemaVersion: 1,
  fixtureVersion: recipe.version,
  mode: 'localnet',
  genesisHash,
  programId: VOLARYN_PROGRAM_ADDRESS,
  programSha256,
  programLength: program.length,
  authority: keys.authority.address,
  holder: keys.holder.address,
  writer: keys.writer.address,
  usdcMint: keys.usdc.address,
  underlyingMint: keys.underlying.address,
  writerUsdc: keys.writerUsdc.address,
  holderUsdc: keys.holderUsdc.address,
  holderUnderlying: keys.holderUnderlying.address,
};
async function readExisting(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as typeof manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
const existing =
  (await readExisting(values.manifest)) ?? (await readExisting(`${values.manifest}.pending`));
if (existing && !isDeepStrictEqual(existing, manifest))
  throw new Error('Deployment identity differs from the existing fixture manifest');
await mkdir(dirname(values.manifest), { recursive: true });
await writeFile(`${values.manifest}.pending`, JSON.stringify(manifest, null, 2) + '\n');

async function exists(key: Address) {
  return (await rpc.getAccountInfo(key, { encoding: 'base64', commitment: 'finalized' }).send())
    .value;
}
async function execute(label: string, instructions: Instruction[], payer = keys.authority) {
  return withProgress(`${label}; waiting for finalization`, () =>
    sendAndFinalize(rpc, payer, instructions),
  );
}
async function createAccount(signer: TransactionSigner, space: number, programAddress: Address) {
  return getCreateAccountInstruction({
    payer: keys.authority,
    newAccount: signer,
    space,
    programAddress,
    lamports: await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
  });
}
console.log('[bootstrap] Initializing missing fixtures; a fresh ledger can take several minutes');
for (const [role, participant] of [
  ['authority', keys.authority],
  ['writer', keys.writer],
  ['holder', keys.holder],
] as const) {
  if ((await rpc.getBalance(participant.address).send()).value === 0n) {
    await withProgress(`Funding ${role}; waiting for airdrop finalization`, async () => {
      const signature = await rpc
        .requestAirdrop(participant.address, lamports(10_000_000_000n))
        .send();
      const deadline = Date.now() + 90_000;
      while (true) {
        const status = (await rpc.getSignatureStatuses([signature]).send()).value[0];
        if (status?.err) throw new Error('Fixture airdrop failed');
        if (status?.confirmationStatus === 'finalized') break;
        if (Date.now() > deadline) throw new Error('Fixture airdrop remains unresolved');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    });
  }
}

if (!(await exists(keys.usdc.address))) {
  await execute('Creating the test USDC mint', [
    await createAccount(keys.usdc, token.getMintSize(), token.TOKEN_PROGRAM_ADDRESS),
    token.getInitializeMint2Instruction({
      mint: keys.usdc.address,
      decimals: recipe.decimals,
      mintAuthority: keys.authority.address,
      freezeAuthority: null,
    }),
  ]);
}
if (!(await exists(keys.underlying.address))) {
  const fee = {
    epoch: 0n,
    maximumFee: BigInt(recipe.maximumFee),
    transferFeeBasisPoints: recipe.transferFeeBasisPoints,
  };
  const extensions: token2022.ExtensionArgs[] = [
    token2022.extension('TransferFeeConfig', {
      transferFeeConfigAuthority: keys.authority.address,
      withdrawWithheldAuthority: keys.authority.address,
      withheldAmount: 0n,
      olderTransferFee: fee,
      newerTransferFee: fee,
    }),
    token2022.extension('ScaledUiAmountConfig', {
      authority: keys.authority.address,
      multiplier: recipe.displayMultiplier,
      newMultiplier: recipe.displayMultiplier,
      newMultiplierEffectiveTimestamp: 0n,
    }),
  ];
  await execute('Creating the underlying token mint', [
    await createAccount(
      keys.underlying,
      token2022.getMintSize(extensions),
      token2022.TOKEN_2022_PROGRAM_ADDRESS,
    ),
    token2022.getInitializeTransferFeeConfigInstruction({
      mint: keys.underlying.address,
      transferFeeConfigAuthority: keys.authority.address,
      withdrawWithheldAuthority: keys.authority.address,
      transferFeeBasisPoints: recipe.transferFeeBasisPoints,
      maximumFee: BigInt(recipe.maximumFee),
    }),
    token2022.getInitializeScaledUiAmountMintInstruction({
      mint: keys.underlying.address,
      authority: keys.authority.address,
      multiplier: recipe.displayMultiplier,
    }),
    token2022.getInitializeMint2Instruction({
      mint: keys.underlying.address,
      decimals: recipe.decimals,
      mintAuthority: keys.authority.address,
      freezeAuthority: keys.authority.address,
    }),
  ]);
}
for (const [mint, programAddress] of [
  [keys.usdc.address, token.TOKEN_PROGRAM_ADDRESS],
  [keys.underlying.address, token2022.TOKEN_2022_PROGRAM_ADDRESS],
] as const) {
  const account = await exists(mint);
  if (
    !account ||
    account.owner !== programAddress ||
    token2022.getMintDecoder().decode(Buffer.from(account.data[0], 'base64')).decimals !==
      recipe.decimals
  )
    throw new Error('Existing fixture mint is incompatible');
}
for (const [account, owner, mint, amount, extended] of [
  [keys.writerUsdc, keys.writer.address, keys.usdc.address, recipe.writerBalance, false],
  [keys.holderUsdc, keys.holder.address, keys.usdc.address, recipe.holderUsdc, false],
  [
    keys.holderUnderlying,
    keys.holder.address,
    keys.underlying.address,
    recipe.holderUnderlying,
    true,
  ],
] as const) {
  const previous = await exists(account.address);
  if (previous) {
    const expectedProgram = extended
      ? token2022.TOKEN_2022_PROGRAM_ADDRESS
      : token.TOKEN_PROGRAM_ADDRESS;
    const decoded = token2022.getTokenDecoder().decode(Buffer.from(previous.data[0], 'base64'));
    if (previous.owner !== expectedProgram || decoded.owner !== owner || decoded.mint !== mint)
      throw new Error('Existing fixture token account has incompatible ownership');
    continue;
  }
  const programAddress = extended
    ? token2022.TOKEN_2022_PROGRAM_ADDRESS
    : token.TOKEN_PROGRAM_ADDRESS;
  const space = extended
    ? token2022.getTokenSize([token2022.extension('TransferFeeAmount', { withheldAmount: 0n })])
    : token.getTokenSize();
  await execute(`Creating and funding token account ${account.address}`, [
    await createAccount(account, space, programAddress),
    token.getInitializeAccount3Instruction(
      { account: account.address, mint, owner },
      { programAddress },
    ),
    token.getMintToCheckedInstruction(
      {
        mint,
        token: account.address,
        mintAuthority: keys.authority,
        amount: BigInt(amount),
        decimals: recipe.decimals,
      },
      { programAddress },
    ),
  ]);
}
const config = await fetchMaybeProtocolConfig(rpc, accounts.config, { commitment: 'finalized' });
if (!config.exists)
  await execute('Initializing protocol configuration', [
    getInitializeInstruction({
      authority: keys.authority,
      config: accounts.config,
      programData: accounts.programData,
      usdcMint: keys.usdc.address,
    }),
  ]);
else if (
  config.data.authority !== keys.authority.address ||
  config.data.usdcMint !== keys.usdc.address
)
  throw new Error('Protocol configuration differs from the fixture');
const slot = await rpc.getSlot({ commitment: 'finalized' }).send();
const now = await rpc.getBlockTime(slot).send();
if (now === null) throw new Error('Validator clock is unavailable');
const policy = await fetchMaybeAssetPolicy(rpc, accounts.policy, { commitment: 'finalized' });
if (!policy.exists)
  await execute('Creating the asset policy', [
    getCreateAssetPolicyInstruction({
      authority: keys.authority,
      config: accounts.config,
      policy: accounts.policy,
      mint: keys.underlying.address,
      terms: { enabled: true, reviewedUntil: now + 86400n, maxExpiry: now + 86400n },
    }),
  ]);
else if (policy.data.mint !== keys.underlying.address)
  throw new Error('Asset policy differs from the fixture');
if (!(await fetchMaybeAgreement(rpc, accounts.agreement, { commitment: 'finalized' })).exists) {
  await execute(
    'Creating the funded offer',
    [
      getCreateOfferInstruction({
        ...accounts,
        writer: keys.writer,
        underlyingMint: keys.underlying.address,
        usdcMint: keys.usdc.address,
        writerUsdc: keys.writerUsdc.address,
        nonce: 1n,
        designatedHolder: keys.holder.address,
        quantityRaw: BigInt(recipe.quantityRaw),
        payout: BigInt(recipe.payout),
        premium: BigInt(recipe.premium),
        acceptBefore: now + BigInt(recipe.acceptanceSeconds),
        expiresAt: now + BigInt(recipe.protectionSeconds),
      }),
    ],
    keys.writer,
  );
}
await rename(`${values.manifest}.pending`, values.manifest);
console.log(
  `[bootstrap] Local fixture ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${accounts.agreement}`,
);
