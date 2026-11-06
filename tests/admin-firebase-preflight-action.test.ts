import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminFirebasePreflight from '../src/components/admin/AdminFirebasePreflight';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../src/utils/adminControlPlane';
import { canRunFirebasePreflight, createFirebasePreflightRunner, isFirebasePreflightPreview } from '../src/utils/adminFirebasePreflight';

const profile = { uid: 'admin', status: 'active', role: 'super_admin' } as AdminProfile;
const user = { uid: 'admin', emailVerified: true, getIdToken: async () => 'test-only-token' } as Pick<User, 'uid' | 'emailVerified' | 'getIdToken'>;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('preview gate excludes production and requires explicit administrative route', () => {
  assert.equal(isFirebasePreflightPreview('admin.kyrub.com', '?kyrub_admin_preview=1'), false);
  assert.equal(isFirebasePreflightPreview('kyrub-branch.vercel.app', ''), false);
  assert.equal(isFirebasePreflightPreview('kyrub-branch.vercel.app', '?kyrub_admin_preview=1'), true);
});
test('missing authentication and unauthorized profiles cannot obtain tokens or send requests', async () => {
  let calls = 0;
  const runner = createFirebasePreflightRunner(async () => { calls++; throw Error('unexpected'); });
  assert.deepEqual(await runner(null, profile), { status: 'FAIL', code: 'AUTH_REQUIRED' });
  for (const next of [null, { ...profile, role: 'support' }, { ...profile, status: 'suspended' }, { ...profile, status: 'revoked' }, { ...profile, uid: 'other' }]) {
    assert.equal(canRunFirebasePreflight(user, next as AdminProfile | null), false);
    assert.deepEqual(await runner({ ...user, getIdToken: async () => { throw Error('must not run'); } }, next as AdminProfile | null), { status: 'FAIL', code: 'FORBIDDEN' });
  }
  assert.equal(canRunFirebasePreflight({ ...user, emailVerified: false }, profile), false);
  assert.equal(calls, 0);
});
test('one explicit invocation uses same-origin GET and only returns sanitized status', async () => {
  let calls = 0;
  const runner = createFirebasePreflightRunner(async (url, options) => {
    calls++;
    assert.equal(url, '/api/admin/operations/health?transport=firebase-preflight');
    assert.equal(options?.method, 'GET');
    assert.deepEqual(options?.headers, { authorization: 'Bearer test-only-token' });
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.cache, 'no-store');
    return response({ status: 'PASS', code: null, secret: 'not returned' });
  });
  assert.equal(calls, 0);
  assert.deepEqual(await runner(user, profile), { status: 'PASS', code: null });
  assert.equal(calls, 1);
});
test('concurrent invocation is blocked while token acquisition is pending', async () => {
  let release!: (token: string) => void;
  let calls = 0;
  const pendingUser = { ...user, getIdToken: () => new Promise<string>(resolve => { release = resolve; }) };
  const runner = createFirebasePreflightRunner(async () => { calls++; return response({ status: 'PASS', code: null }); });
  const first = runner(pendingUser, profile);
  assert.deepEqual(await runner(user, profile), { status: 'FAIL', code: 'PREFLIGHT_IN_PROGRESS' });
  release('test-only-token');
  await first;
  assert.equal(calls, 1);
});
test('token errors are sanitized and never send a request', async () => {
  const runner = createFirebasePreflightRunner(async () => { throw Error('must not call'); });
  assert.deepEqual(await runner({ ...user, getIdToken: async () => { throw Error('sensitive'); } }, profile), { status: 'FAIL', code: 'AUTH_INVALID' });
});
test('HTTP denial and read failure codes survive, raw errors and malformed bodies do not', async () => {
  for (const code of ['AUTH_INVALID', 'FORBIDDEN', 'FIREBASE_READ_FAILED', 'FIREBASE_PROJECT_MISMATCH']) {
    assert.deepEqual(await createFirebasePreflightRunner(async () => response({ status: 'FAIL', code, error: 'sensitive' }, 403))(user, profile), { status: 'FAIL', code });
  }
  for (const body of [null, { status: 'PASS', code: null }, { status: 'FAIL', code: 'secret error' }, { error: 'sensitive' }]) {
    assert.deepEqual(await createFirebasePreflightRunner(async () => response(body, 500))(user, profile), { status: 'FAIL', code: 'PREFLIGHT_UNAVAILABLE' });
  }
  assert.deepEqual(await createFirebasePreflightRunner(async () => { throw Error('sensitive'); })(user, profile), { status: 'FAIL', code: 'PREFLIGHT_UNAVAILABLE' });
  assert.deepEqual(await createFirebasePreflightRunner(async () => new Response('<html>error</html>'))(user, profile), { status: 'FAIL', code: 'PREFLIGHT_UNAVAILABLE' });
});
test('UI requires click, disables during execution, and introduces no effects or persistence', () => {
  const component = readFileSync('src/components/admin/AdminFirebasePreflight.tsx', 'utf8');
  const helper = readFileSync('src/utils/adminFirebasePreflight.ts', 'utf8');
  assert.match(component, /disabled=\{busy\}/);
  assert.match(component, /onClick=\{\(\) => void run\(\)\}/);
  assert.match(component, /if \(locked.current\) return/);
  assert.doesNotMatch(component + helper, /useEffect|localStorage|sessionStorage|console\.|recordAdmin|addDoc|setDoc|updateDoc/);
});
test('rendered action is hidden outside preview and from inactive or non-super administrators; rendering never calls auth', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const render = (hostname: string, nextProfile: AdminProfile) => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname, search: '?kyrub_admin_preview=1' } } });
    return renderToStaticMarkup(createElement(AdminFirebasePreflight, {
      user: { ...user, getIdToken: async () => { throw Error('render must not authenticate'); } } as User,
      profile: nextProfile,
    }));
  };
  try {
    assert.equal(render('admin.kyrub.com', profile), '');
    assert.equal(render('kyrub-branch.vercel.app', { ...profile, role: 'support' }), '');
    assert.equal(render('kyrub-branch.vercel.app', { ...profile, status: 'suspended' }), '');
    const html = render('kyrub-branch.vercel.app', profile);
    assert.match(html, /Executar préflight Firebase/);
    assert.doesNotMatch(html, /<output|test-only-token/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
