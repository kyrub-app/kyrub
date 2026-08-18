import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyInventoryConsumptionLines,
  buildOrderInventoryConsumption,
  calculateCompositionAvailableStock,
  type InventoryCatalogRecord,
  type InventoryCompositionRecord,
} from '../shared/inventoryConsumption';
import {
  buildKyrubInventoryIntakeProposal,
  parseBrazilianFiscalNumber,
  parseKyrubInventoryIntakeEntries,
} from '../shared/kyrubInventoryIntake';
import { classifyKyrubiaCapability } from '../shared/kyrubiaCapabilityRouter';
import { buildKyrubiaInventoryReadHints } from '../shared/kyrubiaInventoryRead';
import {
  calculateCompositionUnitCost,
  calculateSaleMarginPercent,
  calculateSuggestedPrice,
  roundCurrency,
} from '../shared/productPricing';

const simulatedInvoice = `NOTA FISCAL SIMULADA — TESTE KYRUB
Fornecedor: Distribuidora Teste Kyrub
10 UN — Pão para hambúrguer
1,400 KG — Carne bovina Premium
10 UN — Queijo para hambúrguer
1,000 KG — Batata frita
Esta é uma nota fiscal fictícia criada exclusivamente para teste de entrada de estoque.`;

test('Brazilian fiscal quantities keep comma as decimal separator', () => {
  assert.equal(parseBrazilianFiscalNumber('1,400'), 1.4);
  assert.equal(parseBrazilianFiscalNumber('1,000'), 1);
  assert.equal(parseBrazilianFiscalNumber('1.234,56'), 1234.56);
});

test('simulated X-Burger invoice becomes four inventory entries, never catalog products', () => {
  const entries = parseKyrubInventoryIntakeEntries(simulatedInvoice);
  assert.deepEqual(
    entries.map(entry => [entry.name, entry.quantity, entry.unit]),
    [
      ['Pão para hambúrguer', 10, 'un'],
      ['Carne bovina Premium', 1.4, 'kg'],
      ['Queijo para hambúrguer', 10, 'un'],
      ['Batata frita', 1, 'kg'],
    ]
  );

  assert.deepEqual(classifyKyrubiaCapability(simulatedInvoice), {
    primary: 'adjust_inventory',
    mutation: 'inventory',
  });

  const proposal = buildKyrubInventoryIntakeProposal(simulatedInvoice, 'test-xburger');
  assert.equal(proposal?.type, 'adjust_inventory');
  assert.equal(proposal?.requiresConfirmation, true);
  assert.equal(proposal?.entries.length, 4);
  assert.equal(proposal?.source.label, 'Distribuidora Teste Kyrub');
});

test('X-Burger recipe supports ten units and calculates margin without confusing markup', () => {
  const catalog = [
    { id: 'pao', purchaseCost: 1.2 },
    { id: 'carne', purchaseCost: 30 },
    { id: 'queijo', purchaseCost: 1.5 },
    { id: 'batata', purchaseCost: 8 },
  ];
  const composition = {
    yieldQuantity: 1,
    lines: [
      { inventoryItemId: 'pao', quantity: 1 },
      { inventoryItemId: 'carne', quantity: 0.14 },
      { inventoryItemId: 'queijo', quantity: 1 },
      { inventoryItemId: 'batata', quantity: 0.1 },
    ],
  };

  const cost = calculateCompositionUnitCost(catalog, composition);
  assert.equal(roundCurrency(cost ?? -1), 7.7);
  assert.equal(roundCurrency(calculateSuggestedPrice(cost, 40) ?? -1), 12.83);
  assert.equal(roundCurrency(calculateSaleMarginPercent(cost, 29.5) ?? -1), 73.9);
});

test('one X-Burger sale consumes the recipe and reduces sellable capacity from 10 to 9', () => {
  const now = '2026-08-18T00:00:00.000Z';
  const catalog: InventoryCatalogRecord[] = [
    { id: 'pao', name: 'Pão para hambúrguer', unit: 'un', currentQuantity: 10, minimumQuantity: 0, purchaseCost: 1.2, supplier: 'Distribuidora Teste Kyrub', updatedAt: now },
    { id: 'carne', name: 'Carne bovina Premium', unit: 'kg', currentQuantity: 1.4, minimumQuantity: 0, purchaseCost: 30, supplier: 'Distribuidora Teste Kyrub', updatedAt: now },
    { id: 'queijo', name: 'Queijo para hambúrguer', unit: 'un', currentQuantity: 10, minimumQuantity: 0, purchaseCost: 1.5, supplier: 'Distribuidora Teste Kyrub', updatedAt: now },
    { id: 'batata', name: 'Batata frita', unit: 'kg', currentQuantity: 1, minimumQuantity: 0, purchaseCost: 8, supplier: 'Distribuidora Teste Kyrub', updatedAt: now },
  ];
  const composition: InventoryCompositionRecord = {
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [
      { inventoryItemId: 'pao', quantity: 1 },
      { inventoryItemId: 'carne', quantity: 0.14 },
      { inventoryItemId: 'queijo', quantity: 1 },
      { inventoryItemId: 'batata', quantity: 0.1 },
    ],
    updatedAt: now,
  };
  const compositions = { xburger: composition };

  assert.equal(calculateCompositionAvailableStock(catalog, composition), 10);

  const lines = buildOrderInventoryConsumption(
    [{ productId: 'xburger', name: '002 - X-Burger', quantity: 1 }],
    catalog,
    compositions
  );
  assert.deepEqual(
    Object.fromEntries(lines.map(line => [line.inventoryItemId, line.quantity])),
    { batata: 0.1, carne: 0.14, pao: 1, queijo: 1 }
  );

  const afterSale = applyInventoryConsumptionLines(catalog, lines, 'consume');
  assert.equal(calculateCompositionAvailableStock(afterSale, composition), 9);
});

