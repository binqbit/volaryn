import { createServer, request } from 'node:http';

/** Same-origin, byte-preserving HTTP hop used by the isolated test browser. */
export async function browserProxy(upstreamOrigin: URL) {
  const server = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        hostname: upstreamOrigin.hostname,
        port: upstreamOrigin.port,
        path: incoming.url ?? '/',
        method: incoming.method,
        headers: incoming.headers,
        timeout: 30_000,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timed out')));
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('aborted', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = server.address();
  if (!endpoint || typeof endpoint === 'string')
    throw new Error('Browser loopback endpoint is unavailable');
  return { server, origin: `http://127.0.0.1:${endpoint.port}` };
}
