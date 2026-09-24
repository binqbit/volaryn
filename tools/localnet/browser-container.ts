import { spawn } from 'node:child_process';
import { browserProxy } from './browser-proxy';
import { seedBrowserFixtures } from './browser-fixtures';

await seedBrowserFixtures('http://validator:8899', 'http://app:8080');

// Wallet Standard needs a secure browser context. Only this test container's
// loopback forwarder reaches the app on the private Compose network.
const { server, origin } = await browserProxy(new URL('http://app:8080'));
const child = spawn('node_modules/.bin/playwright', ['test'], {
  stdio: 'inherit',
  env: { ...process.env, VOLARYN_TEST_APP: origin },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
  server.close();
});
