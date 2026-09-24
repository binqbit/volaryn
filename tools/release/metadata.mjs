import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Called inside the release build; no network reads and no deployment credentials.
const [directory, revision] = process.argv.slice(2);
if (!directory || !/^[a-f0-9]{40}$/.test(revision ?? ''))
  throw new Error('Usage: metadata.mjs OUTPUT_DIRECTORY FULL_GIT_REVISION');
const program = await readFile('target/deploy/volaryn.so');
const idl = JSON.parse(await readFile('packages/protocol/idl/volaryn.json', 'utf8'));
const registry = JSON.parse(await readFile('config/assets.json', 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(directory, { recursive: true });
const files = {
  'volaryn.so': program,
  'volaryn.json': await readFile('packages/protocol/idl/volaryn.json'),
  'openapi.json': await readFile('packages/api/openapi.json'),
  'assets.json': await readFile('config/assets.json'),
  'Cargo.lock': await readFile('Cargo.lock'),
  'package-lock.json': await readFile('package-lock.json'),
};
const release = {
  revision,
  programId: idl.address,
  programSha256: hash(program),
  programLength: program.length,
  files: {},
};
for (const [name, bytes] of Object.entries(files)) {
  await writeFile(join(directory, name), bytes);
  release.files[name] = hash(bytes);
}
await writeFile(join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n');
await writeFile(
  join(directory, 'deployment.example.json'),
  JSON.stringify(
    {
      schemaVersion: 3,
      mode: 'mainnet',
      genesisHash: registry.genesisHash,
      programId: release.programId,
      programSha256: release.programSha256,
      programLength: release.programLength,
      authority: 'REPLACE_WITH_PROTOCOL_AUTHORITY',
      upgradeAuthority: 'REPLACE_WITH_UPGRADE_AUTHORITY_OR_NULL',
      usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      assets: registry.assets.map(({ mint, name, symbol, decimals, source }) => ({
        mint,
        referenceMint: mint,
        name,
        symbol,
        decimals,
        source,
      })),
    },
    null,
    2,
  ) + '\n',
);
