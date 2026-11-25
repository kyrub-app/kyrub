import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStoreCostCenterPeriodAccumulator } from '../shared/storeFinanceCostCenterPeriod.js';
import { createStoreCostCenter, archiveStoreCostCenter, selectStoreCostCenter, normalizeCostCenters } from '../shared/storeFinanceCostCenters.js';
import {
  STORE_FINANCE_PAYABLE_CURRENCY,
  STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
  buildManualStoreFinancePayable,
  normalizeStoreFinancePayable,
} from '../shared/storeFinancePayables.js';

const now = '2026-09-30T15:00:00.000Z';

test('manual payable supports cost nature and boleto evidence', () => {
  const payable = buildManualStoreFinancePayable({
    id: 'payable-manual-rich',
    storeId: 'store-1',
    amountMinor: 12590,
    description: 'Energia elétrica',
    category: 'utilities',
    counterparty: 'Concessionária',
    dueDate: '2026-10-10',
    recurrence: 'monthly',
    costNature: 'variable',
    billingDocumentType: 'boleto',
    billingDocumentReference: 'fatura-setembro.pdf',
    billingDigitableLine: '00190.00009 01234.567890 12345.678901 2 12340000012590',
    billingBarcode: '00192123400000125900000001234567890123456789',
    createdByUserId: 'owner-1',
    now,
  });

  assert.equal(payable.sourceAuthority, 'store_owner_manual');
  assert.equal(payable.costNature, 'variable');
  assert.equal(payable.billingDocumentType, 'boleto');
  assert.equal(payable.billingDocumentReference, 'fatura-setembro.pdf');
  assert.match(payable.billingDigitableLine, /^00190/);
  assert.match(payable.billingBarcode, /^00192/);
  assert.equal(payable.purchaseId, '');
  assert.equal(payable.supplierId, '');
});

test('legacy manual payable remains backward compatible with new optional fields', () => {
  const legacy = normalizeStoreFinancePayable({
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id: 'payable-legacy',
    storeId: 'store-1',
    status: 'open',
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: 5000,
    description: 'Aluguel',
    category: 'rent',
    counterparty: 'Locador',
    dueDate: '2026-10-05',
    recurrence: 'monthly',
    sourceAuthority: 'store_owner_manual',
    teamStoreId: '',
    teamMemberUserId: '',
    payrollPeriod: '',
    createdByUserId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    cancelledAt: '',
  });

  assert.equal(legacy.costNature, 'unspecified');
  assert.equal(legacy.billingDocumentType, 'none');
  assert.equal(legacy.billingDocumentReference, '');
  assert.equal(legacy.billingDigitableLine, '');
  assert.equal(legacy.billingBarcode, '');
  assert.equal(legacy.purchaseId, '');
  assert.equal(legacy.supplierId, '');
  assert.equal(legacy.purchasePayableKey, '');
});

test('non-boleto manual documents cannot retain boleto-only evidence', () => {
  assert.throws(() => buildManualStoreFinancePayable({
    id: 'payable-invalid-doc',
    storeId: 'store-1',
    amountMinor: 9900,
    description: 'Serviço mensal',
    category: 'service',
    dueDate: '2026-10-15',
    recurrence: 'monthly',
    costNature: 'fixed',
    billingDocumentType: 'invoice',
    billingBarcode: '1234567890',
    createdByUserId: 'owner-1',
    now,
  }), /STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_SCOPE_INVALID/);
});

test('Financeiro manual UI and router forward the enriched payable fields', () => {
  const routerSource = readFileSync('server/payments/storeFinanceRouter.ts', 'utf8');
  const uiSource = readFileSync('src/components/store/StorePayablesWorkspace.tsx', 'utf8');

  assert.match(routerSource, /costNature:\s*payableCostNature\(body\.costNature\)/);
  assert.match(routerSource, /billingDocumentType,/);
  assert.match(routerSource, /billingDigitableLine:\s*billingDocumentType === 'boleto'/);
  assert.match(routerSource, /billingBarcode:\s*billingDocumentType === 'boleto'/);

  assert.match(uiSource, /Natureza do custo/);
  assert.match(uiSource, /Documento de cobrança/);
  assert.match(uiSource, /Linha digitável/);
  assert.match(uiSource, /Código de barras/);
  assert.match(uiSource, /Compra vinculada/);
});

