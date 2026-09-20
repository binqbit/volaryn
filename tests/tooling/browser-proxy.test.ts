import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { browserProxy } from '../../tools/localnet/browser-proxy';

test('the browser loopback hop preserves exact RPC bodies, response errors and paths', async () => {
  let received = '';
  let path: string | undefined;
  const upstream = createServer((request, response) => {
    path = request.url;
    request.on('data', (chunk: Buffer) => {
      received += chunk.toString();
    });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"data":{"amount":18446744073709551615}}}',
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const endpoint = upstream.address();
  if (!endpoint || typeof endpoint === 'string') throw new Error('No test endpoint');
  const proxy = await browserProxy(new URL(`http://127.0.0.1:${endpoint.port}`));
  try {
    const body = '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":[18446744073709551615]}';
    const response = await fetch(`${proxy.origin}/rpc?test=1`, { method: 'POST', body });
    expect(received).toBe(body);
    expect(path).toBe('/rpc?test=1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(
      '{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"data":{"amount":18446744073709551615}}}',
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      proxy.server.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
