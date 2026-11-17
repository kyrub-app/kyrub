import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { attestKey, createChallenge, verifyKeyAttestation } from '../scripts/lib/firebase-key-attestation.mjs';

// Ephemeral synthetic keys only; no production credentials in tests.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const id = 'a'.repeat(40);
const now = 1_800_000_000_000;
const context = {
  projectId: 'prj_test', teamId: 'team_test', deploymentId: 'dpl_test',
  deploymentUrl: 'test.vercel.app', gitSha: 'b'.repeat(40), environment: 'preview',
  serviceAccountEmail: 'test@kyrub-b8d0e.iam.gserviceaccount.com',
};
const credentials = {
  type: 'service_account', project_id: 'kyrub-b8d0e', client_email: context.serviceAccountEmail,
  private_key_id: id, private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const env = {
  VERCEL: '1', VERCEL_URL: context.deploymentUrl, VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_SHA: context.gitSha, VERCEL_PROJECT_ID: context.projectId,
  VERCEL_ORG_ID: context.teamId, VERCEL_DEPLOYMENT_ID: context.deploymentId,
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials),
};
const keys = { [id]: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
const challenge = createChallenge(context, now);
const proof = attestKey(challenge, env, now);
const rejected = fn => assert.throws(fn, { message: 'ATTESTATION_REJECTED' });

test('proves possession with trusted public key without claiming deployment coverage', () => {
  const result = verifyKeyAttestation(proof, challenge, keys, now);
  assert.equal(result.keyId, id);
  assert.equal(result.conclusion, 'KEY_POSSESSION_ONLY');
  assert.equal(result.requiresProviderDeploymentEvidence, true);
  assert.equal(result.writersVerified, false);
  assert.equal(JSON.stringify(proof).includes('PRIVATE KEY'), false);
  assert.equal(JSON.stringify(proof).includes('private_key'), false);
});
test('uses unpredictable independent challenges', () => {
  const second = createChallenge(context, now);
  assert.notEqual(challenge.nonce, second.nonce);
  rejected(() => verifyKeyAttestation(proof, second, keys, now));
});
test('rejects expired and not-yet-valid evidence', () => {
  for (const time of [now - 1, now + 300_000]) {
    rejected(() => attestKey(challenge, env, time));
    rejected(() => verifyKeyAttestation(proof, challenge, keys, time));
  }
});
test('rejects altered challenge and excessive validity', () => {
  for (const change of [{ nonce: 'c'.repeat(64) }, { deploymentId: 'another' }, { expiresAt: now + 600_000 }]) {
    rejected(() => verifyKeyAttestation(proof, { ...challenge, ...change }, keys, now));
  }
});
test('rejects wrong deployment, commit, environment and injected platform metadata', () => {
  for (const field of ['VERCEL', 'VERCEL_URL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID', 'VERCEL_DEPLOYMENT_ID']) {
    rejected(() => attestKey(challenge, { ...env, [field]: 'wrong' }, now));
  }
});
test('rejects missing required workload metadata', () => {
  for (const field of ['VERCEL', 'VERCEL_URL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'FIREBASE_SERVICE_ACCOUNT_JSON']) {
    const missing = { ...env }; delete missing[field];
    rejected(() => attestKey(challenge, missing, now));
  }
});
test('rejects another project or service account and non-service-account credentials', () => {
  for (const change of [{ project_id: 'another' }, { client_email: 'wrong@example.com' }, { type: 'authorized_user' }, { private_key_id: 'invalid' }]) {
    rejected(() => attestKey(challenge, { ...env, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...credentials, ...change }) }, now));
  }
});
test('does not trust a claimed key ID or public key supplied by the workload', () => {
  rejected(() => verifyKeyAttestation(proof, challenge, {}, now));
  rejected(() => verifyKeyAttestation(proof, challenge, { [id]: other.publicKey.export({ type: 'spki', format: 'pem' }) }, now));
  const impostor = attestKey(challenge, { ...env, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    ...credentials, private_key: other.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }) }, now);
  rejected(() => verifyKeyAttestation(impostor, challenge, keys, now));
});
test('rejects modified signed identity and invalid signatures', () => {
  const modified = structuredClone(proof); modified.payload.keyId = 'd'.repeat(40);
  rejected(() => verifyKeyAttestation(modified, challenge, { ['d'.repeat(40)]: keys[id] }, now));
  rejected(() => verifyKeyAttestation({ ...proof, signature: 'invalid' }, challenge, keys, now));
});
test('domain separation prevents treating this evidence as an OAuth assertion', () => {
  const signature = sign('RSA-SHA256', Buffer.from(JSON.stringify(proof.payload)), pair.privateKey).toString('base64url');
  rejected(() => verifyKeyAttestation({ ...proof, signature }, challenge, keys, now));
  assert.equal(proof.signature.includes('.'), false);
});
test('rejects malformed and oversized secrets without echoing their contents', () => {
  for (const secret of ['SECRET_MARKER{', 'SECRET_MARKER' + 'x'.repeat(32_768)]) {
    rejected(() => attestKey(challenge, { ...env, FIREBASE_SERVICE_ACCOUNT_JSON: secret }, now));
  }
});
test('CLI emits only a stable error for malformed and oversized input', () => {
  for (const input of ['SECRET_MARKER{', 'SECRET_MARKER' + 'x'.repeat(131_072)]) {
    const result = spawnSync(process.execPath, ['scripts/attest-firebase-writer-key.mjs', 'attest'], { input, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'ATTESTATION_REJECTED\n');
  }
});
test('CLI challenge, workload proof and offline verifier round trip', () => {
  const run = (mode, data, extraEnv = {}) => {
    const result = spawnSync(process.execPath, ['scripts/attest-firebase-writer-key.mjs', mode], {
      input: JSON.stringify(data), encoding: 'utf8', env: { ...process.env, ...extraEnv },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  const current = run('challenge', context);
  const evidence = run('attest', current, env);
  const result = run('verify', { challenge: current, proof: evidence, trustedKeys: keys });
  assert.equal(result.keyId, id);
  assert.equal(result.writersVerified, false);
});
test('rejects weak RSA keys', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  rejected(() => attestKey(challenge, { ...env, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    ...credentials, private_key: weak.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }) }, now));
});
