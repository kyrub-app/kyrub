import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import Workspace from '../src/components/admin/AdminGlobalChallengesWorkspace';
import { createGlobalChallengeAdminClient, GlobalChallengeApiError } from '../src/utils/adminGlobalChallenges';

const definition = (id: string, status = 'draft') => ({ id, title: `Desafio ${id}`, description: `Descrição ${id}`, status,
  sponsorType: 'kyrub', validationMode: 'deterministic', rewardXp: 10, rewardKCoins: 0, maxCompletionsPerUser: 1 });
const nativeFetch = globalThis.fetch;
const calls: Array<{ url: URL; init: RequestInit }> = [];
let records: ReturnType<typeof definition>[];
let failStatus = 0;
let publishCount = 0;
let tokenCalls = 0;
let root: Root;
let container: HTMLDivElement;
let createRoot: typeof import('react-dom/client').createRoot;
const user = { uid: 'test-admin', getIdToken: async () => { tokenCalls++; return 'fixture-id-token'; } };
const active = { role: 'super_admin' as const, status: 'active' as const };

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/admin' });
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'FormData']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as any)[name] });
  }
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => {
  records = [definition('a')]; calls.length = 0; publishCount = 0; tokenCalls = 0; failStatus = 0;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  window.confirm = () => true;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost'); calls.push({ url, init });
    assert.equal(url.pathname, '/api/admin/global-challenges');
    assert.equal((init.headers as any).authorization, 'Bearer fixture-id-token');
    if (failStatus) return new Response(JSON.stringify({ code: 'TEST_FAILURE' }), { status: failStatus, headers: { 'retry-after': '12' } });
    const operation = url.searchParams.get('operation');
    if (init.method === 'POST') {
      const body = JSON.parse(init.body as string);
      if (operation === 'publish') {
        publishCount++; const item = records.find(item => item.id === body.challengeId)!; item.status = 'published';
        return Response.json({ challenge: item });
      }
      if (records.some(item => item.id === body.id)) return new Response('{}', { status: 409 });
      records.push(body); return Response.json({ challenge: body }, { status: 201 });
    }
    if (operation === 'get') return Response.json({ challenge: records.find(item => item.id === url.searchParams.get('challengeId')) });
    const filtered = records.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status'));
    const offset = url.searchParams.has('cursor') ? 20 : 0;
    return Response.json({ items: filtered.slice(offset, offset + 20), nextCursor: filtered.length > offset + 20 ? 'next-fixture' : null });
  }) as typeof fetch;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = nativeFetch; });
const render = async (profile = active) => { await act(async () => { root.render(<Workspace user={user} profile={profile} />); }); };
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(node => node.textContent === text)!;
const click = async (text: string) => { assert.ok(button(text), text); await act(async () => button(text).click()); };
const change = async (label: string, value: string) => {
  const parent = Array.from(container.querySelectorAll('label')).find(node => node.textContent?.startsWith(label));
  assert.ok(parent, label); const input = parent.querySelector('input,textarea,select') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

test('only active Super Admin renders data or makes API requests', async () => {
  for (const profile of [{ role: 'operations', status: 'active' }, { role: 'super_admin', status: 'revoked' }]) {
    await act(async () => root.render(<Workspace user={user} profile={profile as any} />));
    assert.match(container.textContent!, /Acesso restrito/); assert.equal(calls.length, 0);
  }
  await render(); assert.match(container.textContent!, /Desafio a/); assert.ok(tokenCalls > 0);
  await act(async () => root.render(<Workspace user={user} profile={{ role: 'operations', status: 'active' }} />));
  assert.doesNotMatch(container.textContent!, /Desafio a/);
});

test('list, filters, cursor navigation and details use authenticated GETs', async () => {
  records = Array.from({ length: 22 }, (_, i) => definition(`item-${i}`)); records[0].status = 'published';
  await render(); assert.match(container.textContent!, /Página 1/);
  await click('Próxima'); assert.match(container.textContent!, /Página 2/);
  assert.equal(calls.at(-1)!.url.searchParams.get('cursor'), 'next-fixture');
  await click('Anterior'); assert.match(container.textContent!, /Página 1/);
  await change('Estado do desafio', 'published');
  assert.match(container.textContent!, /Desafio item-0/); assert.doesNotMatch(container.textContent!, /Desafio item-1/);
  await click('Ver detalhes');
  assert.match(container.querySelector('[aria-label="Detalhes do desafio"]')!.textContent!, /Descrição item-0/);
  assert.equal(button('Publicar desafio'), undefined);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 0);
});

