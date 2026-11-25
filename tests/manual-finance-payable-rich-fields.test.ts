import { emptyFinanceTaxonomy, mutateFinanceTaxonomy, resolveCustomFinanceRef } from '../shared/storeFinanceTaxonomy.js';
import { financeMonthRange, financeMonthAt, parseFinancePeriodTimeZone } from '../shared/storeFinanceCalendar.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStoreCostCenterPeriodAccumulator } from '../shared/storeFinanceCostCenterPeriod.js';
import { FIXED_STORE_COST_CENTERS, selectStoreCostCenter } from '../shared/storeFinanceCostCenters.js';
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

test('fixed cost centers are identical for every store and independent of expense category',()=>{
  assert.deepEqual(FIXED_STORE_COST_CENTERS.map(c=>c.name),['Infraestrutura','Comercial','Administrativo','Produtos','Logística']);
  assert.throws(()=>selectStoreCostCenter('cc_custom'),/COST_CENTER_INVALID/);
  const center=selectStoreCostCenter('cc_infrastructure');
  const payable=buildManualStoreFinancePayable({id:'p',storeId:'s',amountMinor:1200,description:'Fatura',category:'service',dueDate:'2026-11-30',recurrence:'monthly',costNature:'variable',costCenter:center,createdByUserId:'owner',now});
  assert.deepEqual(payable.costCenter,{id:'cc_infrastructure',name:'Infraestrutura'});
  assert.equal(payable.costNature,'variable');
  assert.deepEqual(normalizeStoreFinancePayable({...payable,status:'paid',paidAt:now}).costCenter,center);
  assert.equal(normalizeStoreFinancePayable({...payable,costCenter:undefined}).costCenter,undefined);
  assert.throws(()=>normalizeStoreFinancePayable({...payable,costCenter:{id:'cc_infrastructure',name:'Comercial'}}),/COST_CENTER_INVALID/);
  assert.equal(normalizeStoreFinancePayable({...payable,costCenter:{id:'cc_old',name:'Centro antigo'}}).costCenter?.id,'cc_old');
});
test('fixed centers are validated server-side, and custom taxonomy uses the same owner boundary',()=>{
  const router=readFileSync('server/payments/storeFinanceRouter.ts','utf8');
  const ui=readFileSync('src/components/store/StorePayablesWorkspace.tsx','utf8');
  assert.match(router,/requireOwner\(request.get\('authorization'\) \?\? '', storeId\);[\s\S]*?selectStoreCostCenter\(body.costCenterId\)/);
  assert.match(router,/tx.create\(adminDb.doc\(storeFinancePayablePath\(storeId, next.id\)\),next\)/);
  assert.doesNotMatch(router,/create_cost_center|archive_cost_center|costCentersRef/);
  assert.match(router,/mutateFinanceTaxonomy\(current,kind,operation,id,body.name\)/);
  assert.match(ui,/FIXED_STORE_COST_CENTERS.map/);
  assert.doesNotMatch(ui,/create_cost_center|archive_cost_center/);
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

test('finance calendars preserve legacy UTC and align Sao Paulo with local month boundaries',()=>{
  assert.deepEqual(financeMonthRange('2026-11'),{period:'2026-11',timeZone:'UTC',startIso:'2026-11-01T00:00:00.000Z',endExclusiveIso:'2026-12-01T00:00:00.000Z'});
  const sp=financeMonthRange('2026-11','America/Sao_Paulo');
  assert.equal(sp.startIso,'2026-11-01T03:00:00.000Z');
  assert.equal(sp.endExclusiveIso,'2026-12-01T03:00:00.000Z');
  assert.equal(financeMonthAt(new Date('2026-12-01T02:59:59.999Z'),'America/Sao_Paulo'),'2026-11');
  assert.equal(financeMonthAt(new Date(sp.endExclusiveIso),'America/Sao_Paulo'),'2026-12');
  assert.equal(financeMonthRange('2018-12','America/Sao_Paulo').startIso,'2018-12-01T02:00:00.000Z');
  assert.equal(financeMonthRange('2026-12','America/Sao_Paulo').endExclusiveIso,'2027-01-01T03:00:00.000Z');
  assert.throws(()=>parseFinancePeriodTimeZone('GMT-3'),/PERIOD_INVALID/);
  assert.throws(()=>parseFinancePeriodTimeZone(['UTC']),/PERIOD_INVALID/);
  assert.throws(()=>financeMonthRange('2026-13'),/PERIOD_INVALID/);
  assert.equal(createStoreCostCenterPeriodAccumulator('America/Sao_Paulo').finish({paidMinor:0,paidCount:0,openDueMinor:0,openDueCount:0}).timeZone,'America/Sao_Paulo');
});

test('custom centers and categories can be renamed and removed without rewriting historical accounts',()=>{
  let t=mutateFinanceTaxonomy(emptyFinanceTaxonomy(),'centers','create','cc_custom_a','Manutenção');
  t=mutateFinanceTaxonomy(t,'categories','create','cat_custom_a','Licenças');
  assert.throws(()=>mutateFinanceTaxonomy(t,'centers','rename','cc_infrastructure','X'),/TAXONOMY_INVALID/);
  assert.throws(()=>mutateFinanceTaxonomy(t,'centers','create','cc_custom_b','infraestrutura'),/TAXONOMY_INVALID/);
  assert.throws(()=>mutateFinanceTaxonomy(t,'categories','create','cat_custom_b','aluguel'),/TAXONOMY_INVALID/);
  const p=buildManualStoreFinancePayable({id:'p',storeId:'s',description:'Conta',amountMinor:100,category:'other',dueDate:'2026-11-30',recurrence:'none',createdByUserId:'o',now,costCenter:resolveCustomFinanceRef(t,'centers','cc_custom_a'),customCategory:resolveCustomFinanceRef(t,'categories','cat_custom_a')});
  t=mutateFinanceTaxonomy(t,'centers','rename','cc_custom_a','Manutenção predial');
  t=mutateFinanceTaxonomy(t,'categories','remove','cat_custom_a',undefined);
  assert.throws(()=>resolveCustomFinanceRef(t,'categories','cat_custom_a'),/TAXONOMY_INVALID/);
  assert.equal(normalizeStoreFinancePayable(p).costCenter?.name,'Manutenção');
  assert.equal(normalizeStoreFinancePayable(p).customCategory?.name,'Licenças');
  assert.throws(()=>normalizeStoreFinancePayable({...p,category:'payroll'}),/TAXONOMY_INVALID/);
  const a=createStoreCostCenterPeriodAccumulator();
  a.add(p.costCenter,100,'paid');a.add(resolveCustomFinanceRef(t,'centers','cc_custom_a'),200,'paid');
  assert.equal(a.finish({paidMinor:300,paidCount:2,openDueMinor:0,openDueCount:0}).status,'observed');
});

test('finance runtime discards old store and session responses and refreshes taxonomy without stale override',()=>{
  const runtime=readFileSync('src/components/StoreFinanceRuntime.tsx','utf8');
  const ui=readFileSync('src/components/store/StorePayablesWorkspace.tsx','utf8');
  assert.match(runtime,/onAuthStateChanged\(auth/);
  assert.match(runtime,/key=\{storeId\+':'\+session\.epoch\}/);
  assert.match(runtime,/payload.storeId!==storeId\|\|auth.currentUser!==user/);
  assert.match(runtime,/request.current\?\.abort\(\)/);
  assert.match(ui,/taxonomyOverride\?\.base===taxonomyProp/);
  assert.match(ui,/if\(auth.currentUser!==user\)throw Error/);
});
