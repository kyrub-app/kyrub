import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyKyrubiaCapability,
  kyrubiaIntentAllowsAction,
} from '../shared/kyrubiaCapabilityRouter';

test('Kyrubia keeps note, product, transcription and image intents distinct', () => {
  assert.deepEqual(
    classifyKyrubiaCapability('Crie uma nota com a receita desse lanche.'),
    { primary: 'create_note', mutation: 'note' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Cadastre os produtos dessa imagem na minha loja.'),
    { primary: 'create_products', mutation: 'products' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Transcreva exatamente o texto dessa imagem.'),
    { primary: 'transcribe_text', mutation: 'none' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Gere uma imagem de um hambúrguer artesanal.'),
    { primary: 'generate_image', mutation: 'none' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Analise este cardápio e organize os itens.'),
    { primary: 'analyze_catalog', mutation: 'none' }
  );
});

test('explicit artifact target wins over embedded vocabulary', () => {
  assert.deepEqual(
    classifyKyrubiaCapability('Crie uma nota sobre os produtos desse cardápio.'),
    { primary: 'create_note', mutation: 'note' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Crie uma nota para comprar embalagens e inclua um checklist.'),
    { primary: 'create_note', mutation: 'note' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Crie uma tarefa com checklist para comprar embalagens.'),
    { primary: 'create_task', mutation: 'task' }
  );
  assert.deepEqual(
    classifyKyrubiaCapability('Crie os produtos desse cardápio na loja.'),
    { primary: 'create_products', mutation: 'products' }
  );
});

test('mutation boundary rejects actions outside the classified intent', () => {
  const productIntent = classifyKyrubiaCapability(
    'Cadastre os produtos dessa imagem na minha loja.'
  );
  assert.equal(kyrubiaIntentAllowsAction(productIntent, 'create_note'), false);
  assert.equal(kyrubiaIntentAllowsAction(productIntent, 'import_catalog_draft'), true);

  const transcriptionIntent = classifyKyrubiaCapability(
    'Transcreva o texto desta foto.'
  );
  assert.equal(kyrubiaIntentAllowsAction(transcriptionIntent, 'create_note'), false);
  assert.equal(kyrubiaIntentAllowsAction(transcriptionIntent, 'create_product'), false);

  const noteIntent = classifyKyrubiaCapability('Crie uma nota chamada Compras.');
  assert.equal(kyrubiaIntentAllowsAction(noteIntent, 'create_note'), true);
  assert.equal(kyrubiaIntentAllowsAction(noteIntent, 'import_catalog_draft'), false);
});

test('central consultant enforces capability policy around generic Kyrubia fallback', () => {
  const router = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );
  assert.match(router, /classifyKyrubiaCapability/);
  assert.match(router, /runGenericWithCapabilityGuard/);
  assert.match(router, /kyrubiaIntentAllowsAction/);
  assert.match(router, /INTENT_ACTION_MISMATCH/);
  assert.match(router, /server_capability_policy/);
  assert.match(router, /decision\.primary === 'create_products'/);
});

test('consultant forwarding keeps request headers as explicit own data', () => {
  const forwarded = readFileSync(
    new URL('../api/consultor-kyrub-forwarded.ts', import.meta.url),
    'utf8'
  );
  const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

  assert.match(forwarded, /headers: request\.headers \?\? \{\}/);
  assert.match(forwarded, /method: request\.method/);
  assert.match(forwarded, /body: request\.body/);
  assert.match(vercel, /"source": "\/api\/consultor-kyrub"/);
  assert.match(vercel, /"destination": "\/api\/consultor-kyrub-forwarded"/);
});
