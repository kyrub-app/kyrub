import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
  'utf8'
);
const legacyWorkspace = readFileSync(
  'src/components/customer/LegacyTableServiceWorkspace.tsx',
  'utf8'
);
const operations = readFileSync('src/utils/tableOperations.ts', 'utf8');
const legacyOperations = readFileSync('src/utils/legacyTableOperations.ts', 'utf8');

test('staff table Pix click is intercepted before the legacy payment selector mutates state', () => {
  assert.match(workspace, /onClickCapture=\{interceptLegacyPix\}/);
  assert.match(workspace, /const PIX_LABEL = getTablePaymentMethodLabel\('pix'\)/);
  assert.match(workspace, /event\.preventDefault\(\)/);
  assert.match(workspace, /event\.stopPropagation\(\)/);
  assert.match(workspace, /setPixCheckoutOpen\(true\)/);
  assert.match(legacyWorkspace, /\(\['cash', 'pix', 'card', 'other'\] as TablePaymentMethod\[\]\)/);
});

test('staff table Pix reuses the canonical local payment panel instead of creating another checkout engine', () => {
  assert.match(workspace, /ServiceLocationFinancialContextPanel/);
  assert.match(workspace, /getActiveTableOrders\(props\.orders, props\.tableCode\)/);
  assert.match(workspace, /storeId=\{props\.storeId\}/);
  assert.match(workspace, /orders=\{activeOrders\}/);
  assert.match(workspace, /a seleção de itens da tela anterior não define o valor bancário/);
  assert.doesNotMatch(workspace, /createLocalPaymentIntent|attachLocalMercadoPagoPix|registerTablePayment/);
});

test('legacy table payment API fails closed for Pix before any operational settlement is delegated', () => {
  const guardIndex = operations.indexOf("if (input.method === 'pix')");
  const delegateIndex = operations.indexOf('return registerLegacyTablePayment(user, input);');
  assert.ok(guardIndex >= 0);
  assert.ok(delegateIndex > guardIndex);
  assert.match(operations, /não pode ser baixado como recebimento manual/);
  assert.match(legacyOperations, /public\/data\/tablePayments/);
  assert.match(legacyOperations, /paidQuantity: item\.paidQuantity \+ selectedQuantity/);
});
