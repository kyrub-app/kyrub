import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const workspace = readFileSync(
  'src/components/store/StoreResultsMarginsWorkspace.tsx',
  'utf8'
);
const composite = readFileSync(
  'src/components/StoreFinanceCompositeRuntime.tsx',
  'utf8'
);

describe('Finance Results & Margins workspace', () => {
  test('is integrated into the existing Finance composite instead of creating a parallel management route', () => {
    assert.match(composite, /StoreResultsMarginsWorkspace/);
    assert.match(composite, /<StoreResultsMarginsWorkspace storeId=\{storeId\}/);
    assert.match(composite, /<StoreFinanceRuntime storeId=\{storeId\}/);
    assert.match(workspace, /Financeiro · Resultados & Margens/);
  });

  test('loads canonical order and product profitability through one authorized combined server request', () => {
    assert.match(workspace, /\/api\/store-finance\/profitability\?\$\{query\}&includeProducts=true/);
    assert.doesNotMatch(workspace, /\/api\/store-finance\/profitability\/products\?/);
    const router = readFileSync('server/payments/storeOrderProfitabilityRouter.ts', 'utf8');
    const combined = router.slice(router.indexOf("router.get('/'"), router.indexOf("router.get('/products'"));
    assert.ok(combined.indexOf('await requireOwner') < combined.indexOf('await reconcileStoreOrderProfitability(storeId)'));
    assert.match(combined, /await reconcileStoreProductProfitability\(storeId, profitability\)/);
    assert.match(combined, /json\(\{ storeId, orders: profitability, products \}\)/);
    assert.match(router, /router\.get\('\/products'/);
    assert.match(workspace, /result\.orders\?\.storeId!==storeId\|\|result\.products\?\.storeId!==storeId/);
    assert.match(workspace, /auth\.currentUser/);
    assert.match(workspace, /getIdToken\(\)/);
    assert.match(workspace, /Authorization: `Bearer \$\{token\}`/);
  });

  test('does not read or write profitability directly through browser Firestore', () => {
    assert.doesNotMatch(workspace, /from ['"].*firebase\/firestore['"]/);
    assert.doesNotMatch(workspace, /\b(?:getDoc|getDocs|setDoc|addDoc|updateDoc|writeBatch|runTransaction)\b/);
    assert.doesNotMatch(workspace, /\bfirestore\b/i);
  });

  test('does not persist profitability snapshots in browser storage where they could become stale', () => {
    assert.doesNotMatch(workspace, /\blocalStorage\b/);
    assert.doesNotMatch(workspace, /\bsessionStorage\b/);
    assert.match(workspace, /void load\(true\)/);
  });

  test('shows order-level revenue, CMV, observed costs, contribution and lifecycle states', () => {
    assert.match(workspace, /Receita mercadoria/);
    assert.match(workspace, /Desconto loja/);
    assert.match(workspace, /CMV/);
    assert.match(workspace, /Custos variáveis/);
    assert.match(workspace, /Contribuição/);
    assert.match(workspace, /financialStateLabel/);
    assert.match(workspace, /inventoryStateLabel/);
    assert.match(workspace, /Margem efetiva/);
  });

  test('shows realized versus desired product margin and percentage-point gap', () => {
    assert.match(workspace, /Margem realizada/);
    assert.match(workspace, /Margem desejada/);
    assert.match(workspace, /marginGapPercentagePoints/);
    assert.match(workspace, /p\.p\./);
    assert.match(workspace, /Acima da meta/);
    assert.match(workspace, /Abaixo da meta/);
  });

  test('keeps general provider costs at order level instead of implying a product allocation policy', () => {
    assert.match(workspace, /Taxas do provedor e outros custos gerais do pedido permanecem no resultado do pedido/);
    assert.match(workspace, /não são rateados entre produtos por uma regra artificial/);
  });

  test('makes partial evidence explicit and states that Kyrub does not guess missing history', () => {
    assert.match(workspace, /Dados incompletos permanecem como parciais/);
    assert.match(workspace, /o Kyrub não preenche lacunas com estimativas/);
    assert.match(workspace, /Vendas históricas sem proveniência de CMV por produto permanecem parciais/);
    assert.match(workspace, /Parciais/);
  });

  test('is mobile-first without introducing charts in the first results surface', () => {
    assert.match(workspace, /overflow-x-auto/);
    assert.match(workspace, /sm:grid-cols-2/);
    assert.match(workspace, /xl:grid-cols-4/);
    assert.doesNotMatch(workspace, /recharts|chart\.js|<canvas|<svg/i);
  });
});
