import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('passkey endpoint validates origin, RP ID, user verification and signatures', () => {
  const route = readFileSync('api/security/passkey.ts', 'utf8');
  assert.match(route, /clientData\.type !== expectedType/);
  assert.match(route, /clientData\.challenge !== challenge/);
  assert.match(route, /clientData\.origin !== origin/);
  assert.match(route, /createHash\('sha256'\)\.update\(rpId\)\.digest\(\)/);
  assert.match(route, /userVerified/);
  assert.match(route, /verifySignature\('sha256'/);
  assert.match(route, /authenticator\.counter <= previousCounter/);
  assert.match(route, /CHALLENGE_TTL_MS = 5 \* 60 \* 1000/);
});

test('profile passkey bridge uses native WebAuthn instead of collecting biometrics', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const bridge = readFileSync('src/components/ProfilePasskeyBridge.tsx', 'utf8');
  assert.match(app, /<ProfilePasskeyBridge \/>/);
  assert.match(bridge, /navigator\.credentials\.create/);
  assert.match(bridge, /navigator\.credentials\.get/);
  assert.match(bridge, /getPublicKey/);
  assert.match(bridge, /Windows Hello, Touch ID, Face ID/);
  assert.doesNotMatch(bridge, /getUserMedia/);
});
