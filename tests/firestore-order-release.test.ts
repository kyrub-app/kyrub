import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const legacy = 'artifacts/owner/public/data/customerOrders/order';
const canonical = 'stores/store/orders/order';
const pending = {id: 'order', storeId: 'owner', buyerId: 'buyer', source: 'customer', fulfillmentType: 'pickup',
  status: 'pending', paymentStatus: 'unpaid', total: 20, releaseMode: 'pay_before_fulfillment',
  paymentIntentId: 'intent', paymentId: 'payment', operationalRelease: null};
before(async () => { environment = await initializeTestEnvironment({projectId: 'kyrub-security-test',
  firestore: {host: '127.0.0.1', port: 8088, rules: readFileSync('.firebase/firestore.combined.rules', 'utf8')} }); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'stores/store'), {id: 'store', ownerId: 'owner', legacyTenantId: 'owner'});
    await setDoc(doc(db, legacy), pending);
    await setDoc(doc(db, canonical), {...pending, storeId: 'store', legacyStoreId: 'owner'});
  });
});
after(async () => { await environment?.cleanup(); });

for (const actor of ['owner', 'buyer', 'stranger']) {
  for (const path of [legacy, canonical]) {
    for (const [label, patch] of [
      ['forge release', {operationalRelease: {schemaVersion: 1, amountMinor: 2000}}],
      ['remove mode', {releaseMode: deleteField()}],
      ['reclassify mode', {releaseMode: 'open_tab'}],
      ['skip approval/payment', {status: 'preparing', paymentStatus: 'paid'}],
      ['replace payment', {paymentId: 'other'}],
    ] as const) test(`${actor} cannot ${label} at ${path}`, async () => {
      await assertFails(updateDoc(doc(environment.authenticatedContext(actor).firestore(), path), patch));
    });
  }
}
test('owner cannot create forged legacy release or server intent', async () => {
  const db = environment.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(db, `${legacy}-forged`), {...pending, id: 'order-forged'}));
  await assertFails(setDoc(doc(db, 'paymentWebhookEvents/forged'), {eventType: 'payment.paid'}));
  await assertFails(setDoc(doc(db, 'stores/owner/paymentIntents/forged'), {status: 'paid'}));
});
test('buyer can cancel their pending request without granting operational authority', async () => {
  await assertSucceeds(updateDoc(doc(environment.authenticatedContext('buyer').firestore(), legacy), {status: 'cancelled', updatedAt: '2026-11-06'}));
});
test('unrelated private artifact subcollections retain owner access', async () => {
  const db = environment.authenticatedContext('owner').firestore();
  await assertSucceeds(setDoc(doc(db, 'artifacts/owner/private/settings/items/test'), {value: 1}));
  await assertSucceeds(getDoc(doc(db, 'artifacts/owner/private/settings/items/test')));
  await assertFails(getDoc(doc(environment.authenticatedContext('stranger').firestore(), 'artifacts/owner/private/settings/items/test')));
});
