import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { adminAuth, adminDb } from '../server/firebaseAdmin.js';
import { createAgeScreeningRouter, ageScreeningEmulatorsReady } from '../server/identity/ageScreeningRouter.js';

test('verified emulator session screens once and keeps the private record minimal', async () => {
  assert.ok(ageScreeningEmulatorsReady(process.env));
  const app = express();
  app.use('/age', createAgeScreeningRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server,'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = 'http://127.0.0.1:' + address.port + '/age';
    const endpoint = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator';
    const email = 'age-' + Date.now() + '@example.invalid';
    const password = 'Only-use-in-emulators1';
    const user = await adminAuth.createUser({ email,password });
    const signIn = async () => {
      const result = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
      assert.equal(result.status,200);
      return (await result.json()).idToken as string;
    };
    const read = (token:string) => fetch(url,{headers:{Authorization:'Bearer '+token}});
    const write = (token:string,body:unknown) => fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await read(await signIn())).status,401);
    await adminAuth.updateUser(user.uid,{emailVerified:true});
    const token = await signIn();
    const initial = await read(token);
    assert.equal(initial.headers.get('cache-control'),'no-store');
    assert.deepEqual(await initial.json(),{status:'pending'});
    const valid = {birthDate:'2000-01-01',declaredAdult:true};
    assert.equal((await write(token,{...valid,uid:'other'})).status,400);
    const responses = await Promise.all([write(token,valid),write(token,valid)]);
    for (const response of responses) assert.deepEqual(await response.json(),{status:'declared_adult'});
    assert.deepEqual(await (await write(token,{birthDate:'2020-01-01',declaredAdult:false})).json(),{status:'declared_adult'});
    const stored = await adminDb.doc('age_eligibility_private/'+user.uid).get();
    assert.deepEqual(Object.keys(stored.data()!).sort(),['uid','method','recordedAt','policyVersion','status'].sort());
    await adminAuth.updateUser(user.uid,{disabled:true});
    assert.equal((await read(token)).status,401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
