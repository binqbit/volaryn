import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const files = await readdir('frontend/dist-live/assets');
assert(
  files.some((name) => name.endsWith('.js')),
  'Missing live frontend build',
);
for (const name of files) {
  const content = await readFile(`frontend/dist-live/assets/${name}`, 'utf8');
  for (const marker of [
    'Test Wallet 1',
    'Test Wallet 2',
    'Disposable localnet wallet',
    'createKeyPairSignerFromPrivateKeyBytes',
    'LOCALNET DEMO',
    'PRESTOCKS · LOCAL DEMO',
    'Test tokens · no real funds',
    'Use two test wallets',
    'local demo replicas',
    'Local replicas of reviewed PreStocks',
    'PreStocks demo balances',
    'PreStocks demo tokens',
    'test USDC',
    'Local demo',
    'Local mint',
    'Local settlement mint',
    'provided test wallet',
    'disposable replica demonstrates',
    'separate from your local test wallet',
  ]) {
    assert(
      !content.includes(marker),
      `Local-only content leaked into live bundle: ${name}: ${marker}`,
    );
  }
  assert(!/^wallet-/.test(name), 'A disposable wallet chunk exists in the live build');
}
console.log('Live frontend excludes disposable wallets and demo UI content.');
