import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

test('account UI preserves conversion key on network failure and refreshes balance and statement after replay', async () => {
  const bundle = await build({ entryPoints: ['src/components/tabs/PitangaAccount.tsx'], bundle: true, write: false,
    format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'auth-fixture', setup(b) {
      b.onResolve({ filter: /utils\/firebase$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const auth = { currentUser: { uid:"fixture-user", getIdToken: async () => "signed" }, onAuthStateChanged: cb => { cb(auth.currentUser); return ()=>{}; } };' }));
    } }],
  });
  const output = new URL('./.pitanga-ui.fixture.mjs', import.meta.url);
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = globalThis.fetch;
  (globalThis as any).window = dom.window;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let converted = false;
  let reads=0;
  const requests: { requestId: string; requestedXp: number }[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    if (options.method === 'POST') {
      requests.push(JSON.parse(options.body as string));
      if (requests.length === 1) throw Error('connection lost after commit');
      converted = true;
      return { ok: true, json: async () => ({ replay: true }) };
    }
    reads++;
    return { ok: true, json: async () => ({ pitangas: converted ? 100 : 1100, xp: converted ? 3 : 2, initialized: true,
      entries: converted ? [{ id: 'conversion_test', unit: 'xp', delta: 1, occurredAt: '2026-11-15T12:00:00Z' }, ...Array.from({length:25},(_,i)=>({id:'fixture-'+i,unit:'pitanga',delta:1,occurredAt:'2026-11-14T12:00:00Z'}))] : [] }) };
  }) as typeof fetch;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await writeFile(output, bundle.outputFiles[0].text);
    const { PitangaAccount } = await import(output.href);
    await act(async () => { root.render(React.createElement(React.Fragment,null,React.createElement(PitangaAccount),React.createElement(PitangaAccount,{mode:'pitangas'}))); });
    assert.equal(reads,1);
    assert.match(dom.window.document.body.textContent!, /1.100 Pitangas/);
    const buttons = () => [...dom.window.document.querySelectorAll('button')];
    await act(async () => { buttons().find(b => b.textContent!.startsWith('Converter'))!.click(); });
    assert.match(dom.window.document.body.textContent!, /mesma conversão/);
    await act(async () => { buttons().find(b => b.textContent!.startsWith('Consultar /'))!.click(); });
    assert.equal(reads,2,'Both mounted accounts share a single post-conversion refresh');
    assert.equal(requests.length, 2); assert.equal(requests[0].requestId, requests[1].requestId);
    assert.equal(requests[0].requestedXp, 1);
    assert.match(dom.window.document.body.textContent!, /100 Pitangas · 3 XP/);
    assert.equal([...dom.window.document.querySelectorAll('p')].filter(p=>p.textContent==='100 Pitangas').length,1,'Sibling account reflects confirmed conversion');
    assert.equal(buttons().find(b => b.textContent!.startsWith('Converter'))!.disabled, true);
    await act(async () => { buttons().find(b => b.textContent === 'Extrato')!.click(); });
    assert.match(dom.window.document.querySelector('[aria-label="Extrato de recompensas"]')!.textContent!, /\+1 XP/);
  } finally {
    await act(async () => root.unmount()); await unlink(output).catch(() => {});
    dom.window.close(); globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete (globalThis as any).window;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});


test('reward refresh hints respect exact session, foreground throttle and listener disposal',async()=>{
 const {notifyRewardRefresh,rewardRefreshGeneration,subscribeRewardRefresh}=await import('../src/utils/rewardRefresh.js');
 const dom=new JSDOM('',{url:'http://localhost'});
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const originalNow=Date.now;
 let now=100000;
 Date.now=()=>now;
 (globalThis as any).window=dom.window;
 Object.defineProperty(dom.window.document,'visibilityState',{configurable:true,value:'visible'});
 const session={},other={};
 let current=true;
 const reasons:string[]=[];
 const unsubscribe=subscribeRewardRefresh(session,()=>current,reason=>reasons.push(reason));
 try{
  notifyRewardRefresh(other,'publication');
  assert.deepEqual(reasons,[]);
  notifyRewardRefresh(session,'publication');
  assert.equal(rewardRefreshGeneration(session),1);
  assert.deepEqual(reasons,['publication']);
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  assert.deepEqual(reasons,['publication']);
  now+=30001;
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.deepEqual(reasons,['publication','return']);
  current=false;
  notifyRewardRefresh(session,'conversion');
  assert.deepEqual(reasons,['publication','return']);
  current=true;
  unsubscribe();
  now+=30001;
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  notifyRewardRefresh(session,'conversion');
  assert.deepEqual(reasons,['publication','return']);
 }finally{
  unsubscribe();Date.now=originalNow;dom.window.close();
  if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete (globalThis as any).window;
 }
});
