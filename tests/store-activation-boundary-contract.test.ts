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

test('Renda creates or opens the store workspace; it does not activate a paid term', () => {
  const renda = read('../src/components/tabs/RendaTab.tsx');
  assert.match(renda, /'Criar minha loja'/);
  assert.match(renda, /setIsGestaoOpen\(true\)/);
  assert.doesNotMatch(renda, /recordFirstCanonicalStoreActivation|activateCanonicalStoreAndReconcileOfficialPlan/);
});

test('saving settings and publishing a listing cannot trigger first activation', () => {
  const settings = read('../src/components/modals/StoreConfigModal.tsx');
  const save = settings.slice(settings.indexOf('const handleSave ='), settings.indexOf('const handlePublication ='));
  const publication = settings.slice(settings.indexOf('const handlePublication ='), settings.indexOf('const ', settings.indexOf('const handlePublication =') + 7) > 0 ? settings.indexOf('const ', settings.indexOf('const handlePublication =') + 7) : undefined);
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
  assert.ok(renda.indexOf("if (!response.ok)") < renda.indexOf("setIsGestaoOpen(true)", renda.indexOf("const openRetailerWorkspace")));
  assert.match(service, /runTransaction\(async tx/);
  assert.match(service, /if \(paidPlan\) \{/);
  assert.match(service, /return \{ plan: paidPlan, created: false \}/);
  assert.match(service, /tx\.create\(privateRef/);
  assert.doesNotMatch(service, /publicationStatus: 'published'|setStoreMarketplacePublication/);
});

test('pre-store paid entitlement is inherited by the first private store profile', () => {
  const service = read('../server/actions/freeStoreProvisioningService.ts');
  assert.match(service, /entitlement\?\.status === 'active'/);
  assert.match(service, /current\?\.plan !== entitlement\.plan/);
  assert.match(service, /tx\.set\(privateRef, \{ plan: entitlement\.plan/);
  assert.ok(service.indexOf('if (paidPlan)') < service.indexOf("plan: 'free', status: 'closed'"));
});
