import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (p: string) => readFileSync(p, 'utf8');

test('payment audit is scoped, bounded and read-only with an inventory identity check', () => {
  const source = read('server/admin/mercadoPagoMerchantPixPaymentAuditService.ts');
  assert.match(source, /loadMercadoPagoMerchantPixMigrationInventory\(\)/);
  assert.match(source, /inventory\.complete/);
  assert.match(source, /row\.canonicalStoreId === requestedStoreId/);
  assert.match(source, /MAX_PER_COLLECTION \+ 1/);
  assert.match(source, /artifacts\/\$\{tenantId\}\/public\/data\/customerOrders/);
  assert.match(source, /stores\/\$\{requestedStoreId\}\/paymentIntents/);
  assert.match(source, /stores\/\$\{requestedStoreId\}\/payments/);
  assert.doesNotMatch(source, /collectionGroup\(|\.set\(|\.update\(|\.delete\(|runTransaction|accessToken|refreshToken/);
});

test('production and local audit routes require super admin and allow GET only', () => {
  const prod = read('api/admin/operations/health.ts');
  const server = read('server/admin/operationsHealthRouter.ts');
  assert.match(prod, /transport === 'mercado-pago-store-payment-audit'/);
  assert.match(prod, /authorizeIntegrationReadiness\(authorization\)/);
  assert.match(prod, /loadMerchantPixStorePaymentAudit\(headerValue\(request\.query\?\.storeId\)\)/);
  assert.match(prod, /method !== 'GET'/);
  assert.match(server, /loadMerchantPixStorePaymentAudit\(clean\(request\.query\.storeId\)\)/);
  assert.match(server, /authorizeIntegrationReadiness\(request\.get\('authorization'\) \?\? ''\)/);
  const card = read('src/components/admin/AdminMercadoPagoMigrationInventoryCard.tsx');
  assert.match(card, /Conferir pedidos e Pix de/);
  assert.match(card, /\(somente leitura\)/);
  assert.match(card, /snapshot\.items\.filter\(item => item\.canonicalStoreId && item\.readiness !== 'identity_review'\)/);
  assert.match(card, /runAudit\(item\.canonicalStoreId\)/);
  assert.match(card, /auditStoreId === item\.canonicalStoreId/);
  assert.doesNotMatch(card, /snapshot\.items\.length === 1/);
  assert.doesNotMatch(card, /method: 'POST'/);
});

test('order completion is not a paid event; local links distinguish pending and historical orders', async()=>{
 const {summarizeMerchantPixLinks}=await import('../server/admin/merchantPixLinkAuditPolicy.js');
 const rows=[
 {id:'o1',data:{status:'completed',paymentStatus:'unpaid',storeId:'store'}},
 {id:'o2',data:{status:'pending',paymentStatus:'unpaid',storeId:'store',paymentIntentId:'i',paymentId:'p'}},
 {id:'o3',data:{status:'completed',paymentStatus:'paid',storeId:'store'}},
 ];
 const intents=[{id:'i',data:{context:'marketplace',method:'pix',status:'pending',storeId:'store',target:{orderId:'o2'},providerIntentId:'mp',amount:10}}];
 const payments=[{id:'p',data:{context:'marketplace',method:'pix',status:'pending',storeId:'store',paymentIntentId:'i',orderId:'o2',providerPaymentId:'mp',amount:10}}];
 const summary=summarizeMerchantPixLinks({orders:rows,intents,payments,complete:true,storeId:'store',tenantId:'tenant'});
 assert.deepEqual(summary.orderStates,{paid:1,partial:0,unpaid:2,unknown:0,completed:2});
 assert.deepEqual(summary.pending,{intents:1,payments:1,withProviderId:1,completeTriples:1,needsReview:0});
 assert.equal(summary.paidOrderLinks.withoutExplicitPaymentId,1);
 assert.equal(summary.paidOrderLinks.linkedCanonicalPaid,0);
 assert.equal(JSON.stringify(summary).includes('"mp"'),false);
 const mismatch=summarizeMerchantPixLinks({orders:rows,intents,payments:[{...payments[0],data:{...payments[0].data,storeId:'another'}}],complete:false,storeId:'store',tenantId:'tenant'});
 assert.equal(mismatch.pending.completeTriples,0);
 assert.equal(mismatch.pending.needsReview,1);
 assert.equal(mismatch.complete,false);
});

test('test history preparation includes provider references across PDV, table, legacy and terminal states',async()=>{
 const {summarizeTestHistoryPaymentReferences}=await import('../server/admin/merchantPixLinkAuditPolicy.js');
 const intents=[{id:'i',data:{status:'pending',context:'pos',providerIntentId:'private-id'}},{id:'old',data:{status:'pending',providerIntentId:123}},{id:'done',data:{context:'marketplace',status:'expired',providerIntentId:'another-private-id'}}];
 const payments=[{id:'p',data:{status:'pending',context:'table',providerPaymentId:'bound'}},{id:'c',data:{status:'refunded',providerPaymentId:'historical'}},{id:'local',data:{status:'pending',providerPaymentId:''}}];
 const result=summarizeTestHistoryPaymentReferences(intents,payments);
 assert.equal(result.intents.withProviderReference,3);
 assert.equal(result.intents.pendingWithProviderReference,2);
 assert.deepEqual(result.intents.pendingContexts,{marketplace:0,pos:1,table:0,legacyOrOther:1});
 assert.equal(result.payments.withProviderReference,2);
 assert.equal(result.payments.pendingWithProviderReference,1);
 assert.deepEqual(result.payments.pendingContexts,{marketplace:0,pos:0,table:1,legacyOrOther:1});
 assert.doesNotMatch(JSON.stringify(result),/private-id|historical|bound/);
});

test('official store cleanup is a one-time guarded archive, never an arbitrary store reset',async()=>{
 const {KYRUB_OFFICIAL_TEST_HISTORY_STORE, KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION,validKyrubOfficialTestHistoryRequest}=await import('../shared/kyrubOfficialTestHistoryCleanup.js');
 const body={action:'archive-and-clear',storeId:KYRUB_OFFICIAL_TEST_HISTORY_STORE,digest:'0'.repeat(64),confirmation:KYRUB_OFFICIAL_TEST_HISTORY_CONFIRMATION};
 assert.equal(validKyrubOfficialTestHistoryRequest(body),true);
 assert.equal(validKyrubOfficialTestHistoryRequest({...body,storeId:'different'}),false);
 assert.equal(validKyrubOfficialTestHistoryRequest({...body,confirmation:'YES'}),false);
 assert.equal(validKyrubOfficialTestHistoryRequest({...body,secret:'extra'}),false);
 const service=read('server/admin/mercadoPagoTestHistoryCleanupService.ts');
 assert.match(service,/runTransaction\(async tx/);
 assert.match(service,/storeName==='Kyrub Oficial'/);
 assert.match(service,/inventory\.rolloutMode!=='disabled'/);
 assert.match(service,/hasExternalLink\(data\)/);
 assert.match(service,/HISTORICO_FINANCEIRO_ASSOCIADO/);
 assert.match(service,/RESERVA_ESTOQUE_ASSOCIADA/);
 assert.match(service,/SNAPSHOT_COMERCIAL_ASSOCIADO/);
 assert.match(service,/tx\.create\(archive/);
 assert.match(service,/tx\.delete\(ref\(row\.path\)\)/);
 assert.doesNotMatch(service,/mercadoPagoStoreRequest|createMercadoPagoPixPayment|cancelMercadoPagoPayment/);
 const api=read('api/admin/operations/health.ts');
 const ui=read('src/components/admin/AdminMercadoPagoMigrationInventoryCard.tsx');
 assert.match(api,/transport === 'mercado-pago-test-history-cleanup'/);
 assert.match(api,/authorizeIntegrationReadiness\(authorization\)/);
 assert.match(api,/validKyrubOfficialTestHistoryRequest\(request\.body\)/);
 assert.match(ui,/AdminKyrubOfficialTestHistoryCleanup/);
});

test('provider reconciliation preflight uses only seller OAuth GET and never unlocks cleanup',async()=>{
 const {normalizeHistoricalPaymentId,classifyHistoricalProviderPayment}=await import('../server/admin/mercadoPagoTestHistoryProviderPolicy.js');
 assert.equal(normalizeHistoricalPaymentId(' 012345 '),'012345');
 assert.equal(normalizeHistoricalPaymentId(1234),'1234');
 assert.equal(normalizeHistoricalPaymentId('uuid'),null);
 assert.equal(normalizeHistoricalPaymentId('../other'),null);
 const valid={id:'123',collector_id:'3631706959',currency_id:'BRL',payment_method_id:'pix',status:'pending',metadata:{kyrub_store_id:'store-ae53dc42e57eb9d5c3f7151c1431'}};
 assert.deepEqual(classifyHistoricalProviderPayment(valid,'123','3631706959','store-ae53dc42e57eb9d5c3f7151c1431'),{kind:'pending'});
 assert.deepEqual(classifyHistoricalProviderPayment({...valid,status:'approved'},'123','3631706959','store-ae53dc42e57eb9d5c3f7151c1431'),{kind:'approved'});
 for(const changes of [{id:'444'},{collector_id:'999'},{currency_id:'USD'},{payment_method_id:'credit_card'},{metadata:{kyrub_store_id:'another'}}]){
  assert.deepEqual(classifyHistoricalProviderPayment({...valid,...changes},'123','3631706959','store-ae53dc42e57eb9d5c3f7151c1431'),{kind:'mismatch'});
 }
 const service=read('server/admin/mercadoPagoTestHistoryProviderAuditService.ts');
 assert.match(service,/validateMercadoPagoStoreConnection\(tenant\)/);
 assert.match(service,/EXPECTED_ACCOUNT='3631706959'/);
 assert.match(service,/mercadoPagoStoreRequest<Record<string,unknown>>\(tenant/);
 assert.match(service,/requiresManualReview:true,allowsCleanup:false/);
 assert.doesNotMatch(service,/cancelMercadoPagoPayment|createStoreScopedMercadoPagoLocalPix|method:'POST'|resolveMercadoPagoAccessToken/);
 const production=read('api/admin/operations/health.ts');
 assert.match(production,/transport === 'mercado-pago-test-history-provider-audit'/);
 assert.match(production,/method!=='GET'/);
 assert.match(production,/authorizeIntegrationReadiness\(authorization\)/);
 const panel=read('src/components/admin/AdminKyrubOfficialTestHistoryCleanup.tsx');
 assert.match(panel,/REGISTROS_LEGADOS_FORA_DO_ESCOPO/);
 assert.match(panel,/Conferir situação das cobranças no Mercado Pago/);
});

test('cleanup preflight lists scoped aggregate blockers without leaking financial document IDs',()=>{
 const service=read('server/admin/mercadoPagoTestHistoryCleanupService.ts');
 const panel=read('src/components/admin/AdminKyrubOfficialTestHistoryCleanup.tsx');
 assert.match(service,/const evidence:EvidenceRow\[\]=\[\]/);
 assert.match(service,/dependencySources\.map\(source=>/);
 assert.match(service,/addEvidence\(dependencySources\[index\]\.kind/);
 assert.match(service,/kind:'otherOrders',scope:'legacy'/);
 assert.match(service,/evidence\};/);
 assert.match(panel,/Detalhamento dos registros que impedem a limpeza/);
 assert.match(panel,/A ausência de vínculo explícito não prova independência/);
 assert.doesNotMatch(panel,/sourcePath|providerPaymentId:.*\/v1\/payments/);
});

test('legacy cleanup evidence states and reference shapes are aggregated without IDs or implicit safety claims',async()=>{
 const {classifyHistoricalTestEvidence}=await import('../server/admin/merchantTestHistoryEvidencePolicy.js');
 const rows=[
  {status:'pending',providerPaymentId:'456789'},
  {status:'paid',providerPaymentId:'fake-payment'},
  {status:'expired',providerPaymentId:''},
  {status:'unknown',providerPaymentId:'secret-data'}
 ];
 assert.deepEqual(classifyHistoricalTestEvidence('payments',rows),{
  states:{open:1,recordedPaid:1,closedOrReversed:1,unknown:1},
  providerReferenceShape:{numeric:1,nonNumeric:2,missing:1}
 });
 assert.deepEqual(classifyHistoricalTestEvidence('economicObligations',[
  {status:'pending',paymentId:'p'},
  {status:'eligible',paymentId:'q'},
  {status:'settled',paymentId:'r'}
 ]),{states:{open:2,recordedPaid:1,closedOrReversed:0,unknown:0}});
 assert.deepEqual(classifyHistoricalTestEvidence('paymentWebhookEvents',[
  {eventType:'payment.paid',providerPaymentId:'123'},
  {eventType:'payment.expired',providerPaymentId:'456'}
 ]),{states:{open:0,recordedPaid:1,closedOrReversed:1,unknown:0}});
 const result=classifyHistoricalTestEvidence('payments',rows);
 assert.doesNotMatch(JSON.stringify(result),/456789|fake-payment|secret-data/);
 const service=read('server/admin/mercadoPagoTestHistoryCleanupService.ts');
 assert.match(service,/classifyHistoricalTestEvidence\(kind,snapshot\.docs/);
 assert.match(read('src/components/admin/AdminKyrubOfficialTestHistoryCleanup.tsx'),/Estados registrados: abertos/);
});

test('legacy reconciliation correlates only verified provider states and open obligations, without leaking IDs',async()=>{
 const {legacyProviderReferences,summarizeLegacyPaymentAndObligations}=await import('../server/admin/merchantLegacyProviderReconciliationPolicy.js');
 const intents=[
  {id:'i1',data:{providerIntentId:'900'}},
  {id:'i2',data:{providerIntentId:'temporary-id'}},
  {id:'i3',data:{providerIntentId:''}}
 ];
 const payments=[
  {id:'p1',data:{status:'paid',providerPaymentId:'900'}},
  {id:'p2',data:{status:'paid',providerPaymentId:'901'}},
  {id:'p3',data:{status:'pending',providerPaymentId:''}}
 ];
 const refs=legacyProviderReferences(intents,payments);
 assert.deepEqual(refs,{uniqueIds:['900','901'],intentNumeric:1,paymentNumeric:2,malformed:1,missing:2});
 const obligations=[{id:'o',data:{status:'pending',paymentId:'p1'}},{id:'o2',data:{status:'settled',paymentId:'p2'}}];
 const statuses=new Map([['900','approved'],['901','expired']] as const);
 const result=summarizeLegacyPaymentAndObligations(payments,obligations,statuses);
 assert.deepEqual(result,{
  locallyPaid:2,locallyPaidProviderApproved:1,locallyPaidProviderOther:1,locallyPaidUnverified:0,
  openObligations:1,openObligationsLinkedToLocallyPaid:1,openObligationsWithoutKnownPayment:0
 });
 assert.doesNotMatch(JSON.stringify(result),/900|901|p1|p2|temporary-id/);
 const {classifyHistoricalProviderPayment}=await import('../server/admin/mercadoPagoTestHistoryProviderPolicy.js');
 const provider={id:'900',collector_id:'3631706959',currency_id:'BRL',payment_method_id:'pix',status:'approved',metadata:{kyrub_store_id:'legacy-tenant'}};
 assert.deepEqual(classifyHistoricalProviderPayment(provider,'900','3631706959','canonical-id','legacy-tenant'),{kind:'approved'});
 assert.deepEqual(classifyHistoricalProviderPayment(provider,'900','3631706959','canonical-id'),{kind:'mismatch'});
 assert.deepEqual(classifyHistoricalProviderPayment({...provider,collector_id:'999'},'900','3631706959','canonical-id','legacy-tenant'),{kind:'mismatch'});
 const service=read('server/admin/mercadoPagoTestHistoryProviderAuditService.ts');
 assert.match(service,/validateMercadoPagoStoreConnection\(tenant\)/);
 assert.match(service,/legacyIntents.size!==6\|\|legacyPayments.size!==6\|\|legacyObligations.size!==1/);
 assert.match(service,/mercadoPagoStoreRequest<Record<string,unknown>>\(tenant/);
 assert.match(service,/new Set\(\[\.\.\.unique,\.\.\.legacyReferences.uniqueIds\]\)/);
 assert.match(service,/requiresManualReview:true,allowsCleanup:false/);
 assert.doesNotMatch(service,/cancelMercadoPagoPayment|method:'POST'|resolveMercadoPagoAccessToken|\.delete\(/);
 const panel=read('src/components/admin/AdminKyrubOfficialTestHistoryCleanup.tsx');
 assert.match(panel,/Histórico legado · conciliação com a conta recebedora/);
});

test('official operational cutover is a one-time presentation marker, not deletion or payment settlement',async()=>{
 const {
  OFFICIAL_PHASE_STORE_ID,OFFICIAL_PHASE_CONFIRMATION,validOfficialPhaseActivation,
  showOrderInCurrentPhase,effectiveHistoryStart
 }=await import('../shared/officialOperationalPhase.js');
 const payload={storeId:OFFICIAL_PHASE_STORE_ID,action:'start-operational-phase',confirmation:OFFICIAL_PHASE_CONFIRMATION};
 assert.equal(validOfficialPhaseActivation(payload),true);
 assert.equal(validOfficialPhaseActivation({...payload,storeId:'another-store'}),false);
 assert.equal(validOfficialPhaseActivation({...payload,confirmation:'SIM'}),false);
 assert.equal(validOfficialPhaseActivation({...payload,extra:'unsafe'}),false);
 assert.equal(showOrderInCurrentPhase({status:'completed',createdAt:'2026-11-20T12:00:00Z'},'2026-11-22T12:00:00Z'),false);
 assert.equal(showOrderInCurrentPhase({status:'rejected',createdAt:'2026-11-20T12:00:00Z'},'2026-11-22T12:00:00Z'),false);
 assert.equal(showOrderInCurrentPhase({status:'cancelled',createdAt:'2026-11-20T12:00:00Z'},'2026-11-22T12:00:00Z'),false);
 assert.equal(showOrderInCurrentPhase({status:'pending',createdAt:'2026-11-20T12:00:00Z'},'2026-11-22T12:00:00Z'),true);
 assert.equal(showOrderInCurrentPhase({status:'preparing',createdAt:'2026-11-20T12:00:00Z'},'2026-11-22T12:00:00Z'),true);
 assert.equal(showOrderInCurrentPhase({status:'completed',createdAt:'2026-11-23T12:00:00Z'},'2026-11-22T12:00:00Z'),true);
 assert.equal(showOrderInCurrentPhase({status:'completed',createdAt:'invalid'},'2026-11-22T12:00:00Z'),true);
 assert.equal(effectiveHistoryStart('2026-11-01T00:00:00Z','2026-11-22T00:00:00Z'),'2026-11-22T00:00:00Z');
 assert.equal(effectiveHistoryStart('2026-12-01T00:00:00Z','2026-11-22T00:00:00Z'),'2026-12-01T00:00:00Z');
 const service=read('server/admin/officialOperationalPhaseService.ts');
 assert.match(service,/tx\.create\(markerRef/);
 assert.match(service,/role!=='super_admin'/);
 assert.match(service,/financialEvidence|financeBalancesUnaffected:true/);
 assert.match(service,/paymentProcessingUnaffected:true/);
 assert.match(service,/loadOwnerStoreInstitutionalRepresentation/);
 assert.match(service,/legacyStoreId!==input\.legacyStoreId/);
 assert.doesNotMatch(service,/tx\.delete\(|tx\.update\(|cancelMercadoPago|mercadoPagoStoreRequest|\.collection\('payments'\)\.delete/);
 const production=read('api/admin/operations/health.ts');
 const local=read('server/admin/operationsHealthRouter.ts');
 const owner=read('api/health.ts');
 assert.match(production,/transport === 'kyrub-official-operational-phase'/);
 assert.match(production,/validOfficialPhaseActivation\(request\.body\)/);
 assert.match(production,/authorizeIntegrationReadiness\(authorization\)/);
 assert.match(local,/validOfficialPhaseActivation\(request\.body\)/);
 assert.match(owner,/transport === 'official-operational-phase'/);
 assert.match(owner,/verifyFirebaseIdToken\(bearer\)/);
 const history=read('server/payments/storeFinanceHistoryRouter.ts');
 assert.match(history,/getOfficialOperationalPhaseForLegacyStore\(storeId\)/);
 assert.match(history,/minOccurredAt:activeView==='current'/);
 assert.match(history,/mode === 'period'/);
 assert.match(history,/buildPeriodView\(storeId, period\)/);
 assert.match(history,/effectiveHistoryStart/);
 const historyUi=read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
 const orders=read('src/components/customer/CustomerOrderInbox.tsx');
 const panel=read('src/components/admin/AdminKyrubOfficialTestHistoryCleanup.tsx');
 assert.match(historyUi,/Histórico completo \(inclui testes\)/);
 assert.match(orders,/showOrderInCurrentPhase\(order,phaseEffectiveAt\)/);
 assert.match(orders,/Ver finalizados da fase de testes/);
 assert.match(panel,/Iniciar nova fase sem excluir registros/);
});
