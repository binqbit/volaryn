import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createSolanaRpc, lamports, type Instruction } from '@solana/kit';
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
import { demoBalances, fixtureAssets, fixtureUnits } from './assets';
import { fixtureTokens } from './tokens';
import { withProgress } from './progress';
import type { components } from '../../frontend/src/lib/api/schema';

const { values } = parseArgs({
  options: {
    'rpc-url': { type: 'string', default: 'http://127.0.0.1:8899' },
    manifest: { type: 'string', default: 'target/localnet/deployment.json' },
    program: { type: 'string', default: 'target/deploy/volaryn.so' },
    'top-up': { type: 'boolean', default: false },
  },
});
const endpoint = new URL(values['rpc-url']);
if (!['127.0.0.1', 'localhost', 'validator'].includes(endpoint.hostname))
  throw new Error('Bootstrap is restricted to the local validator');
const rpc = createSolanaRpc(endpoint.toString());
const started = Date.now();
console.log('[bootstrap] Verifying the local ledger and program');
const keys = await fixtureSigners();
const assets = await fixtureAssets();
const tokens = fixtureTokens(rpc, keys.authority);
const program = await readFile(values.program);
const programSha256 = createHash('sha256').update(program).digest('hex');
const genesisHash = await rpc.getGenesisHash().send();
const accounts = await protocolAddresses(assets[0]!.mint.address, keys.writer.address, 1n);
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
  schemaVersion: 2,
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
  assets: assets.map(({ asset }) => asset),
  writerUsdc: keys.writerUsdc.address,
  holderUsdc: keys.holderUsdc.address,
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
  throw new Error(
    'Deployment identity differs from the existing fixture manifest. Use a fresh localnet for the PreStocks fixtures; see docs/development.md. Existing data was not reset.',
  );
await mkdir(dirname(values.manifest), { recursive: true });
await writeFile(`${values.manifest}.pending`, JSON.stringify(manifest, null, 2) + '\n');

async function execute(label: string, instructions: Instruction[], payer = keys.authority) {
  return withProgress(`${label}; waiting for finalization`, () =>
    sendAndFinalize(rpc, payer, instructions),
  );
}
console.log('[bootstrap] Initializing missing fixtures; a fresh ledger can take several minutes');
await Promise.all(
  (
    [
      ['authority', keys.authority],
      ['writer', keys.writer],
      ['holder', keys.holder],
    ] as const
  ).map(async ([role, participant]) => {
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
  }),
);

await tokens.createMint(keys.usdc, recipe.decimals, false);
await Promise.all([
  tokens.fundAccount(
    keys.writerUsdc,
    keys.writer.address,
    keys.usdc.address,
    demoBalances.usdc,
    recipe.decimals,
    false,
    values['top-up'],
  ),
  tokens.fundAccount(
    keys.holderUsdc,
    keys.holder.address,
    keys.usdc.address,
    demoBalances.usdc,
    recipe.decimals,
    false,
    values['top-up'],
  ),
]);
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
// Eight independent assets share one protocol and USDC reserve mint.
await Promise.all(
  assets.map(async ({ mint, holderAccount, writerAccount, asset }) => {
    await tokens.createMint(mint, asset.decimals, true);
    await Promise.all(
      [
        { account: holderAccount, owner: keys.holder.address },
        { account: writerAccount, owner: keys.writer.address },
      ].map(({ account, owner }) =>
        tokens.fundAccount(
          account,
          owner,
          mint.address,
          demoBalances.tokenUnits * 10n ** BigInt(asset.decimals),
          asset.decimals,
          true,
          values['top-up'],
        ),
      ),
    );
    const addresses = await protocolAddresses(mint.address, keys.writer.address, 1n);
    const policy = await fetchMaybeAssetPolicy(rpc, addresses.policy, { commitment: 'finalized' });
    if (!policy.exists)
      await execute(`Admitting ${asset.symbol} local replica`, [
        getCreateAssetPolicyInstruction({
          authority: keys.authority,
          config: addresses.config,
          policy: addresses.policy,
          mint: mint.address,
          terms: { enabled: true, reviewedUntil: now + 86400n, maxExpiry: now + 86400n },
        }),
      ]);
    else if (policy.data.mint !== mint.address || policy.data.decimals !== asset.decimals)
      throw new Error('Asset policy differs from the fixture');
  }),
);

// Give the market two real funded fixtures; other assets are ready for user-created offers.
for (const [index, { mint, asset }] of assets.slice(0, 2).entries()) {
  const nonce = BigInt(index + 1);
  const addresses = await protocolAddresses(mint.address, keys.writer.address, nonce);
  if (!(await fetchMaybeAgreement(rpc, addresses.agreement, { commitment: 'finalized' })).exists) {
    await execute(
      `Creating the ${asset.symbol} funded offer`,
      [
        getCreateOfferInstruction({
          ...addresses,
          writer: keys.writer,
          underlyingMint: mint.address,
          usdcMint: keys.usdc.address,
          writerUsdc: keys.writerUsdc.address,
          nonce,
          designatedHolder: keys.holder.address,
          quantityRaw: fixtureUnits(recipe.quantityRaw, asset.decimals),
          payout: BigInt(recipe.payout),
          premium: BigInt(recipe.premium),
          acceptBefore: now + BigInt(recipe.acceptanceSeconds),
          expiresAt: now + BigInt(recipe.protectionSeconds),
        }),
      ],
      keys.writer,
    );
  }
}
await rename(`${values.manifest}.pending`, values.manifest);
console.log(
  `[bootstrap] Local fixture ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${accounts.agreement}`,
);
