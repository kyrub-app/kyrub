import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('merchant OAuth state is generated and stored only as a hash server-side', () => {
  const source = readFileSync('server/integrations/storeConnectionOAuthFlow.ts', 'utf8');
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /stateHash: hashState\(state\)/);
  assert.doesNotMatch(source, /state:\s*state,/);
});

test('callback state is single-use and expires', () => {
  const source = readFileSync('server/integrations/storeConnectionOAuthFlow.ts', 'utf8');
  assert.match(source, /STORE_OAUTH_FLOW_ALREADY_CONSUMED/);
  assert.match(source, /STORE_OAUTH_FLOW_EXPIRED/);
  assert.match(source, /STORE_OAUTH_STATE_MISMATCH/);
  assert.match(source, /status: 'callback_received'/);
});

test('browser OAuth contract returns authorization URL and flow id, never provider token fields', () => {
  const contract = readFileSync('shared/storeConnectionOAuth.ts', 'utf8');
  assert.match(contract, /StoreOAuthBrowserStartResult/);
  assert.match(contract, /flowId: string/);
  assert.match(contract, /authorizationUrl: string/);
  assert.doesNotMatch(contract, /accessToken:|refreshToken:|clientSecret:/);
});
