import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

test('direct inventory opts out of the legacy DOM portal', () => {
  const source = readFileSync('src/components/store/ProductInventoryDirectRuntime.tsx', 'utf8');
  assert.match(source, /<OperationalDualWriteBridge\s+mountLegacyConnectionsPortal=\{false\}/);
});

test('data subscriptions survive portal opt-out and clean up on unmount', async () => {
  const result = await build({
    entryPoints: ['src/components/store/OperationalDualWriteBridge.tsx'],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'isolated-dependencies', setup(builder) {
      builder.onResolve({ filter: /utils\/(firebase|operationalDualWrite|canonicalProductDualWrite)$|StoreConnectionsPortalBridge$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path.endsWith('/firebase') ? `export const auth = globalThis.__dualWriteFixture.auth;` :
        args.path.endsWith('/operationalDualWrite') ? `export const subscribeToOperationalDualWrite = globalThis.__dualWriteFixture.subscribe;` :
        args.path.endsWith('/canonicalProductDualWrite') ? `export const subscribeToCanonicalProductDualWrite = globalThis.__dualWriteFixture.subscribe;` :
        `export default function Portal() { globalThis.__dualWriteFixture.portals++; return null; }`, loader: 'js' }));
    } }],
  });
  // Import beside the repository so external React resolves to the same instance.
  const { writeFile, unlink } = await import('node:fs/promises');
  const output = new URL('./.dual-write-runtime.fixture.mjs', import.meta.url);
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let subscriptions = 0, stops = 0, authStops = 0;
  const fixture = { portals: 0, auth: { currentUser: { uid: 'owner' }, onAuthStateChanged: () => () => { authStops++; } },
    subscribe: async () => { subscriptions++; return () => { stops++; }; } };
  (globalThis as any).__dualWriteFixture = fixture;
  (globalThis as any).window = dom.window;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await writeFile(output, result.outputFiles[0].text);
    const { OperationalDualWriteBridge } = await import(output.href);
    await act(async () => { root.render(React.createElement(OperationalDualWriteBridge, { legacyStoreId: 'owner', notify() {}, mountLegacyConnectionsPortal: false })); });
    assert.equal(fixture.portals, 0, 'direct Products must never mount the polling portal');
    assert.equal(subscriptions, 2, 'both canonical subscriptions remain active');
    await act(async () => { root.render(React.createElement(OperationalDualWriteBridge, { legacyStoreId: 'owner', notify() {} })); });
    assert.equal(fixture.portals, 1, 'legacy caller keeps its portal by default');
    assert.equal(subscriptions, 2, 'portal change must not restart data subscriptions');
  } finally {
    await act(async () => root.unmount());
    await unlink(output).catch(() => {});
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete (globalThis as any).window;
    delete (globalThis as any).__dualWriteFixture;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
  assert.equal(stops, 2);
  assert.equal(authStops, 1);
});
