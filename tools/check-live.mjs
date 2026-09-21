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
    'Local test wallet',
    'Local test writer',
    'Disposable localnet wallet',
    'Sign this local test transaction',
    'createKeyPairSignerFromPrivateKeyBytes',
  ]) {
    assert(!content.includes(marker), `Local signer leaked into live bundle: ${name}`);
  }
  assert(!/^wallet-/.test(name), 'A disposable wallet chunk exists in the live build');
}
console.log('Live frontend excludes the disposable wallet implementation.');
