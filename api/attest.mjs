import { readFileSync } from 'node:fs';
import { verify } from 'node:crypto';
import { attestKey } from '../lib/firebase-key-attestation.mjs';

const publicKey = readFileSync(new URL('../lib/operator-public.pem', import.meta.url), 'utf8');
const PROJECT = 'prj_X7hpqaftcikyA8jAK7Iec8HOkqqp';
const TEAM = 'team_25OGqyxIioK3rzvUdgDPASc5';
const BRANCH = 'diagnostic/firebase-attestation-20261115';
const DOMAIN = 'kyrub/diagnostic-preview-operator/v1\n';

// Application authentication is mandatory even when Vercel Authentication is
// unavailable. Only a signed, short-lived, context-bound operator request may
// reach the existing Firebase signer. The operator private key is never deployed.
export function handle(req, res, env = process.env, now = Date.now()) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_PROJECT_ID !== PROJECT
    || env.VERCEL_GIT_COMMIT_REF !== BRANCH || (env.VERCEL_ORG_ID && env.VERCEL_ORG_ID !== TEAM)) {
    return reply(503, { error: 'DIAGNOSTIC_UNAVAILABLE' });
  }
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  let r;
  try {
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] ?? '')) throw new Error();
    if (Number(req.headers?.['content-length'] ?? 0) > 8192) throw new Error();
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192) throw new Error();
    const envelope = JSON.parse(raw);
    r = envelope.request;
    if (!r || r.version !== 1 || !['metadata', 'attest'].includes(r.action)
      || r.projectId !== PROJECT || r.teamId !== TEAM || r.branch !== BRANCH
      || !/^[a-f0-9]{64}$/.test(r.nonce) || !Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt)
      || r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > 300_000 || now < r.issuedAt || now >= r.expiresAt
      || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)
      || !verify(null, Buffer.from(DOMAIN + JSON.stringify(r)), publicKey, Buffer.from(envelope.signature, 'base64url'))) throw new Error();
  } catch { return reply(403, { error: 'OPERATOR_AUTH_REQUIRED' }); }
  // Everything above is evaluated before any credential read. No SDK, network,
  // database, logging or persistence. Never return process.env as an object.
  try {
    if (!env.VERCEL_DEPLOYMENT_ID || !env.VERCEL_URL || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) throw new Error();
    const metadata = {
      projectId: PROJECT, teamId: TEAM, deploymentId: env.VERCEL_DEPLOYMENT_ID,
      deploymentUrl: env.VERCEL_URL, gitSha: env.VERCEL_GIT_COMMIT_SHA,
      environment: env.VERCEL_ENV, branch: BRANCH,
    };
    if (r.action === 'metadata') return reply(200, { metadata, requestNonce: r.nonce });
    const c = r.challenge;
    if (!c || c.projectId !== PROJECT || c.teamId !== TEAM || c.deploymentId !== metadata.deploymentId
      || c.deploymentUrl !== metadata.deploymentUrl || c.gitSha !== metadata.gitSha || c.environment !== 'preview') throw new Error();
    return reply(200, { proof: attestKey(c, env, now), requestNonce: r.nonce });
  } catch { return reply(400, { error: 'ATTESTATION_REJECTED' }); }
}
export default (req, res) => handle(req, res);