test('store cost center registry preserves independent classification and archived history',()=>{
  const centers=createStoreCostCenter([],'cc_a',' Infraestrutura ');
  assert.deepEqual(centers,[{id:'cc_a',name:'Infraestrutura',archived:false}]);
  assert.throws(()=>createStoreCostCenter(centers,'cc_b','infraestrutura'),/COST_CENTER_INVALID/);
  assert.throws(()=>selectStoreCostCenter(centers,'cc_foreign'),/COST_CENTER_INVALID/);
  const center=selectStoreCostCenter(centers,'cc_a');
  const payable=buildManualStoreFinancePayable({id:'p',storeId:'s',amountMinor:1200,description:'Fatura',category:'service',dueDate:'2026-11-30',recurrence:'monthly',costNature:'variable',costCenter:center,createdByUserId:'owner',now});
  assert.deepEqual(payable.costCenter,center);
  assert.equal(payable.costNature,'variable');
  const archived=archiveStoreCostCenter(centers,'cc_a');
  assert.throws(()=>selectStoreCostCenter(archived,'cc_a'),/COST_CENTER_INVALID/);
  assert.deepEqual(normalizeStoreFinancePayable({...payable,status:'paid',paidAt:now}).costCenter,center);
  assert.equal(normalizeStoreFinancePayable({...payable,costCenter:undefined}).costCenter,undefined);
  assert.throws(()=>normalizeCostCenters(Array.from({length:101},(_,i)=>({id:'cc_'+i,name:'Center '+i,archived:false}))),/COST_CENTER_INVALID/);
});
test('cost centers are bound to owner-authorized finance route and selected atomically',()=>{
  const router=readFileSync('server/payments/storeFinanceRouter.ts','utf8');
  const ui=readFileSync('src/components/store/StorePayablesWorkspace.tsx','utf8');
  assert.match(router,/requireOwner\(request.get\('authorization'\) \?\? '', storeId\);[\s\S]*?action === 'create_cost_center'/);
  assert.match(router,/selectStoreCostCenter\(decodeCostCenters\(\(await tx.get\(costCentersRef\(storeId\)\)\).data\(\)\),body.costCenterId\)/);
  assert.match(router,/tx.create\(adminDb.doc\(storeFinancePayablePath\(storeId, next.id\)\),next\)/);
  assert.match(ui,/Centro de custo/);
});

test('cost center period groups paid and due separately, includes unclassified and reconciles totals',()=>{
  const a=createStoreCostCenterPeriodAccumulator();
  a.add({id:'cc_a',name:'Infraestrutura'},1000,'paid');
  a.add({id:'cc_a',name:'Infraestrutura'},2000,'paid');
  a.add({id:'cc_a',name:'Infraestrutura'},800,'open_due');
  a.add(undefined,400,'paid');
  a.add({id:'cc_b',name:'Comercial'},500,'open_due');
  const expected={paidMinor:3400,paidCount:3,openDueMinor:1300,openDueCount:2};
  const result=a.finish(expected);
  assert.equal(result.status,'observed');
  assert.equal(result.timeZone,'UTC');
  assert.deepEqual(result.rows,[
    {id:'cc_a',name:'Infraestrutura',paidMinor:3000,paidCount:2,openDueMinor:800,openDueCount:1},
    {id:null,name:'Sem classificação',paidMinor:400,paidCount:1,openDueMinor:0,openDueCount:0},
    {id:'cc_b',name:'Comercial',paidMinor:0,paidCount:0,openDueMinor:500,openDueCount:1},
  ]);
  a.invalidPayable();assert.equal(a.finish(expected).status,'partial');
  assert.equal(a.finish({...expected,paidMinor:1}).status,'unavailable');
  a.add({id:'cc_a',name:'Outro nome'},1,'paid');assert.equal(a.finish(expected).status,'unavailable');
});
test('cost center report shares the existing payable scan and monthly predicates',()=>{
  const router=readFileSync('server/payments/storeFinanceHistoryRouter.ts','utf8');
  const ui=readFileSync('src/components/store/StoreFinancePeriodRuntime.tsx','utf8');
  assert.match(router,/payable\.paidAt >= period\.startIso && payable\.paidAt < period\.endExclusiveIso[\s\S]*?costCenters\.add\(payable.costCenter, payable.amountMinor, 'paid'\)/);
  assert.match(router,/payable\.dueDate\.startsWith\(period.period\)[\s\S]*?costCenters\.add\(payable.costCenter, payable.amountMinor, 'open_due'\)/);
  assert.match(router,/costCenterReport:costCenters\.finish/);
  assert.match(ui,/Despesas por centro de custo/);
  assert.match(ui,/reportState\.user===auth\.currentUser/);
});
