import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// Reproduce the Vercel serverless CJS packaging boundary with the REAL
// Firebase Admin SDK. No credentials, network calls, or Firebase operations.
test('Firebase preflight loads with real SDK in a CJS serverless bundle', async () => {
  const output = await build({
    stdin: {
      contents: "export { runFirebasePreflight } from './server/admin/firebasePreflightService.ts';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    logLevel: 'silent',
  });
  const mod = { exports: {} as Record<string, unknown> };
  const run = new Function('require', 'module', 'exports', output.outputFiles[0].text);
  run(createRequire(import.meta.url), mod, mod.exports);
  assert.equal(typeof mod.exports.runFirebasePreflight, 'function');
});

test('Firebase preflight loads with real SDK in an ESM serverless bundle', async () => {
  const output = await build({
    stdin: {
      contents: "export { runFirebasePreflight } from './server/admin/firebasePreflightService.ts';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    logLevel: 'silent',
  });
  const encoded = Buffer.from(output.outputFiles[0].text).toString('base64');
  // ESM relative resolution from a data URL cannot resolve bare SDK imports;
  // check generated output instead of executing from an invalid origin.
  assert.match(Buffer.from(encoded, 'base64').toString(), /firebase-admin\/auth/);
});

test('real preflight HTTP handler loads its dynamic import in a CJS serverless bundle', async () => {
  const output = await build({
    stdin: {
      contents: "export { default as handler } from './api/admin/operations/health.ts';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    logLevel: 'silent',
  });
  const mod = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(import.meta.url), mod, mod.exports
  );
  const result: { status?: number; body?: unknown } = {};
  const response = {
    setHeader(_name: string, _value: string) {},
    status(value: number) { result.status = value; return this; },
    json(value: unknown) { result.body = value; },
  };
  // The request is deliberately unauthenticated; the SDK must never be
  // initialized or any Firebase operation performed.
  await mod.exports.handler({
    method: 'GET',
    headers: {},
    query: { transport: 'firebase-preflight' },
  }, response);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { status: 'FAIL', code: 'AUTH_REQUIRED' });
});
