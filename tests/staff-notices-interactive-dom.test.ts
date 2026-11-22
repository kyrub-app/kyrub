import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('real Staff Central components publish a notice and let an employee confirm reading', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    url: 'https://www.kyrub.com/staff', pretendToBeVisual: true,
  });
  const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const originalFetch = globalThis.fetch;
  const storeId = 'staff_e2e_store';
  const requests: Array<{ method: string; url: string; authorization: string; body: any }> = [];
  const records: Array<Record<string, any>> = [];
  let readAt = '';
  globalThis.fetch = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(resource);
    const method = init?.method || 'GET';
    const authorization = new Headers(init?.headers).get('authorization') || '';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url, authorization, body });
    assert.equal(authorization, 'Bearer fake-staff-session');
    const json = (data: unknown) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (url.startsWith('/api/staff/notices?') && method === 'GET') {
      assert.ok(url.includes('storeId=' + storeId));
      return json({ notices: records.map(x => ({ ...x, readAt })) });
    }
    if (url === '/api/staff/notices' && method === 'POST') {
      assert.equal(body.storeId, storeId);
      assert.deepEqual(body.audienceRoles, ['seller']);
      records.unshift({
        id: body.requestId,
        title: body.title, body: body.body,
        createdAt: '2026-11-22T23:00:00.000Z',
        audienceRoles: body.audienceRoles, status: 'published',
      });
      return json({ notice: records[0] });
    }
    if (url === '/api/staff/notices/read' && method === 'POST') {
      assert.equal(body.storeId, storeId);
      assert.equal(body.noticeId, records[0].id);
      readAt = '2026-11-22T23:20:00.000Z';
      return json({ readAt });
    }
    throw Error('UNEXPECTED_NETWORK_ACCESS: ' + url);
  };

  const bundle = await build({
    stdin: {
      contents: "export { StoreStaffCentralWorkspace } from './src/components/store/StoreStaffCentralWorkspace.tsx'; export { StoreStaffNoticeInbox } from './src/components/store/StoreStaffNoticeInbox.tsx';",
      resolveDir: process.cwd(), sourcefile: 'staff-dom-entry.ts',
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
    plugins: [{
      name: 'only-mock-browser-firebase-identity',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/firebase$/ }, args =>
          args.importer.endsWith('/src/utils/staffNotices.ts')
            ? { path: 'staff-dom-auth-mock', namespace: 'isolated' }
            : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'isolated' }, () => ({
          contents: "export const auth={currentUser:{uid:'test-staff-user',getIdToken:async()=> 'fake-staff-session'}};",
          loader: 'js',
        }));
      },
    }],
  });

  const filename = new URL('../.staff-notices-interactive-' + randomUUID() + '.mjs', import.meta.url);
  let root: { render: (element: unknown) => void; unmount: () => void } | undefined;
  try {
    await writeFile(filename, bundle.outputFiles[0].text);
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { StoreStaffCentralWorkspace, StoreStaffNoticeInbox } = await import(filename.href);
    root = createRoot(dom.window.document.getElementById('root')!);
    const settle = async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    };
    const buttonByText = (text: string): HTMLButtonElement => {
      const button = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
        .find(element => element.textContent?.includes(text));
      assert.ok(button, 'Expected ' + text + ': ' + dom.window.document.body.textContent?.slice(0, 900));
      return button;
    };
    const changeValue = async (selector: string, value: string) => {
      const el = dom.window.document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      assert.ok(el, 'Missing form input ' + selector);
      const setter = Object.getOwnPropertyDescriptor(
        selector.startsWith('textarea')
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype, 'value'
      )!.set!;
      await act(async () => {
        setter.call(el, value);
        el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    };

    await act(async () => { root!.render(createElement(StoreStaffCentralWorkspace, { storeId })); });
    assert.equal(dom.window.document.querySelectorAll('[data-kyrub-staff-central-card]').length, 4);
    assert.match(dom.window.document.body.textContent || '', /Manuais POP/);
    assert.match(dom.window.document.body.textContent || '', /Escalas de trabalho/);
    await act(async () => { buttonByText('Gerenciar avisos').click(); });
    await settle();
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-notices-manager]'));
    assert.ok(requests.some(item => item.method === 'GET'));

    await changeValue('input#staff-notice-title', 'Aviso operacional de teste');
    await changeValue('textarea#staff-notice-body', 'Leia antes do turno.');
    const audience = dom.window.document.querySelector<HTMLSelectElement>('select#staff-notice-audience');
    assert.ok(audience);
    await act(async () => {
      audience!.value = 'seller';
      audience!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await act(async () => {
      dom.window.document.querySelector('form')!.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true })
      );
    });
    await settle();
    assert.equal(records.length, 1);
    assert.equal(records[0].title, 'Aviso operacional de teste');
    assert.equal(records[0].body, 'Leia antes do turno.');
    assert.match(dom.window.document.body.textContent || '', /Comunicados publicados/);

    await act(async () => { root!.render(createElement(StoreStaffNoticeInbox, { storeId })); });
    await settle();
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-notices-inbox]'));
    assert.match(dom.window.document.body.textContent || '', /Novo/);
    await act(async () => { buttonByText('Confirmar leitura').click(); });
    await settle();
    assert.match(dom.window.document.body.textContent || '', /Lido/);
    assert.equal(readAt, '2026-11-22T23:20:00.000Z');
    assert.equal(requests.filter(item => item.method === 'POST').length, 2);
  } finally {
    if (root) {
      const { act } = await import('react');
      await act(async () => { root!.unmount(); });
    }
    await unlink(filename).catch(() => {});
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