test('missing purchase cost blocks a false price suggestion', () => {
  const cost = calculateCompositionUnitCost(
    [{ id: 'carne', purchaseCost: 0 }],
    { yieldQuantity: 1, lines: [{ inventoryItemId: 'carne', quantity: 0.14 }] }
  );
  assert.equal(cost, null);
  assert.equal(calculateSuggestedPrice(cost, 40), null);
});

test('private inventory editor keeps canonical and legacy aliases synchronized', async () => {
  const source = await readFile(
    new URL('../src/utils/productInventory.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /inventoryCatalog:\s*nextSettings\.catalog/);
  assert.match(source, /catalog:\s*nextSettings\.catalog/);
  assert.match(source, /productCompositions:\s*nextSettings\.compositions/);
  assert.match(source, /compositions:\s*nextSettings\.compositions/);
  assert.match(source, /Array\.isArray\(value\?\.inventoryCatalog\)/);
  assert.match(source, /value\?\.catalog/);
});

test('Kyrubia inventory hints expose the four confirmed inputs without turning them into products', () => {
  const hints = buildKyrubiaInventoryReadHints([
    { id: 'pao', name: 'Pão para hambúrguer', unit: 'un', currentQuantity: 10, minimumQuantity: 0, purchaseCost: 0, supplier: '' },
    { id: 'carne', name: 'Carne bovina Premium', unit: 'kg', currentQuantity: 1.4, minimumQuantity: 0, purchaseCost: 0, supplier: '' },
    { id: 'queijo', name: 'Queijo para hambúrguer', unit: 'un', currentQuantity: 10, minimumQuantity: 0, purchaseCost: 0, supplier: '' },
    { id: 'batata', name: 'Batata frita', unit: 'kg', currentQuantity: 1, minimumQuantity: 0, purchaseCost: 0, supplier: '' },
  ]);

  assert.match(hints[0] ?? '', /4 insumos/);
  assert.match(hints.join('\n'), /Pão para hambúrguer — 10 un/);
  assert.match(hints.join('\n'), /Carne bovina Premium — 1,4 kg/);
  assert.match(hints.join('\n'), /Queijo para hambúrguer — 10 un/);
  assert.match(hints.join('\n'), /Batata frita — 1 kg/);
  assert.match(hints.join('\n'), /não é produto do catálogo/);
});

test('Kyrubia reads confirmed inventory separately from products and refreshes it immediately', async () => {
  const [contextType, consultantRoute, erpReader, actionService, clientRuntime] = await Promise.all([
    readFile(new URL('../shared/kyrubErpContext.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/ai/consultant.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/actions/erpReadActionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(contextType, /KyrubErpInventoryItemSummary/);
  assert.match(contextType, /inventoryItems\?:\s*KyrubErpInventoryItemSummary\[\]/);
  assert.match(contextType, /inventory\?:\s*boolean/);

  assert.match(consultantRoute, /users\/\$\{uid\}\/private_store\/inventory/);
  assert.match(consultantRoute, /inventoryCatalog/);
  assert.match(consultantRoute, /candidate\.currentQuantity/);
  assert.match(consultantRoute, /resource === 'inventory'/);

  assert.match(erpReader, /INVENTORY_CONTEXT_ENDPOINT\s*=\s*'\/api\/ai\/consultant\?resource=inventory'/);
  assert.match(erpReader, /authorization:\s*`Bearer \$\{token\}`/);
  assert.match(erpReader, /inventoryItems/);
  assert.match(erpReader, /buildKyrubiaInventoryReadHints/);

  assert.match(clientRuntime, /resolveKyrubiaInventoryRead/);
  assert.match(clientRuntime, /inventoryIntent/);

  assert.match(actionService, /proposal\.type === 'adjust_inventory'/);
  assert.match(
    actionService,
    /proposal\.type === 'import_catalog_draft' \|\|\s*proposal\.type === 'adjust_inventory'/
  );
});