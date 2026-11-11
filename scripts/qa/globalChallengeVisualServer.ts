/** Disposable QA host only. Never import this harness from the app/API. */
import express from 'express';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

const projectId = 'demo-kyrub-control-plane';
if (process.env.KYRUB_VISUAL_QA !== '1' || process.env.FIREBASE_PROJECT_ID !== projectId ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('QA_REQUIRES_DEMO_PROJECT_LOCAL_EMULATOR_AND_NO_CREDENTIALS');
}
delete process.env.VERCEL;
const { adminDb } = await import('../../server/firebaseAdmin.js');
const { createGlobalChallengeAdminRouter } = await import('../../server/gamification/globalChallengeAdminHandler.js');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificateUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
globalThis.fetch = (async (input: any) => {
  if (String(input) !== certificateUrl) throw new Error('QA_EXTERNAL_NETWORK_DENIED');
  return new Response(JSON.stringify({ 'qa-local': publicKey.export({ type: 'spki', format: 'pem' }) }), { headers: { 'cache-control': 'max-age=3600' } });
}) as typeof fetch;
const tokenFor = (uid: string, expired = false) => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const data = `${encode({ alg: 'RS256', kid: 'qa-local' })}.${encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: uid, iat: now, auth_time: now, exp: now + (expired ? -3600 : 3600), email_verified: true })}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
};
const root = process.cwd();
const identityModule = resolve(root, 'scripts/qa/globalChallengeVisualClient.tsx');
const irrelevant = /(?:AdminDirectoryWorkspace|AdminOfficialBillingPreflight|AdminOfficialPlanRenewalAction|AdminFirebasePreflight|OfficialStoreCommercialWorkspace|AdminAiOperationsDashboard|AdminIntegrationsWorkspace|AdminOperationalResponsibilityWorkspace|AdminSocialModerationWorkspace)$/;
const compiled = await build({ entryPoints: [identityModule], bundle: true, format: 'esm', jsx: 'automatic', write: false, minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-demo-identity', setup(builder) {
    builder.onResolve({ filter: /^firebase\/auth$|^firebase\/firestore$/ }, args => ({ path: args.path, namespace: 'qa-shim' }));
    builder.onResolve({ filter: /(?:^|\/)firebase$/ }, args => ({ path: 'qa-firebase', namespace: 'qa-shim' }));
    builder.onResolve({ filter: irrelevant }, () => ({ path: 'qa-out-of-scope', namespace: 'qa-shim' }));
    builder.onLoad({ filter: /.*/, namespace: 'qa-shim' }, args => ({ loader: 'ts', resolveDir: root, contents:
      args.path === 'firebase/auth' ? `import {qaUser} from ${JSON.stringify(identityModule)}; export class GoogleAuthProvider {setCustomParameters(){}} export const onAuthStateChanged=(_auth,cb)=>{queueMicrotask(()=>cb(qaUser));return ()=>{};}; export const signInWithPopup=async()=>{throw Error('QA_GOOGLE_LOGIN_DISABLED')}; export const signOut=async()=>{};` :
      args.path === 'qa-firebase' ? `import {qaUser} from ${JSON.stringify(identityModule)};export const auth={get currentUser(){return qaUser}};export const db={};` :
      args.path === 'firebase/firestore' ? `import {qaSession} from ${JSON.stringify(identityModule)}; export const doc=(_db,...parts)=>({path:parts.join('/')}); export const collection=doc; export const onSnapshot=(_ref,cb)=>{queueMicrotask(()=>cb({data:()=>qaSession.profile}));return ()=>{};}; export const getCountFromServer=async()=>({data:()=>({count:0})}); export const setDoc=async()=>{}; export const serverTimestamp=()=>({qa:true});` :
      `import React from 'react';export default function OutsideScope(){return React.createElement('p',null,'Área fora do escopo desta homologação isolada.');}` }));
  } }] });
if (compiled.outputFiles[0].text.includes('kyrub-b8d0e.firebaseapp.com')) throw new Error('QA_PRODUCTION_CLIENT_CONFIG_REJECTED');
const assets = await readdir(resolve(root, 'dist/assets'));
const css = await readFile(resolve(root, 'dist/assets', assets.find(name => name.endsWith('.css'))!));
const auditBefore = (await adminDb.listCollections()).map(item => item.id);
if (auditBefore.some(name => !['global_challenges', 'kyrub_admin'].includes(name))) throw new Error('QA_PROJECT_NOT_EMPTY');
const seed = adminDb.batch();
for (let i = 1; i <= 26; i++) {
  const id = `qa-${String(i).padStart(3, '0')}`;
  seed.set(adminDb.doc(`global_challenges/${id}`), { id, title: i === 1 ? 'Crie sua primeira comunidade' : i === 2 ? 'Desafio com período encerrado' : `Desafio global ${String(i).padStart(3, '0')} — participação e novas conexões`,
    description: 'Definição de teste para validar a administração de desafios globais. Nenhuma recompensa será distribuída nesta homologação.',
    status: i < 24 ? 'draft' : i === 24 ? 'published' : i === 25 ? 'active' : 'ended', validationMode: 'deterministic', sponsorType: 'kyrub',
    rewardXp: 25, rewardKCoins: 0, maxCompletionsPerUser: 1, ...(i === 2 ? { endsAt: '2020-01-01T00:00:00.000Z' } : {}) });
}
await seed.commit();
const app = express(); let lastMutation = '';
app.use((req, res, next) => { res.setHeader('cache-control', 'no-store'); res.setHeader('x-kyrub-qa-project', projectId);
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'"); next(); });
app.get('/qa/session', async (req, res) => {
  const run = typeof req.query.run === 'string' && /^[a-z0-9-]{1,50}$/.test(req.query.run) ? req.query.run : randomUUID();
  const scenario = String(req.query.case || 'normal'); const uid = `qa-${run}`;
  const storedRole = scenario === '403' ? 'operations' : 'super_admin';
  const profile = { uid, email: 'superadmin@kyrub-qa.example.test', displayName: 'Super Admin de teste', role: storedRole, status: 'active', createdBy: 'qa-fixture', createdAt: new Date().toISOString() };
  await adminDb.doc(`kyrub_admin/control_plane/admins/${uid}`).set(profile);
  if (scenario === '429') {
    await adminDb.doc(`kyrub_admin/control_plane/rate_limits/global-challenges-read-${createHash('sha256').update(uid).digest('hex')}`).set({ count: 60, resetAt: Date.now() + 60000 });
  }
  res.json({ profile: { ...profile, role: 'super_admin' }, token: tokenFor(uid, scenario === '401') });
});
app.use('/api/admin/global-challenges', (req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => { if (req.method === 'POST' && res.statusCode < 300 && body?.challenge?.id) lastMutation = body.challenge.id; return json(body); };
  if (req.headers['x-kyrub-qa-case'] === 'loading' && req.method === 'GET') setTimeout(next, 20000); else next();
}, createGlobalChallengeAdminRouter());
app.get('/qa/receipt', async (_req, res) => {
  if (!lastMutation) { res.json({ project: projectId, challenge: null }); return; }
  const challenge = await adminDb.doc(`global_challenges/${lastMutation}`).get();
  const audit = await adminDb.collection(`global_challenges/${lastMutation}/audit`).get();
  res.json({ project: projectId, id: lastMutation, status: challenge.data()?.status, events: audit.docs.map(doc => doc.data().action).sort(), collections: (await adminDb.listCollections()).map(item => item.id).sort() });
});
app.get('/qa/app.js', (_req, res) => res.type('text/javascript').send(compiled.outputFiles[0].text));
app.get('/qa/style.css', (_req, res) => res.type('text/css').send(css));
app.get('/qa/app', (req, res) => res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kyrub QA · Control Plane</title><link rel="stylesheet" href="/qa/style.css"></head><body class="bg-slate-950"><aside style="padding:8px;background:#083344;color:#cffafe;font:12px system-ui">HOMOLOGAÇÃO ISOLADA · ${projectId} · identidade de teste · sem produção</aside><div id="root"></div><script type="module" src="/qa/app.js"></script></body></html>`));
app.get('/qa', (req, res) => {
  const width = req.query.width === '390' ? 390 : req.query.width === '320' ? 320 : 1280;
  const scenario = ['normal','loading','401','403','429'].includes(String(req.query.case)) ? String(req.query.case) : 'normal';
  const run = randomUUID();
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kyrub · QA visual isolado</title><style>body{margin:0;background:#e2e8f0;font:14px system-ui}header{padding:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}iframe{display:block;border:1px solid #94a3b8;width:${width}px;height:${width < 600 ? 844 : 900}px}label,button,select,a{font:inherit}a{color:#0369a1}</style></head><body><header><strong>QA PR #1126 · somente teste</strong><form action="/qa"><label>Viewport <select name="width"><option value="1280" ${width===1280?'selected':''}>Desktop 1280</option><option value="390" ${width===390?'selected':''}>Mobile 390</option><option value="320" ${width===320?'selected':''}>Mobile 320</option></select></label> <label>Cenário <select name="case">${['normal','loading','401','403','429'].map(value=>`<option ${value===scenario?'selected':''} value="${value}">${value}</option>`).join('')}</select></label> <button>Aplicar</button></form><a href="/qa/receipt" target="_blank">Ver persistência no emulador</a></header><iframe id="qa-app" title="Control Plane de teste" src="/qa/app?case=${scenario}&run=${run}"></iframe></body></html>`);
});
app.listen(3000, '0.0.0.0', () => console.log(JSON.stringify({ ready: true, project: projectId, mode: 'real-handler-real-emulator-fixture-identity', commit: process.env.QA_COMMIT || 'unknown' })));
