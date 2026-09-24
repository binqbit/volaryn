import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('binds bundled bytes to a revision and emits mainnet identities without local participants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'volaryn-release-'));
  const program = Buffer.from([0, 1, 7, 255]);
  const revision = 'a'.repeat(40);
  const registry = JSON.parse(await readFile('config/assets.json', 'utf8'));
  const idl = JSON.parse(await readFile('packages/protocol/idl/volaryn.json', 'utf8'));
  try {
    for (const path of ['target/deploy', 'packages/protocol/idl', 'packages/api', 'config'])
      await mkdir(join(directory, path), { recursive: true });
    for (const [path, bytes] of Object.entries({
      'target/deploy/volaryn.so': program,
      'packages/protocol/idl/volaryn.json': JSON.stringify(idl),
      'packages/api/openapi.json': '{}',
      'config/assets.json': JSON.stringify(registry),
      'Cargo.lock': 'locked-rust',
      'package-lock.json': '{}',
    }))
      await writeFile(join(directory, path), bytes);
    execFileSync(process.execPath, [resolve('tools/release/metadata.mjs'), 'bundle', revision], {
      cwd: directory,
    });
    const output = join(directory, 'bundle');
    const release = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'));
    expect(release.revision).toBe(revision);
    expect(release.programSha256).toBe(createHash('sha256').update(program).digest('hex'));
    expect(release.programLength).toBe(program.length);
    expect(release.programId).toBe(idl.address);
    for (const [name, fingerprint] of Object.entries(release.files))
      expect(
        createHash('sha256')
          .update(await readFile(join(output, name)))
          .digest('hex'),
      ).toBe(fingerprint);
    const manifest = JSON.parse(await readFile(join(output, 'deployment.example.json'), 'utf8'));
    expect(manifest.mode).toBe('mainnet');
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.genesisHash).toBe(registry.genesisHash);
    expect(manifest.localnet).toBeUndefined();
    expect(manifest.usdcMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(manifest.assets.map((asset: { mint: string }) => asset.mint)).toEqual(
      registry.assets.map((asset: { mint: string }) => asset.mint),
    );
    expect(
      manifest.assets.every(
        (asset: { mint: string; referenceMint: string }) => asset.mint === asset.referenceMint,
      ),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
