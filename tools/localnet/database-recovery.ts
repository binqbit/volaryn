import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/** Restore into a new database in the harness-owned cluster; never replace the running database. */
export function restoreBackup(directory: string) {
  const source = process.env.DATABASE_URL;
  const administrator = process.env.VOLARYN_TEST_DATABASE_URL;
  assert(
    source && administrator && process.env.VOLARYN_TEST_PGDATA,
    'Use the isolated PostgreSQL harness',
  );
  const admin = new URL(administrator);
  assert(
    ['localhost', '127.0.0.1'].includes(admin.hostname),
    'Restore rehearsals require the owned loopback cluster',
  );
  const name = `volaryn_restore_${process.pid}`;
  const env = {
    ...process.env,
    PGUSER: decodeURIComponent(admin.username),
    PGPASSWORD: decodeURIComponent(admin.password),
    PGDATABASE: 'postgres',
  };
  execFileSync('pg_dump', ['--format=custom', '--file', `${directory}/database.dump`], {
    stdio: 'pipe',
  });
  execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${name} OWNER volaryn`],
    { env, stdio: 'pipe' },
  );
  execFileSync(
    'pg_restore',
    [
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      name,
      `${directory}/database.dump`,
    ],
    { stdio: 'pipe' },
  );
  const state = (database: string) =>
    execFileSync(
      'psql',
      [
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '--dbname',
        database,
        '-f',
        'tools/postgres/recovery-state.sql',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  assert.equal(
    state(name),
    state('volaryn'),
    'The restored database must retain all application and migration records',
  );
  const restored = new URL(source);
  restored.pathname = `/${name}`;
  return restored.toString();
}
