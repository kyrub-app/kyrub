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
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const auth = { currentUser: { getIdToken: async () => "signed" } };' }));
    } }],
  });
  const output = new URL('./.pitanga-ui.fixture.mjs', import.meta.url);
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = globalThis.fetch;
  (globalThis as any).window = dom.window;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let converted = false;
  const requests: { requestId: string; requestedXp: number }[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    if (options.method === 'POST') {
      requests.push(JSON.parse(options.body as string));
      if (requests.length === 1) throw Error('connection lost after commit');
      converted = true;
      return { ok: true, json: async () => ({ replay: true }) };
    }
    return { ok: true, json: async () => ({ pitangas: converted ? 100 : 1100, xp: converted ? 3 : 2, initialized: true,
      entries: converted ? [{ id: 'conversion_test', unit: 'xp', delta: 1, occurredAt: '2026-11-15T12:00:00Z' }] : [] }) };
  }) as typeof fetch;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await writeFile(output, bundle.outputFiles[0].text);
    const { PitangaAccount } = await import(output.href);
    await act(async () => { root.render(React.createElement(PitangaAccount)); });
    assert.match(dom.window.document.body.textContent!, /1.100 Pitangas/);
    const buttons = () => [...dom.window.document.querySelectorAll('button')];
    await act(async () => { buttons().find(b => b.textContent!.startsWith('Converter'))!.click(); });
    assert.match(dom.window.document.body.textContent!, /mesma conversão/);
    await act(async () => { buttons().find(b => b.textContent!.startsWith('Consultar /'))!.click(); });
    assert.equal(requests.length, 2); assert.equal(requests[0].requestId, requests[1].requestId);
    assert.equal(requests[0].requestedXp, 1);
    assert.match(dom.window.document.body.textContent!, /100 Pitangas · 3 XP/);
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
