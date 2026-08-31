import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Mercado Livre OAuth persists only a hash of the bearer-like state', async () => {
  const source = await read('server/integrations/mercadoLivreOauthService.ts');

  assert.match(source, /const hashOAuthState = \(state: string\): string =>/);
  assert.match(source, /createHash\('sha256'\)\.update\(state\)\.digest\('hex'\)/);
  assert.match(source, /const stateHash = hashOAuthState\(state\)/);
  assert.match(source, /adminDb\.doc\(statePath\(stateHash\)\)\.create\(\{/);
  assert.match(source, /stateHash,/);
  assert.doesNotMatch(source, /adminDb\.doc\(statePath\(state\)\)/);
  assert.doesNotMatch(source, /\.create\(\{\s*state,/);
});

test('Mercado Livre callback hashes incoming state before the one-time lookup', async () => {
  const source = await read('server/integrations/mercadoLivreOauthService.ts');

  assert.match(source, /const state = stateInput\.trim\(\)/);
  assert.match(source, /const stateHash = hashOAuthState\(state\)/);
  assert.match(source, /const reference = adminDb\.doc\(statePath\(stateHash\)\)/);
  assert.match(source, /data\.stateHash !== stateHash/);
  assert.match(source, /transaction\.delete\(reference\)/);
});

test('OAuth state hardening preserves PKCE and server-side tenant authority', async () => {
  const oauth = await read('server/integrations/mercadoLivreOauthService.ts');
  const router = await read('server/integrations/mercadoLivreRouter.ts');

  assert.match(oauth, /code_challenge_method', 'S256'/);
  assert.match(oauth, /code_verifier: verifier/);
  assert.match(oauth, /return \{ storeId: data\.storeId, verifier: decrypted\.verifier \}/);
  assert.match(router, /completeMercadoLivreAuthorization\(\{ code, state \}\)/);
  assert.doesNotMatch(router, /request\.query\.storeId/);
});
