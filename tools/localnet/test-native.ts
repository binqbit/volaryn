import { fixtureAssets } from './assets';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { start, stop, finish, waitFor } from './process';
import {
  applicationEnvironment,
  availablePort,
  checkValidator,
  validatorArguments,
} from './environment';

checkValidator();

// Every run owns its ledger, projection, ports and processes. Nothing is reset in place.
await mkdir('artifacts/localnet', { recursive: true });
const directory = await mkdtemp(resolve('artifacts/localnet/run-'));
console.log(`Localnet test artifacts: ${directory}`);
const rpcPort = await availablePort();
const appPort = await availablePort();
const rpc = `http://127.0.0.1:${rpcPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;
const manifest = `${directory}/deployment.json`;
const validatorArgs = await validatorArguments(directory, rpcPort);
let validator: ChildProcess | undefined;
let app: ChildProcess | undefined;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    interrupted = true;
    void stop(app).then(() => stop(validator));
  });
async function bootValidator(log: string) {
  validator = start('solana-test-validator', validatorArgs, `${directory}/${log}`);
  await waitFor(rpc, validator, { jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] });
}
async function bootApp(log: string) {
  app = start(
    'target/debug/volaryn',
    ['--manifest', manifest, '--rpc-url', rpc, '--bind', `127.0.0.1:${appPort}`],
    `${directory}/${log}`,
    applicationEnvironment(),
  );
  await waitFor(`${appUrl}/health/index`, app);
}
async function bootstrap(log: string) {
  await finish(
    start(
      'node_modules/.bin/tsx',
      ['tools/localnet/bootstrap.ts', '--rpc-url', rpc, '--manifest', manifest],
      `${directory}/${log}`,
    ),
  );
}
async function observations() {
  const response = await fetch(`${appUrl}/api/agreements`);
  assert.equal(response.status, 200);
  return ((await response.json()) as Record<string, unknown>[]).map(
    ({ observedAt: _time, finalizedSlot: _slot, ...agreement }) => agreement,
  );
}
async function fixtureState() {
  const config = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, string>;
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getMultipleAccounts',
      params: [
        [
          config.writerUsdc,
          config.holderUsdc,
          ...(await fixtureAssets()).flatMap((item) => [
            item.holderAccount.address,
            item.writerAccount.address,
          ]),
        ],
        { encoding: 'base64', commitment: 'finalized' },
      ],
    }),
  });
  return ((await response.json()) as { result: { value: unknown[] } }).result.value;
}
try {
  await bootValidator('validator.log');
  await bootstrap('bootstrap.log');
  await bootApp('app.log');
  await finish(
    start('node_modules/.bin/playwright', ['test'], `${directory}/browser.log`, {
      ...process.env,
      VOLARYN_TEST_APP: appUrl,
    }),
  );
  const before = await observations();
  const pgdata = process.env.VOLARYN_TEST_PGDATA;
  if (!pgdata || !process.env.VOLARYN_TEST_DATABASE_URL)
    throw new Error('Use the isolated PostgreSQL test runner');
  await finish(
    start('pg_ctl', ['-D', pgdata, '-m', 'fast', '-w', 'stop'], `${directory}/database-stop.log`),
  );
  assert.equal(
    (await fetch(`${appUrl}/health/index`)).status,
    503,
    'Database outage must remove index readiness',
  );
  assert.equal(
    (await fetch(`${appUrl}/health/live`)).status,
    200,
    'The application must remain alive during a database outage',
  );
  assert.equal(
    (await fetch(`${appUrl}/health/ready`)).status,
    200,
    'Verified chain transport remains ready',
  );
  assert.equal((await fetch(`${appUrl}/api/config`)).status, 200);
  const first = before[0];
  assert.ok(first, 'The fixture agreement must remain indexed');
  const detail = await fetch(`${appUrl}/api/agreements/${first.address}`);
  assert.equal(detail.status, 200, 'Direct agreement reads survive index failure');
  const rpcResponse = await fetch(`${appUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
  });
  assert.equal(rpcResponse.status, 200, 'Read-only chain transport survives index failure');
  await finish(
    start(
      'pg_ctl',
      [
        '-D',
        pgdata,
        '-l',
        `${directory}/database-restart.log`,
        '-o',
        `-h 127.0.0.1 -p ${process.env.PGPORT} -k ''`,
        '-w',
        'start',
      ],
      `${directory}/database-start.log`,
    ),
  );
  await waitFor(`${appUrl}/health/index`, app);
  assert.deepEqual(
    await observations(),
    before,
    'Database restart must preserve financial observations',
  );
  const balances = await fixtureState();
  const identity = await readFile(manifest, 'utf8');
  await stop(app);
  await stop(validator);
  await bootValidator('validator-restart.log');
  await bootstrap('bootstrap-restart.log');
  assert.equal(await readFile(manifest, 'utf8'), identity, 'Bootstrap must retain ledger identity');
  assert.deepEqual(await fixtureState(), balances, 'Bootstrap must not reset used token balances');
  await bootApp('app-restart.log');
  assert.deepEqual(await observations(), before, 'Restart must retain finalized agreements');
  await stop(app);
  execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'TRUNCATE agreements, reconciliation;'],
    { stdio: 'ignore' },
  );
  await bootApp('app-rebuild.log');
  assert.deepEqual(
    await observations(),
    before,
    'An empty projection must rebuild from the same ledger',
  );
  assert.equal(interrupted, false);
  await writeFile(
    `${directory}/result.json`,
    JSON.stringify(
      {
        passed: true,
        browser: true,
        restart: true,
        databaseOutageRecovery: true,
        bootstrapIdempotency: true,
        projectionRebuild: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Browser settlement, PostgreSQL outage recovery, ledger restart, bootstrap idempotency and projection rebuild passed.',
  );
} finally {
  await stop(app);
  await stop(validator);
}