test('creates a draft with stable ID; confirmation precedes one publication and preserves reward definitions', async () => {
  await render(); await click('Novo rascunho');
  await change('Identificador', 'new-global'); await change('Título', 'Nova comunidade'); await change('Descrição', 'Crie uma comunidade');
  await change('XP previsto', '25'); await submit();
  const create = calls.find(c => c.url.searchParams.get('operation') === 'create')!;
  const body = JSON.parse(create.init.body as string);
  assert.equal(body.id, 'new-global'); assert.equal(body.status, 'draft'); assert.equal(body.sponsorType, 'kyrub'); assert.equal(body.rewardXp, 25);
  assert.equal(body.actorId, undefined); assert.equal(body.createdBy, undefined);
  await flush(); assert.match(container.textContent!, /Rascunho criado com sucesso/);
  assert.ok(button('Publicar desafio'));
  window.confirm = () => false; await click('Publicar desafio'); assert.equal(publishCount, 0);
  window.confirm = text => { assert.match(text, /Nova comunidade/); return true; };
  await click('Publicar desafio'); await flush();
  assert.equal(publishCount, 1); assert.match(container.textContent!, /Desafio publicado com sucesso/);
  assert.equal(button('Publicar desafio'), undefined);
  assert.equal(records.find(x => x.id === 'new-global')!.rewardXp, 25);
});

test('pending publication suppresses duplicate clicks and keeps the confirmation contextual', async () => {
  await render(); await click('Ver detalhes');
  const fetcher = globalThis.fetch; let posts = 0; let confirmations = 0;
  let release: (response: Response) => void;
  globalThis.fetch = ((input: any, init: any) => {
    if (init.method !== 'POST') return fetcher(input, init);
    posts++; return new Promise(resolve => { release = resolve; });
  }) as typeof fetch;
  window.confirm = () => { confirmations++; return true; };
  await act(async () => { button('Publicar desafio').click(); button('Publicar desafio').click(); });
  assert.equal(posts, 1); assert.equal(confirmations, 1); assert.equal(button('Publicar desafio').disabled, true);
  records[0].status = 'published';
  await act(async () => release(Response.json({ challenge: records[0] })));
  await flush(); assert.equal(button('Publicar desafio'), undefined);
});

test('validation keeps form data and never sends invalid dates or quantities', async () => {
  await render(); await click('Novo rascunho'); await change('Título', 'Draft válido'); await change('Descrição', 'Detalhe');
  await change('XP previsto', '-1'); await submit(); assert.match(container.querySelector('[role="alert"]')!.textContent!, /Revise/);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 0);
  assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value, 'Detalhe');
});

test('401/403 clear sensitive content; 409/429/400 show accessible actionable errors', async () => {
  for (const status of [401, 403, 409, 429, 400]) {
    await render(); failStatus = status; await click('Atualizar');
    const alert = container.querySelector('[role="alert"]')!;
    assert.ok(alert); assert.equal(document.activeElement, alert);
    assert.match(alert.textContent!, status === 401 ? /sessão expirou/ : status === 403 ? /Acesso negado/ : status === 409 ? /mudou de estado/ : status === 429 ? /12 segundos/ : /Revise/);
    if ([401, 403].includes(status)) assert.doesNotMatch(container.textContent!, /Desafio a/);
    await act(async () => root.unmount()); root = createRoot(container); failStatus = 0;
  }
});

test('unmount cancels pending GET and stale responses do not replace the current filter', async () => {
  let release: ((value: Response) => void) | undefined;
  const fetcher = globalThis.fetch;
  globalThis.fetch = ((input: any, init: any) => {
    if (!String(input).includes('status=published')) { calls.push({ url: new URL(input, 'http://localhost'), init }); return new Promise(resolve => { release = resolve; }); }
    return fetcher(input, init);
  }) as typeof fetch;
  await render(); const stale = calls[0].init.signal!;
  await change('Estado do desafio', 'published'); assert.equal(stale.aborted, true);
  await act(async () => { release!(Response.json({ items: [definition('stale')], nextCursor: null })); });
  assert.doesNotMatch(container.textContent!, /Desafio stale/);
});

test('client maps rate limits without retrying POST or changing the request identity', async () => {
  failStatus = 429;
  await assert.rejects(createGlobalChallengeAdminClient(user).publish('same-id'), (error: any) => error instanceof GlobalChallengeApiError && error.retryAfter === 12);
  assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].init.body as string).challengeId, 'same-id');
});
