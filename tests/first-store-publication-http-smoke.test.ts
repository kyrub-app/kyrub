import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, test } from 'node:test';

// HTTP-level contract against the real serverless handler, without any live
// Firebase credentials or database calls. The flag stays disabled by default.
const { default: handler } = await import('../api/action-execute.js');
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  let body: unknown;
  try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
  const response = {
    setHeader: (key: string, value: string) => { res.setHeader(key, value); },
    status: (code: number) => { res.statusCode = code; return response; },
    json: (payload: unknown) => { res.end(JSON.stringify(payload)); },
  };
  await handler({ method: req.method, headers: req.headers, query: { transport: url.searchParams.get('transport') ?? '' }, body }, response);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
after(() => server.close());
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/action-execute?transport=first-store-publication`;

test('HTTP publication endpoint rejects GET', async () => {
  const response = await fetch(endpoint);
  assert.equal(response.status, 405);
  assert.equal((await response.json() as { code: string }).code, 'METHOD_NOT_ALLOWED');
});

test('HTTP publication endpoint fails closed without server enable flag', async () => {
  const prior = process.env.KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED;
  delete process.env.KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', canonicalStoreId: 'fake_store' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: string }).error, 'FIRST_STORE_PUBLICATION_NOT_ENABLED');
  } finally {
    if (prior === undefined) delete process.env.KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED;
    else process.env.KYRUB_FIRST_STORE_PUBLICATION_SERVER_ENABLED = prior;
  }
});
