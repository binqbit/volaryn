import { type ChildProcess } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applicationEnvironment,
  availablePort,
  checkValidator,
  validatorArguments,
} from './environment';
import { finish, start, stop, waitFor } from './process';

checkValidator();
for (const file of ['target/debug/volaryn', 'target/deploy/volaryn.so', 'frontend/dist/index.html'])
  await access(file);
const directory = resolve('target/localnet');
await mkdir(directory, { recursive: true });
const appPort = await availablePort(8080);
const rpcPort = await availablePort();
const rpc = `http://127.0.0.1:${rpcPort}`;
const url = `http://localhost:${appPort}`;
const manifest = `${directory}/deployment.json`;
let validator: ChildProcess | undefined;
let bootstrap: ChildProcess | undefined;
let app: ChildProcess | undefined;
let interrupted = false;
let shutdown: (() => void) | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    interrupted = true;
    shutdown?.();
    void stop(bootstrap)
      .then(() => stop(app))
      .then(() => stop(validator));
  });

try {
  console.log(`Starting localnet; logs and persistent data: ${directory}`);
  validator = start(
    'solana-test-validator',
    await validatorArguments(directory, rpcPort),
    `${directory}/validator.log`,
  );
  await waitFor(rpc, validator, { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] });
  bootstrap = start(
    'node_modules/.bin/tsx',
    ['tools/localnet/bootstrap.ts', '--rpc-url', rpc, '--manifest', manifest],
    `${directory}/bootstrap.log`,
  );
  await finish(bootstrap);
  if (interrupted) throw new Error('Local startup interrupted');
  app = start(
    'target/debug/volaryn',
    ['--manifest', manifest, '--rpc-url', rpc, '--bind', `127.0.0.1:${appPort}`],
    `${directory}/app.log`,
    applicationEnvironment(),
  );
  await waitFor(`${url}/health/index`, app);
  console.log(`Volaryn is ready at ${url}. Ctrl+C stops services and retains their data.`);
  await Promise.race([
    finish(app).then(() => {
      if (!interrupted) throw new Error('Application stopped unexpectedly');
    }),
    finish(validator).then(() => {
      if (!interrupted) throw new Error('Validator stopped unexpectedly');
    }),
    new Promise<void>((resolve) => {
      shutdown = resolve;
    }),
  ]);
} catch (error) {
  if (!interrupted) throw error;
} finally {
  await stop(bootstrap);
  await stop(app);
  await stop(validator);
}
