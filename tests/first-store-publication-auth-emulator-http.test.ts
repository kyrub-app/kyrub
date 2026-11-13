import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';

const expectedProject = 'kyrub-security-test';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
assert.equal(process.env.FIREBASE_PROJECT_ID, expectedProject);
assert.equal(process.env.GCLOUD_PROJECT, expectedProject);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, expectedProject);
assert.equal(process.env.KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL, 'true');
assert.equal(process.env.NODE_ENV === 'production', false);

const app = getApps()[0] ?? initializeApp({ projectId: expectedProject });
const auth = getAuth(app);
const uid = 'publication_browser_e2e_fictional';
const user = await auth.createUser({ uid, email: 'publication-browser-e2e@example.invalid' }).catch(async (error: unknown) => {
  if ((error as { code?: string }).code === 'auth/uid-already-exists') return auth.getUser(uid);
  throw error;
});
assert.equal(user.uid, uid);

// Firebase Auth Emulator accepts its own unsigned ID tokens. Exchange a custom
// token through the emulator endpoint; never contact identitytoolkit.googleapis.com.
const customToken = await auth.createCustomToken(uid);
const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-emulator-key', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const signInBody = await signIn.text();
assert.equal(signIn.status, 200, signInBody);
const token = (JSON.parse(signInBody) as { idToken?: string }).idToken;
assert.ok(token);
assert.equal((await auth.verifyIdToken(token)).uid, uid);

const { handleFirstStorePublication } = await import('../server/gamification/firstStorePublicationHandler.js');
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const response = {
    setHeader: (key: string, value: string) => { res.setHeader(key, value); },
    status: (code: number) => { res.statusCode = code; return response; },
    json: (payload: unknown) => { res.end(JSON.stringify(payload)); },
  };
  await handleFirstStorePublication({ method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : {} }, response);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
after(() => server.close());
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/action-execute?transport=first-store-publication`;

test('emulator token reaches authenticated publication handler and rejects invalid store ID', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish', canonicalStoreId: 'invalid/id' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, 'INVALID_CANONICAL_STORE_ID');
});

test('emulator handler rejects missing bearer token', async () => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'publish', canonicalStoreId: 'fictional_store' }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: string }).error, 'AUTH_REQUIRED');
});
