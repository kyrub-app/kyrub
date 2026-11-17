import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

const DOMAIN = 'kyrub/firebase-writer-key-attestation/v1\n';
const fail = () => { throw new Error('ATTESTATION_REJECTED'); };
const fields = ['projectId', 'teamId', 'deploymentId', 'deploymentUrl', 'gitSha', 'environment', 'serviceAccountEmail'];
function validateChallenge(c, now) {
  if (!c || c.version !== 1 || !/^[a-f0-9]{64}$/.test(c.nonce)) fail();
  if (!Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt)
    || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 300_000
    || now < c.issuedAt || now >= c.expiresAt) fail();
  for (const field of fields) if (typeof c[field] !== 'string' || !c[field] || c[field].length > 256) fail();
  if (!/^[a-f0-9]{40}$/.test(c.gitSha) || !['production', 'preview'].includes(c.environment)) fail();
  if (!/^[a-z0-9.-]+$/.test(c.deploymentUrl) || !c.serviceAccountEmail.endsWith('.iam.gserviceaccount.com')) fail();
}
function canonical(c) {
  return Object.fromEntries(['version', 'nonce', 'issuedAt', 'expiresAt', ...fields].map(k => [k, c[k]]));
}
export function createChallenge(context, now = Date.now()) {
  const c = { ...context, version: 1, nonce: randomBytes(32).toString('hex'), issuedAt: now, expiresAt: now + 300_000 };
  validateChallenge(c, now);
  return canonical(c);
}

// No Firebase SDK, OAuth, network, logging or database writes. Read the same
// existing credential variable as server/firebaseAdmin.ts, inside its workload.
export function attestKey(challenge, env = process.env, now = Date.now()) {
  try {
    validateChallenge(challenge, now);
    if (env.VERCEL !== '1' || env.VERCEL_URL !== challenge.deploymentUrl
      || env.VERCEL_GIT_COMMIT_SHA !== challenge.gitSha || env.VERCEL_ENV !== challenge.environment) fail();
    // Optional platform metadata must agree when injected. These checks are
    // consistency checks, not provider authentication of environment variables.
    for (const [key, field] of [['VERCEL_PROJECT_ID', 'projectId'], ['VERCEL_ORG_ID', 'teamId'], ['VERCEL_DEPLOYMENT_ID', 'deploymentId']]) {
      if (env[key] && env[key] !== challenge[field]) fail();
    }
    if (typeof env.FIREBASE_SERVICE_ACCOUNT_JSON !== 'string' || env.FIREBASE_SERVICE_ACCOUNT_JSON.length > 32_768) fail();
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (sa.type !== 'service_account' || sa.project_id !== 'kyrub-b8d0e'
      || sa.client_email !== challenge.serviceAccountEmail || !/^[a-f0-9]{40}$/.test(sa.private_key_id)
      || typeof sa.private_key !== 'string') fail();
    const key = createPrivateKey(sa.private_key.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) fail();
    const payload = { challenge: canonical(challenge), firebaseProjectId: sa.project_id, serviceAccountEmail: sa.client_email, keyId: sa.private_key_id };
    const bytes = Buffer.from(DOMAIN + JSON.stringify(payload));
    return { payload, signature: sign('RSA-SHA256', bytes, key).toString('base64url') };
  } catch { fail(); }
}

// trustedKeys must come from Google's public certificate endpoint / IAM public
// keys, never from the proof or the workload. expected is verifier-owned.
export function verifyKeyAttestation(proof, expected, trustedKeys, now = Date.now()) {
  try {
    validateChallenge(expected, now);
    const p = proof?.payload;
    if (!p || JSON.stringify(p.challenge) !== JSON.stringify(canonical(expected))
      || p.firebaseProjectId !== 'kyrub-b8d0e' || p.serviceAccountEmail !== expected.serviceAccountEmail
      || !/^[a-f0-9]{40}$/.test(p.keyId) || !Object.hasOwn(trustedKeys, p.keyId)) fail();
    if (typeof proof.signature !== 'string' || !/^[A-Za-z0-9_-]{100,2048}$/.test(proof.signature)) fail();
    const key = createPublicKey(trustedKeys[p.keyId]);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) fail();
    if (!verify('RSA-SHA256', Buffer.from(DOMAIN + JSON.stringify(p)), key, Buffer.from(proof.signature, 'base64url'))) fail();
    return { keyId: p.keyId, serviceAccountEmail: p.serviceAccountEmail,
      challenge: canonical(expected), conclusion: 'KEY_POSSESSION_ONLY',
      requiresProviderDeploymentEvidence: true, writersVerified: false };
  } catch { fail(); }
}
