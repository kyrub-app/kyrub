import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { build } from 'esbuild';

function runWithRequireEsmDisabled(source: string, format: 'commonjs' | 'module') {
  const result = spawnSync(process.execPath, [
    '--no-experimental-require-module',
    `--input-type=${format}`,
  ], {
    input: source,
    encoding: 'utf8',
    timeout: 10_000,
    // Do not inherit deployment credentials or runtime flags.
    env: {},
  });
  const status = result.stdout.trim();
  assert.equal(result.status, 0, /^ERR_[A-Z_]+$/.test(status) ? status : 'Isolated SDK check failed');
  assert.equal(status, 'PASS');
}

test('packaged preflight handler imports the real SDK with require(esm) disabled', async () => {
  const output = await build({
    entryPoints: ['api/admin/operations/health.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
  });

  runWithRequireEsmDisabled(`
    ${output.outputFiles[0].text}
    const assert = require('node:assert/strict');
    (async () => {
      assert.equal(Boolean(process.features.require_module), false);
      const result = {};
      await module.exports.default({
        method: 'GET',
        headers: { authorization: 'Bearer isolated-fixture' },
        query: { transport: 'firebase-preflight' },
      }, {
        setHeader() {},
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; },
      });
      assert.deepEqual(result, {
        status: 503,
        body: { status: 'FAIL', code: 'AUTHORIZED_RUNTIME_REQUIRED' },
      });
      console.log('PASS');
    })().catch(() => { process.exitCode = 1; });
  `, 'commonjs');
});

test('Firebase Admin Auth loads via native ESM without relying on require(esm)', () => {
  runWithRequireEsmDisabled(`
    import assert from 'node:assert/strict';
    try {
      assert.equal(Boolean(process.features.require_module), false);
      const auth = await import('firebase-admin/auth');
      assert.equal(typeof auth.getAuth, 'function');
      console.log('PASS');
    } catch (error) {
      console.log(error.code === 'ERR_REQUIRE_ESM' ? error.code : 'FAIL');
      process.exitCode = 1;
    }
  `, 'module');
});

test('Firebase Admin JWKS dependency resolves an RSA signing key and rejects unknown keys', () => {
  runWithRequireEsmDisabled(`
    const assert = require('node:assert/strict');
    const { generateKeyPairSync } = require('node:crypto');
    const { createRequire } = require('node:module');
    (async () => {
      const requireFromFirebase = createRequire(require.resolve('firebase-admin/auth'));
      const jwks = requireFromFirebase('jwks-rsa');
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const key = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
      const client = jwks({ cache: false, fetcher: async () => ({ keys: [key] }) });
      const signingKey = await client.getSigningKey('fixture');
      assert.equal(signingKey.getPublicKey(), publicKey.export({ type: 'spki', format: 'pem' }));
      await assert.rejects(client.getSigningKey('missing'), { name: 'SigningKeyNotFoundError' });
      console.log('PASS');
    })().catch(error => {
      console.log(error.code === 'ERR_REQUIRE_ESM' ? error.code : 'FAIL');
      process.exitCode = 1;
    });
  `, 'commonjs');
});
