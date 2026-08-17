import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isKyrubiaStorefrontTestRequest,
  selectKyrubiaStorefrontTestProducts,
} from '../shared/kyrubiaStorefrontTestIntent';

const exactUserPrompt =
  'Quero fazer um teste de compra na minha loja. Prepare um dos hambúrgueres cadastrados e uma sobremesa para eu conseguir fazer um pedido como cliente. Organize-os corretamente no catálogo, configure o que for necessário e me mostre o que pretende fazer antes de publicar.';

test('compound purchase-test goal outranks isolated configure + loja keywords', () => {
  assert.equal(isKyrubiaStorefrontTestRequest(exactUserPrompt), true);
  assert.equal(
    isKyrubiaStorefrontTestRequest(
      'Configure o endereço da minha loja para Avenida Central, 100.'
    ),
    false
  );
});

test('storefront test selects one burger and one dessert from existing drafts', () => {
  const selection = selectKyrubiaStorefrontTestProducts([
    {
      id: 'chimichurri',
      name: '024-M. Chimichurri',
      category: 'Complementos Extras',
      price: 3.8,
      hasDescription: false,
      hasImage: false,
    },
    {
      id: 'x-burger',
      name: 'X-Burger',
      category: 'Burgers Artesanais',
      price: 29.5,
      hasDescription: false,
      hasImage: false,
    },
    {
      id: 'sundae',
      name: '203 Sundae',
      category: 'Sobremesas',
      price: 22.9,
      hasDescription: true,
      hasImage: false,
    },
  ]);

  assert.equal(selection?.main.id, 'x-burger');
  assert.equal(selection?.dessert.id, 'sundae');
});

test('storefront test requires both commercial roles before proposing publication', () => {
  const selection = selectKyrubiaStorefrontTestProducts([
    {
      id: 'x-burger',
      name: 'X-Burger',
      category: 'Burgers Artesanais',
      price: 29.5,
      hasDescription: false,
      hasImage: false,
    },
  ]);
  assert.equal(selection, null);
});

test('catalog runtime intercepts storefront test before generic product/store routing and never creates a note', () => {
  const source = readFileSync('src/ai/catalogDraftRuntime.ts', 'utf8');
  const storefrontCheck = source.indexOf('isKyrubiaStorefrontTestRequest(message)');
  const draftPreparation = source.indexOf(
    'resolveKyrubiaDeterministicProductDraft(message)'
  );

  assert.ok(storefrontCheck >= 0);
  assert.ok(draftPreparation > storefrontCheck);
  assert.match(source, /Nada será enviado à vitrine sem sua confirmação na tela/);
  assert.doesNotMatch(source, /type:\s*['"]create_note['"]/);
});

test('confirmation bridge publishes exactly two selected drafts and rolls back partial publication', () => {
  const source = readFileSync(
    'src/components/KyrubAiProductUpdateActionBridge.tsx',
    'utf8'
  );

  assert.match(source, /KYRUBIA_STOREFRONT_TEST_PROPOSAL_EVENT/);
  assert.match(source, /for \(const item of current\.detail\.items\)/);
  assert.match(source, /setKyrubCatalogProductPublished\(user, item\.id, true\)/);
  assert.match(source, /publishedIds\.map\(productId/);
  assert.match(source, /setKyrubCatalogProductPublished\(user, productId, false\)/);
  assert.match(source, /Confirmar 2 itens/);
});
