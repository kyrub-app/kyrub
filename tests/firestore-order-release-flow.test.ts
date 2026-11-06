import assert from 'node:assert/strict';
import test, {before,after,beforeEach} from 'node:test';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {build} from 'esbuild';
import {orderReleaseFixture} from './helpers/orderReleaseFixture';
import {isPrepaidOrderReleased} from '../shared/orderReleasePolicy';

// This suite cannot run against a live project, even if credentials are present.
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:8088$/);
const app=initializeApp({projectId:'demo-kyrub-order-release'},'isolated-order-release-flow');
const db=getFirestore(app);
(globalThis as any).__orderReleaseEmulatorDb=db;
let service:any;
const now='2026-11-06T12:00:00.000Z';
const path='artifacts/seller/public/data/customerOrders/order';
const paymentPath='stores/seller/payments/payment';
before(async()=>{
  const bundle=await build({stdin:{contents:`export * from './server/payments/marketplaceOrderPaymentSettlementService.ts';
    export * from './server/payments/paymentWebhookProcessor.ts';
    export * from './server/inventory/orderInventoryService.ts';`,resolveDir:process.cwd(),loader:'ts'},
    bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'emulator-only-db',setup(plugin){
      plugin.onResolve({filter:/firebaseAdmin\.js$/},()=>({path:'db',namespace:'emulator-only-db'}));
      plugin.onLoad({filter:/.*/,namespace:'emulator-only-db'},()=>({contents:'export const adminDb=globalThis.__orderReleaseEmulatorDb;',loader:'js'}));
    }}]});
  const module={exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  service=module.exports;
});
beforeEach(async()=>{
  // Clear only this dedicated emulator namespace; never production/history.
  const result=await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-kyrub-order-release/databases/(default)/documents',{method:'DELETE'});
  assert.equal(result.ok,true);
  const batch=db.batch();
  for(const [key,value] of orderReleaseFixture(now)) batch.set(db.doc(key),value);
  batch.delete(db.doc('tenants/seller')); // Legacy inventory authority avoids unrelated member setup.
  batch.update(db.doc(paymentPath),{status:'pending'});
  batch.update(db.doc('stores/seller/paymentIntents/intent'),{status:'pending'});
  batch.update(db.doc(path),{status:'pending'});
  await batch.commit();
});
after(async()=>{await db.terminate();await deleteApp(app);});
const paidEvent={provider:'mercado-pago',eventId:'paid-event',eventType:'payment.paid',providerPaymentId:'psp',
  paymentIntentId:'intent',amount:20,currency:'BRL',method:'pix',occurredAt:now,signatureVerified:true,recipientAccountId:'collector'};
const settle=()=>service.settleMarketplaceOperationalOrderAfterPayment({storeId:'seller',orderId:'order',paymentIntentId:'intent',occurredAt:now});
const read=async()=> (await db.doc(path).get()).data()!;
test('real Firestore transaction: approve → full verified payment → prepare; concurrent replay captures once',async()=>{
  await service.transitionOrderStatusWithInventory('seller','order','accepted');
  assert.equal(isPrepaidOrderReleased(await read() as any),false);
  await assert.rejects(service.transitionOrderStatusWithInventory('seller','order','preparing'),/liberação financeira/);
  const outcomes=await Promise.all([1,2,3].map(()=>service.processVerifiedPaymentWebhook({storeId:'seller',paymentId:'payment',event:paidEvent})));
  assert.equal(outcomes.filter(x=>!x.duplicate).length,1);
  await settle();
  assert.equal(isPrepaidOrderReleased(await read() as any),true);
  await service.transitionOrderStatusWithInventory('seller','order','preparing');
  assert.equal((await read()).status,'preparing');
});
test('real Firestore transaction: partial payment cannot release or prepare',async()=>{
  await service.transitionOrderStatusWithInventory('seller','order','accepted');
  await assert.rejects(service.processVerifiedPaymentWebhook({storeId:'seller',paymentId:'payment',event:{...paidEvent,amount:10}}),/AMOUNT_MISMATCH/);
  await assert.rejects(settle());
  assert.equal(isPrepaidOrderReleased(await read() as any),false);
});
test('real Firestore transaction: late payment does not revive a cancelled request',async()=>{
  await service.transitionOrderStatusWithInventory('seller','order','cancelled',{reason:'Cliente cancelou'});
  await service.processVerifiedPaymentWebhook({storeId:'seller',paymentId:'payment',event:paidEvent});
  await settle();
  assert.equal((await read()).status,'cancelled');
  assert.equal(isPrepaidOrderReleased(await read() as any),false);
});
