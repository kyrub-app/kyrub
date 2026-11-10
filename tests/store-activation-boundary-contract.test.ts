import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const aiActions = read('../server/actions/actionExecutionService.ts');
const repair = read('../server/actions/canonicalStoreRepairService.ts');
const activation = read('../server/actions/firstCanonicalStoreActivationService.ts');

test('Kyrubia start-store action issues an authorization grant, not a first activation', () => {
  const begin = aiActions.indexOf('const executeStartStoreActivation =');
  const end = aiActions.indexOf('const assertActiveStoreActivationGrant', begin);
  assert.ok(begin >= 0 && end > begin);
  const grant = aiActions.slice(begin, end);
  assert.match(grant, /scope: 'store_activation'/);
  assert.match(grant, /allowedActions: \['update_store_profile'\]/);
  assert.doesNotMatch(grant, /activatedAt|recordFirstCanonicalStoreActivation/);
});

test('canonical repair must not record first activation or grant paid benefits', () => {
  assert.doesNotMatch(repair, /recordFirstCanonicalStoreActivation|activatePendingOfficialPlanForStore|activatedAt/);
});

test('first activation is explicit and reconciliation follows its committed timestamp', () => {
  const orchestrator = activation.slice(activation.indexOf('export async function activateCanonicalStoreAndReconcileOfficialPlan'));
  assert.match(orchestrator, /await recordFirstCanonicalStoreActivation\(input\)/);
  assert.match(orchestrator, /await activatePendingOfficialPlanForStore\(/);
  assert.match(orchestrator, /activatedAt: activation\.activatedAt/);
  assert.ok(orchestrator.indexOf('await recordFirstCanonicalStoreActivation(input)') <
    orchestrator.indexOf('await activatePendingOfficialPlanForStore('));
});

test('Pix reconciliation uses the reservation status read inside the Firestore transaction', () => {
  const checkout = read('../server/payments/officialPlanPixCheckout.ts');
  const start = checkout.indexOf('export async function activatePendingOfficialPlanForStore');
  assert.ok(start >= 0);
  const reconciliation = checkout.slice(start);
  assert.match(reconciliation, /const transactionalReservationStatus = slotDoc\.get\('checkoutReservationStatus'\)/);
  assert.match(reconciliation, /if \(transactionalReservationStatus === 'complete'/);
  assert.match(reconciliation, /if \(transactionalReservationStatus !== 'paid_pending_activation'\)/);
  assert.doesNotMatch(reconciliation, /if \(reservationStatus === 'complete'/);
  assert.doesNotMatch(reconciliation, /if \(reservationStatus !== 'paid_pending_activation'\)/);
});

test('creation activates canonical store without invoking legacy activation orchestrator', () => {
  const api = read('../api/plan-control.ts');
  const renda = read('../src/components/tabs/RendaTab.tsx');
  const activation = read('../server/actions/firstCanonicalStoreActivationService.ts');
  assert.match(activation, /export async function activateCanonicalStoreAndReconcileOfficialPlan/);
  assert.doesNotMatch(api, /activateCanonicalStoreAndReconcileOfficialPlan|recordFirstCanonicalStoreActivation/);
  assert.doesNotMatch(renda, /activateCanonicalStoreAndReconcileOfficialPlan|recordFirstCanonicalStoreActivation/);
  const freeStart = api.indexOf("case 'store.free.ensure'");
  const freeEnd = api.indexOf("case 'catalog.subscription.route'", freeStart);
  assert.ok(freeStart >= 0 && freeEnd > freeStart);
  assert.doesNotMatch(api.slice(freeStart, freeEnd), /activateCanonicalStoreAndReconcileOfficialPlan/);
});

test('Renda creation activates the store via server, while opening existing ERP does not restart a paid term', () => {
  const renda = read('../src/components/tabs/RendaTab.tsx');
  assert.match(renda, /'Criar minha loja'/);
  assert.match(renda, /setIsGestaoOpen\(true\)/);
  assert.doesNotMatch(renda, /recordFirstCanonicalStoreActivation|activateCanonicalStoreAndReconcileOfficialPlan/);
});

test('saving settings and publishing a listing cannot trigger first activation', () => {
  const settings = read('../src/components/modals/StoreConfigModal.tsx');
  const save = settings.slice(settings.indexOf('const handleSave ='), settings.indexOf('const handlePublication ='));
  const publicationStart = settings.indexOf('const handlePublication =');
  const publication = settings.slice(publicationStart, settings.indexOf('\n  };', publicationStart) + 5);
  assert.match(save, /saveStore\(true\)/);
  assert.match(publication, /setStoreMarketplacePublication\(/);
  assert.doesNotMatch(save + publication, /recordFirstCanonicalStoreActivation|activateCanonicalStoreAndReconcileOfficialPlan/);
});

test('existing-store Pix materialization fails closed on stale reservation and duplicate contracts', () => {
  const checkout = read('../server/payments/officialPlanPixCheckout.ts');
  const start = checkout.indexOf('async function materialize(d: any, payment: any)');
  const end = checkout.indexOf('async function reconcileLoaded(', start);
  assert.ok(start >= 0 && end > start);
  const materialization = checkout.slice(start, end);
  assert.match(materialization, /slot\.get\('checkoutReservationStatus'\) !== 'pending'/);
  assert.match(materialization, /existingContract\.exists \|\| existingSubscription\.exists/);
  assert.match(materialization, /scheduleOfficialPlanFromConfirmedPayment\(/);
  assert.match(materialization, /liveEntitlement\(entitlement\.data\(\)\)/);
});

test('a new confirmed Pix contract can begin before canonical store creation', () => {
  const checkout = read('../server/payments/officialPlanPixCheckout.ts');
  const materializeStart = checkout.indexOf('async function materialize(d: any, payment: any)');
  const reconcileStart = checkout.indexOf('async function reconcileLoaded(', materializeStart);
  const body = checkout.slice(materializeStart, reconcileStart);
  assert.match(body, /d\.buyerStoreId \? tx\.get\(/);
  assert.match(body, /Promise\.resolve\(null\)/);
  assert.match(body, /d\.buyerStoreProvisioningRequired !== true/);
  assert.match(body, /writePlanMirrors\(tx, uid, d\.buyerStoreId \?\? null/);
  assert.match(body, /state: 'active'/);
  const reconciliation = checkout.slice(reconcileStart);
  assert.match(reconciliation, /d\.status === 'paid_pending_activation'/);
  assert.doesNotMatch(reconciliation, /return d\.buyerStoreProvisioningRequired\s*\?/);
});

test('Criar minha loja provisions Free through authenticated server route before opening ERP', () => {
  const api = read('../api/plan-control.ts');
  const renda = read('../src/components/tabs/RendaTab.tsx');
  const service = read('../server/actions/freeStoreProvisioningService.ts');
  assert.match(api, /case 'store\.free\.ensure'/);
  assert.match(api, /ensureFreePlanForStoreCreation\(authorization\)/);
  assert.match(renda, /getIdToken\(\)/);
  assert.match(renda, /op=store\.free\.ensure/);
  const handler = renda.slice(renda.indexOf('const openRetailerWorkspace ='), renda.indexOf('\n  return (', renda.indexOf('const openRetailerWorkspace =')));
  const request = handler.indexOf('op=store.free.ensure');
  const confirmed = handler.indexOf('if (!response.ok)');
  const openAfterProvisioning = handler.indexOf('setIsGestaoOpen(true)', confirmed);
  assert.ok(request >= 0 && confirmed > request && openAfterProvisioning > confirmed);
  assert.match(service, /runTransaction\(async tx/);
  assert.match(service, /tx\.create\(privateRef/);
  assert.doesNotMatch(service, /publicationStatus: 'published'|setStoreMarketplacePublication/);
});

test('Criar minha loja commits an idempotent canonical activation without publishing', () => {
  const service = read('../server/actions/freeStoreProvisioningService.ts');
  assert.match(service, /activateStoreAfterProvisioning\(uid, provisioned\.plan\)/);
  assert.match(service, /adminDb\.collection\('stores'\)\.where\('ownerId', '==', uid\)/);
  assert.match(service, /ownerStores\.docs\.length > 1/);
  assert.match(service, /STORE_ACTIVATION_IDENTITY_CONFLICT/);
  assert.match(service, /STORE_ACTIVATION_PLAN_RECONCILIATION_REQUIRED/);
  assert.match(service, /activatedAt: FieldValue\.serverTimestamp\(\)/);
  assert.match(service, /publicationStatus: 'paused'/);
  assert.match(service, /else if \(previous == null\)/);
  assert.doesNotMatch(service, /publicationStatus: 'published'/);
});

test('paid pre-store grants are inherited, but expired or ambiguous grants fail closed', () => {
  const service = read('../server/actions/freeStoreProvisioningService.ts');
  assert.match(service, /paidEntitlement/);
  assert.match(service, /expiryMillis > Date\.now\(\)/);
  assert.match(service, /tx\.create\(privateRef, \{\s*id: uid, ownerId: uid, plan: entitlement\.plan/);
  assert.match(service, /FREE_STORE_ENTITLEMENT_RECONCILIATION_REQUIRED/);
  assert.ok(service.indexOf('if (paidEntitlement)') < service.indexOf("plan: 'free', status: 'closed'"));
});

test('Free provisioning fails closed on authentication and transient server failures', () => {
  const api = read('../api/plan-control.ts');
  const renda = read('../src/components/tabs/RendaTab.tsx');
  assert.match(api, /operation === 'store\.free\.ensure'/);
  assert.match(api, /FREE_STORE_AUTH_REQUIRED/);
  assert.match(api, /FREE_STORE_PROVISIONING_UNAVAILABLE/);
  assert.match(renda, /if \(!response\.ok\) throw Error\('FREE_STORE_PROVISIONING_FAILED'\)/);
  assert.match(renda, /finally \{\s*setIsProvisioningFree\(false\)/);
});

test('store creation button prevents duplicate requests while Free provisioning is in flight', () => {
  const renda = read('../src/components/tabs/RendaTab.tsx');
  assert.match(renda, /disabled=\{isCheckingStore \|\| isProvisioningFree\}/);
  assert.match(renda, /isProvisioningFree\s*\? 'Preparando loja\.\.\.'/);
  assert.match(renda, /if \(isProvisioningFree\) return/);
});

test('existing store opens ERP without triggering Free provisioning again', () => {
  const renda = read('../src/components/tabs/RendaTab.tsx');
  const handler = renda.slice(renda.indexOf('const openRetailerWorkspace ='), renda.indexOf('\n  return (', renda.indexOf('const openRetailerWorkspace =')));
  assert.match(handler, /if \(hasConfiguredStore\) \{\s*setIsGestaoOpen\(true\);\s*setGestaoRole\('retailer'\);\s*return;/);
  assert.ok(handler.indexOf('if (hasConfiguredStore)') < handler.indexOf("op=store.free.ensure"));
});

test('first store creation waits for canonical receipt and remembers identity without a name', () => {
  const renda = read('../src/components/tabs/RendaTab.tsx');
  const handler = renda.slice(renda.indexOf('const openRetailerWorkspace ='), renda.indexOf('\n  return (', renda.indexOf('const openRetailerWorkspace =')));
  assert.match(handler, /activation\.canonicalStoreId/);
  assert.match(handler, /STORE_ACTIVATION_RECEIPT_MISSING/);
  assert.ok(handler.indexOf('STORE_ACTIVATION_RECEIPT_MISSING') < handler.lastIndexOf('setIsGestaoOpen(true)'));
  assert.match(renda, /data\.canonicalStoreId/);
  assert.match(handler, /setHasConfiguredStore\(true\)/);
});

test('store creation reconciles pending paid checkout after persisting activation timestamp', () => {
  const service = read('../server/actions/freeStoreProvisioningService.ts');
  assert.match(service, /activatePendingOfficialPlanForStore/);
  assert.match(service, /activated\.get\('activatedAt'\)/);
  assert.match(service, /buyerUid: uid, canonicalStoreId, activatedAt/);
  assert.ok(service.indexOf('activateStoreAfterProvisioning(uid, provisioned.plan)') <
    service.indexOf('await activatePendingOfficialPlanForStore('));
});
