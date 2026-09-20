import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export function start(command: string, args: string[], log: string, env = process.env) {
  const output = createWriteStream(log);
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on('error', (error) => output.write(`${error.message}\n`));
  child.on('close', () => output.end());
  return child;
}

export async function finish(child: ChildProcess) {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Process exited ${child.exitCode}`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Process exited ${code ?? signal}`)),
    );
  });
}

export async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitFor(url: string, child?: ChildProcess, body?: object) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child && (!child.pid || child.exitCode !== null || child.signalCode !== null))
      throw new Error(`Service exited before readiness: ${url}`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        ...(body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });
      if (
        response.ok &&
        (!body || ((await response.json()) as { result?: string }).result === 'ok')
      )
        return;
    } catch {
      /* Startup is retried until the bounded readiness deadline. */
    }
    await delay(250);
  }
  throw new Error(`Service did not become ready: ${url}`);
}
