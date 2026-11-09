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
