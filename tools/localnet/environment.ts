import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

export function checkValidator() {
  assert.match(
    execFileSync('solana-test-validator', ['--version'], { encoding: 'utf8' }),
    /^solana-test-validator 4\.0\.3 /,
    'Install the pinned Agave validator',
  );
}

export async function availablePort(requested = 0) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port allocated');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

export async function validatorArguments(directory: string, rpcPort: number) {
  return [
    '--ledger',
    `${directory}/ledger`,
    // Agave's 10,000-shred default can prune past the latest snapshot.
    '--limit-ledger-size',
    '1000000',
    '--rpc-port',
    String(rpcPort),
    '--faucet-port',
    String(await availablePort()),
    '--gossip-port',
    String(await availablePort()),
    '--bind-address',
    '127.0.0.1',
    '--upgradeable-program',
    'Fg6PaFpoGXkYsidMpWxTWqkZcEYKpEjzMTB7zLZJwQYQ',
    'target/deploy/volaryn.so',
    'AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9',
    '--bpf-program',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'target/fixtures/spl_token-3.5.0.so',
    '--bpf-program',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    'target/fixtures/spl_token_2022-11.0.0.so',
    '--quiet',
  ];
}

export function applicationEnvironment() {
  // Administrative credentials belong to the test runner, never the application.
  const env = { ...process.env };
  delete env.VOLARYN_TEST_DATABASE_URL;
  delete env.VOLARYN_TEST_PGDATA;
  return env;
}
