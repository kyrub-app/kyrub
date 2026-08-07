import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  KYRUB_PLANNED_ACTION_REGISTRY,
  KYRUB_PLANNED_ERP_ACTION_TYPES,
} from '../shared/kyrubActions';
import {
  buildKyrubProductDraftProposal,
  isKyrubProductDraftReadyForExecution,
} from '../shared/kyrubProductDraft';

test('product draft proposal preserves explicit commercial data without inventing missing fields', () => {
  const proposal = buildKyrubProductDraftProposal(
    {
      name: '  Camiseta Básica  ',
      description: 'Algodão.',
      category: '',
      price: 49.9,
      stock: undefined,
      isService: false,
      source: 'conversation',
    },
    { id: 'proposal-1', origin: 'kyrubia' }
  );

  assert.equal(proposal.type, 'create_product_draft');
  assert.equal(proposal.name, 'Camiseta Básica');
  assert.equal(proposal.price, 49.9);
  assert.equal(proposal.stock, null);
  assert.equal(proposal.category, '');
  assert.deepEqual(proposal.missingFields, ['category', 'stock']);
  assert.equal(proposal.requiresConfirmation, true);
  assert.equal(proposal.executable, false);
  assert.equal(proposal.risk, 'medium');
  assert.equal(isKyrubProductDraftReadyForExecution(proposal), false);
});

test('service drafts do not invent or require physical stock', () => {
  const proposal = buildKyrubProductDraftProposal(
    {
      name: 'Banho e tosa',
      category: 'Serviços',
      price: 80,
      isService: true,
      stock: 12,
      source: 'catalog_analysis',
    },
    { id: 'proposal-service-1' }
  );

  assert.equal(proposal.stock, 0);
  assert.deepEqual(proposal.missingFields, []);
  assert.equal(proposal.source, 'catalog_analysis');
  assert.equal(isKyrubProductDraftReadyForExecution(proposal), true);
});

test('invalid or absent price and stock become review fields instead of fabricated values', () => {
  const proposal = buildKyrubProductDraftProposal(
    {
      name: 'Ração Premium',
      category: 'Rações',
      price: -10,
      stock: Number.NaN,
    },
    { id: 'proposal-2' }
  );

  assert.equal(proposal.price, null);
  assert.equal(proposal.stock, null);
  assert.deepEqual(proposal.missingFields, ['price', 'stock']);
});

test('planned product writes stay non executable until an official ERP executor exists', () => {
  const definition = KYRUB_PLANNED_ACTION_REGISTRY[
    KYRUB_PLANNED_ERP_ACTION_TYPES.CREATE_PRODUCT_DRAFT
  ];

  assert.equal(definition.mode, 'write');
  assert.equal(definition.risk, 'medium');
  assert.equal(definition.requiresConfirmation, true);
  assert.equal(definition.permission, 'products.write');
  assert.equal(definition.executable, false);
});

test('product draft foundation is generic and prepared for conversation or catalog analysis', async () => {
  const [actionsSource, builderSource] = await Promise.all([
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/kyrubProductDraft.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(actionsSource, /CREATE_PRODUCT_DRAFT: 'create_product_draft'/);
  assert.match(actionsSource, /IMPORT_CATALOG_DRAFT: 'import_catalog_draft'/);
  assert.match(actionsSource, /source: KyrubProductDraftSource/);
  assert.match(actionsSource, /missingFields: KyrubProductDraftMissingField\[\]/);
  assert.match(actionsSource, /executable: false/);
  assert.match(builderSource, /catalog_analysis/);
  assert.match(builderSource, /missingFields\.push\('category'\)/);
  assert.match(builderSource, /missingFields\.push\('price'\)/);
  assert.match(builderSource, /missingFields\.push\('stock'\)/);
  assert.doesNotMatch(builderSource, /setDoc\(/);
  assert.doesNotMatch(builderSource, /updateDoc\(/);
  assert.doesNotMatch(builderSource, /addDoc\(/);
});
