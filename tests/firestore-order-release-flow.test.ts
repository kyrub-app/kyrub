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
    export {createMarketplacePaymentIntent} from './server/payments/paymentIntentRouter.ts';
    export {isOrderVisibleInKds} from './src/utils/orderWorkflow';
    export {parseCustomerOrder,customerOrdersEquivalent} from './src/utils/customerOrders';
    export * from './server/payments/paymentWebhookProcessor.ts';
    export * from './server/inventory/orderInventoryService.ts';
    export {cancelOrderItemsWithRefund} from './server/payments/orderItemCancellationService.ts';
    export {requestCanonicalOrderRefund} from './server/payments/paymentRefundService.ts';
    export {reconcileMercadoPagoPayment} from './server/payments/storeMercadoPagoReconciliationRouter.ts';
    export {recoverMissingCanonicalPaidCaptures} from './server/payments/storeFinanceRouter.ts';
    export {saveMercadoPagoPaymentProviderBinding} from './server/payments/paymentProviderBindingService.ts';
    export {listStoreEconomicLedgerEntries} from './server/payments/storeEconomicLedgerService.ts';
    export {storeProviderPaymentReconciliationPath} from './shared/storeProviderPaymentReconciliation.ts';`,resolveDir:process.cwd(),loader:'ts'},
    bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'emulator-only-db',setup(plugin){
      plugin.onResolve({filter:/firebaseAdmin\.js$/},()=>({path:'db',namespace:'emulator-only-db'}));
      plugin.onLoad({filter:/.*/,namespace:'emulator-only-db'},()=>({contents:'export const adminDb=globalThis.__orderReleaseEmulatorDb; export const getFirebaseAdminProjectId=()=>"demo-kyrub-order-release"; export const adminAuth={verifyIdToken:async()=>{throw Error("AUTH_NOT_ALLOWED_IN_ORDER_RELEASE_FIXTURE");}};',loader:'js'}));
    const boundaries:Record<string,string>={
      'consultantAuth.js':'export const verifyFirebaseIdToken=async()=>({uid:"buyer"});',
      'mercadoPagoStoreOauthService.js':'export const getValidMercadoPagoStoreAccessToken=async(id)=>{if(id!=="seller")throw Error("WRONG_MERCHANT");return {externalAccountId:"collector"};}; export const mercadoPagoStoreRequest=async(id,path)=>{if(id!=="seller"||path!=="/v1/payments/psp-joined-commercial")throw Error("UNEXPECTED_PROVIDER_REQUEST");return globalThis.__joinedDirectPixProviderEvidence;};',
      'mercadoPagoCheckoutBridge.js':'export const attachMercadoPagoPixToExistingIntent=async()=>{throw Error("PSP_NOT_ALLOWED_IN_TEST");};',
      'mercadoPagoWebhook.js':'export const mapMercadoPagoWebhookError=()=>({}); export const processMercadoPagoWebhook=async()=>{throw Error("PSP_NOT_ALLOWED_IN_TEST");};',
      'storePromotionService.js':'export const listPublicStorePromotions=async()=>[]; export const resolveStorePromotionForCheckout=async()=>{throw Error("COUPON_NOT_USED_IN_TEST");};',
    };
    plugin.onResolve({filter:/\.js$/},args=>{const name=args.path.split('/').at(-1)!;return boundaries[name]?{path:name,namespace:'test-boundary'}:undefined;});
    plugin.onLoad({filter:/.*/,namespace:'test-boundary'},args=>({contents:boundaries[args.path],loader:'js'}));
    plugin.onResolve({filter:/(^|\/)firebase(\.js)?$/},()=>({path:'client',namespace:'client-db'}));
    plugin.onLoad({filter:/.*/,namespace:'client-db'},()=>({contents:'export const db=null; export const auth={currentUser:null};',loader:'js'}));
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
test('human order status transaction rejects ineligible operators and on-demand delivery during standby',async()=>{
  const actor={uid:'seller',permission:'orders.transfer'};
  const control=db.doc('erp_age_release_private/current');
  const age=db.doc('age_eligibility_private/seller');
  await control.set({schemaVersion:1,mode:'verified_adult_only'});
  await assert.rejects(service.transitionOrderStatusWithInventory('seller','order','accepted',{},actor),/STORE_ERP_AGE_REQUIRED/);
  await age.set({uid:'other',status:'verified_adult'});
  await assert.rejects(service.transitionOrderStatusWithInventory('seller','order','accepted',{},actor),/STORE_ERP_AGE_REQUIRED/);
  assert.equal((await read()).status,'pending');
  await age.set({uid:'seller',status:'verified_adult'});
  await db.doc(path).update({fulfillmentType:'delivery'});
  await assert.rejects(service.transitionOrderStatusWithInventory('seller','order','accepted',{deliveryProvider:'kyrub'},actor),/DELIVERY_V1_STANDBY/);
  assert.equal((await read()).status,'pending');
  await service.transitionOrderStatusWithInventory('seller','order','accepted',{deliveryProvider:'merchant'},actor);
  assert.equal((await read()).deliveryProvider,'merchant');
  assert.equal((await read()).status,'accepted');
  const chosenAt=(await read()).deliveryProviderChosenAt;
  await service.transitionOrderStatusWithInventory('seller','order','accepted',{deliveryProvider:'merchant'},actor);
  assert.equal((await read()).deliveryProviderChosenAt,chosenAt);
  await age.update({status:'suspended'});
  await assert.rejects(service.transitionOrderStatusWithInventory('seller','order','cancelled',{reason:'Teste'},{uid:'seller',permission:'orders.cancel'}),/STORE_ERP_AGE_REQUIRED/);
  assert.equal((await read()).status,'accepted');
  // Verified provider evidence is independent of the operator's age gate.
  await service.processVerifiedPaymentWebhook({storeId:'seller',paymentId:'payment',event:paidEvent});
  assert.equal((await db.doc(paymentPath).get()).get('status'),'paid');
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
const checkoutBody={storeId:'seller',buyerName:'Cliente',buyerEmail:'buyer@example.test',fulfillmentType:'pickup',
  method:'pix',items:[{productId:'product',quantity:1}],idempotencyKey:'pending-projection-test'};
const mappedStore=async()=>{
  await db.doc('tenants/seller').set({canonicalStoreId:'canonical',publicationStatus:'published',publicProducts:[{id:'product',name:'Produto',price:20}]});
  await db.doc('stores/canonical/members/seller').set({userId:'seller',role:'owner',status:'active'});
};
test('official checkout creates both pending projections; retry repairs mirror and preserves approval through KDS',async()=>{
  await mappedStore();
  const checkout=()=>service.createMarketplacePaymentIntent('Bearer isolated-test',checkoutBody);
  const result=await checkout();
  assert.equal(result.status,201);
  assert.equal(result.body.providerReady,false);
  const {orderId,paymentIntentId,paymentId}=result.body;
  const legacy=db.doc(`artifacts/seller/public/data/customerOrders/${orderId}`);
  const mirror=db.doc(`stores/canonical/orders/${orderId}`);
  const pending=(await legacy.get()).data()!;
  const canonical=(await mirror.get()).data()!;
  assert.equal(canonical.status,'pending');
  assert.equal(canonical.paymentStatus,'unpaid');
  assert.equal(canonical.paymentIntentId,paymentIntentId);
  assert.equal(canonical.paymentId,paymentId);
  assert.equal(canonical.legacyStoreId,'seller');
  assert.equal(canonical.createdByUserId,'buyer');
  assert.equal(canonical.checkoutAuthority,'merchant_approval_required');
  assert.equal(service.customerOrdersEquivalent(service.parseCustomerOrder(pending),
    service.parseCustomerOrder({...canonical,storeId:'seller'})),true);
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder(pending)),false);
  assert.equal((await checkout()).body.duplicate,true);
  assert.deepEqual((await mirror.get()).data(),canonical);
  await mirror.delete(); // Only this newly-created emulator fixture.
  assert.equal((await checkout()).body.duplicate,true);
  assert.equal((await mirror.get()).get('status'),'pending');
  await service.transitionOrderStatusWithInventory('seller',orderId,'accepted');
  assert.equal((await checkout()).body.duplicate,true);
  assert.equal((await legacy.get()).get('status'),'accepted');
  assert.equal((await mirror.get()).get('status'),'accepted');
  const provider=db.batch();
  provider.update(db.doc(`stores/seller/payments/${paymentId}`),{provider:'mercado-pago',providerPaymentId:'psp'});
  provider.update(db.doc(`stores/seller/paymentIntents/${paymentIntentId}`),{provider:'mercado-pago',providerIntentId:'psp'});
  await provider.commit();
  await service.processVerifiedPaymentWebhook({storeId:'seller',paymentId,event:{...paidEvent,paymentIntentId}});
  await service.settleMarketplaceOperationalOrderAfterPayment({storeId:'seller',orderId,paymentIntentId,occurredAt:now});
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await legacy.get()).data())),true);
  await service.transitionOrderStatusWithInventory('seller',orderId,'preparing');
  assert.equal((await mirror.get()).get('status'),'preparing');
});
test('checkout fails atomically for cross-store mapping without creating financial documents',async()=>{
  await mappedStore();
  await db.doc('stores/canonical').update({ownerId:'other'});
  await assert.rejects(service.createMarketplacePaymentIntent('Bearer isolated-test',checkoutBody),/STORE_MISMATCH/);
  assert.equal((await db.collection('stores/seller/paymentIntents').get()).size,1); // Existing baseline fixture only.
  assert.equal((await db.collection('stores/canonical/orders').get()).empty,true);
});


const verifiedFirstStoreFixture = async()=>{
  await db.doc('users/seller/stores/seller').set({
    id: 'seller', ownerId: 'seller', canonicalStoreId: 'store-first',
  });
  await db.doc('stores/store-first').set({
    id: 'store-first', ownerId: 'seller', legacyTenantId: 'seller',
    firstStoreCreationVerified: true, publicationStatus: 'published',
  });
  await db.doc('marketplace_listings/s_6_seller').set({
    listingType: 'store', storeId: 'seller', ownerId: 'seller',
    publicationStatus: 'published',
  });
  await db.doc('stores/store-first/products/product').set({
    id: 'product', storeId: 'store-first', name: 'Produto',
    category: 'Produtos', price: 20, stock: 10,
    publicationStatus: 'published', isService: false,
  });
};
test('verified first store without tenant mapping mirrors pending, approved and cancelled orders to ERP',async()=>{
  await verifiedFirstStoreFixture();
  const request={...checkoutBody,idempotencyKey:'first-store-cancel'};
  const created=await service.createMarketplacePaymentIntent('Bearer isolated-test',request);
  assert.equal(created.status,201);
  const orderId=created.body.orderId;
  const mirror=db.doc(`stores/store-first/orders/${orderId}`);
  assert.equal((await mirror.get()).get('status'),'pending');
  assert.equal((await mirror.get()).get('checkoutAuthority'),'merchant_approval_required');
  assert.equal((await mirror.get()).get('legacyStoreId'),'seller');
  const retry=await service.createMarketplacePaymentIntent('Bearer isolated-test',request);
  assert.equal(retry.body.duplicate,true);
  await service.transitionOrderStatusWithInventory('seller',orderId,'accepted');
  assert.equal((await mirror.get()).get('status'),'accepted');
  assert.equal((await mirror.get()).get('paymentStatus'),'unpaid');
  await service.transitionOrderStatusWithInventory('seller',orderId,'cancelled',{reason:'Comprador desistiu'});
  assert.equal((await mirror.get()).get('status'),'cancelled');
  assert.equal((await mirror.get()).get('paymentStatus'),'unpaid');
});
test('verified first-store paid order stays mirrored and only enters production after confirmed payment',async()=>{
  await verifiedFirstStoreFixture();
  const request={...checkoutBody,idempotencyKey:'first-store-paid'};
  const created=await service.createMarketplacePaymentIntent('Bearer isolated-test',request);
  assert.equal(created.status,201);
  const {orderId,paymentId,paymentIntentId}=created.body;
  const mirror=db.doc(`stores/store-first/orders/${orderId}`);
  await service.transitionOrderStatusWithInventory('seller',orderId,'accepted');
  await assert.rejects(service.transitionOrderStatusWithInventory('seller',orderId,'preparing'),
    /liberação financeira/);
  const provider=db.batch();
  provider.update(db.doc(`stores/seller/payments/${paymentId}`),
    {provider:'mercado-pago',providerPaymentId:'psp-first'});
  provider.update(db.doc(`stores/seller/paymentIntents/${paymentIntentId}`),
    {provider:'mercado-pago',providerIntentId:'psp-first'});
  await provider.commit();
  await service.processVerifiedPaymentWebhook({
    storeId:'seller',paymentId,
    event:{...paidEvent,eventId:'first-paid-event',providerPaymentId:'psp-first',paymentIntentId},
  });
  await service.settleMarketplaceOperationalOrderAfterPayment({
    storeId:'seller',orderId,paymentIntentId,occurredAt:now,
  });
  assert.equal((await mirror.get()).get('paymentStatus'),'paid');
  assert.equal((await mirror.get()).get('status'),'accepted');
  await service.transitionOrderStatusWithInventory('seller',orderId,'preparing');
  assert.equal((await mirror.get()).get('status'),'preparing');
  assert.equal((await mirror.get()).get('paymentStatus'),'paid');
});
test('cross-owner first-store mapping fails checkout atomically without mirroring financial data',async()=>{
  await verifiedFirstStoreFixture();
  await db.doc('stores/store-first').update({ownerId:'someone-else'});
  await assert.rejects(
    service.createMarketplacePaymentIntent('Bearer isolated-test',
      {...checkoutBody,idempotencyKey:'first-store-identity-conflict'}),
    /STORE_IDENTITY_CONFLICT|STORE_MISMATCH/
  );
  assert.equal((await db.collection('stores/store-first/orders').get()).empty,true);
});


test('cross-domain retail: approved Pix leads to one KDS release, one stock deduction and exact restoration on cancellation',async()=>{
  await mappedStore();
  await db.doc('users/seller/private_store/inventory').set({
    ownerId:'seller',
    catalog:[{id:'flour',name:'Farinha',unit:'g',currentQuantity:1000,minimumQuantity:100,
      purchaseCost:0.02,supplier:'',updatedAt:now}],
    compositions:{product:{kind:'recipe',yieldQuantity:1,
      lines:[{inventoryItemId:'flour',quantity:125}],updatedAt:now}},
    consumptionTrigger:'preparing',
  });
  const created=await service.createMarketplacePaymentIntent('Bearer isolated-test',{
    ...checkoutBody,idempotencyKey:'retail-inventory-refund-chain',
  });
  assert.equal(created.status,201);
  const {orderId,paymentId,paymentIntentId}=created.body;
  const orderRef=db.doc('artifacts/seller/public/data/customerOrders/'+orderId);
  const mirrorRef=db.doc('stores/canonical/orders/'+orderId);
  const inventoryRef=db.doc('users/seller/private_store/inventory');
  await service.transitionOrderStatusWithInventory('seller',orderId,'accepted');
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await orderRef.get()).data())),false);
  await assert.rejects(service.transitionOrderStatusWithInventory('seller',orderId,'preparing'),/liberação financeira/);
  const provider=db.batch();
  provider.update(db.doc('stores/seller/payments/'+paymentId),{provider:'mercado-pago',providerPaymentId:'psp-retail-stock'});
  provider.update(db.doc('stores/seller/paymentIntents/'+paymentIntentId),{provider:'mercado-pago',providerIntentId:'psp-retail-stock'});
  await provider.commit();
  const verified={...paidEvent,paymentIntentId,providerPaymentId:'psp-retail-stock',eventId:'verified-stock'};
  const outcomes=await Promise.all([0,1,2].map(()=>service.processVerifiedPaymentWebhook({
    storeId:'seller',paymentId,event:verified,
  })));
  assert.equal(outcomes.filter(item=>!item.duplicate).length,1);
  await service.settleMarketplaceOperationalOrderAfterPayment({storeId:'seller',orderId,paymentIntentId,occurredAt:now});
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await orderRef.get()).data())),true);
  assert.equal((await mirrorRef.get()).get('paymentStatus'),'paid');
  const preparing=await service.transitionOrderStatusWithInventory('seller',orderId,'preparing');
  assert.equal(preparing.inventoryAction,'consumed');
  assert.equal((await inventoryRef.get()).data()?.catalog?.[0]?.currentQuantity,875);
  const retry=await service.transitionOrderStatusWithInventory('seller',orderId,'preparing');
  assert.equal(retry.inventoryAction,'duplicate');
  assert.equal((await inventoryRef.get()).data()?.catalog?.[0]?.currentQuantity,875);
  const cancelled=await service.transitionOrderStatusWithInventory('seller',orderId,'cancelled',{
    reason:'Cancelamento pelo lojista após preparo no emulador',
  });
  assert.equal(cancelled.inventoryAction,'restored');
  assert.equal((await inventoryRef.get()).data()?.catalog?.[0]?.currentQuantity,1000);
  assert.equal((await mirrorRef.get()).get('status'),'cancelled');
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await orderRef.get()).data())),false);
  assert.equal((await db.collection('stores/seller/paymentRefunds').get()).empty,true,
    'inventory cancellation must never issue an automatic financial refund');
});

test('cross-domain retail: paid pending order partial cancellation blocks full refund before provider access',async()=>{
  await mappedStore();
  const created=await service.createMarketplacePaymentIntent('Bearer isolated-test',{
    ...checkoutBody,
    items:[{productId:'product',quantity:2}],
    idempotencyKey:'retail-paid-partial-full-refund-conflict',
  });
  assert.equal(created.status,201);
  const {orderId,paymentId,paymentIntentId}=created.body;
  const orderRef=db.doc('artifacts/seller/public/data/customerOrders/'+orderId);
  const paidOrder=(await orderRef.get()).data()!;
  assert.equal(paidOrder.status,'pending');
  assert.equal(paidOrder.total,40);
  const provider=db.batch();
  provider.update(db.doc('stores/seller/payments/'+paymentId),{provider:'mercado-pago',providerPaymentId:'psp-retail-partial'});
  provider.update(db.doc('stores/seller/paymentIntents/'+paymentIntentId),{provider:'mercado-pago',providerIntentId:'psp-retail-partial'});
  await provider.commit();
  // A verified payment may arrive out of order. It does not authorize KDS without seller acceptance.
  await service.processVerifiedPaymentWebhook({storeId:'seller',paymentId,event:{
    ...paidEvent,paymentIntentId,providerPaymentId:'psp-retail-partial',amount:40,eventId:'paid-before-merchant-acceptance',
  }});
  await service.settleMarketplaceOperationalOrderAfterPayment({storeId:'seller',orderId,paymentIntentId,occurredAt:now});
  assert.equal((await orderRef.get()).get('status'),'pending');
  assert.equal((await orderRef.get()).get('paymentStatus'),'paid');
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await orderRef.get()).data())),false);

  const oldFetch=globalThis.fetch;
  let externalCalls=0;
  globalThis.fetch=async (input:any,init?:any)=>{
    const url=String(input);
    if(/^https?:\/\//.test(url)&&!/^http:\/\/127\.0\.0\.1:8088\//.test(url)){
      externalCalls+=1;
      throw new Error('PSP_NETWORK_PROHIBITED_IN_EMULATOR');
    }
    return oldFetch(input,init);
  };
  try{
    const cancellation={storeId:'seller',orderId,operationId:'retail_partial_operation_01',
      reason:'Item indisponível em checkout já pago',selections:[{lineId:paidOrder.items[0].lineId,quantity:1}]};
    const partial=await service.cancelOrderItemsWithRefund(cancellation);
    assert.equal(partial.refundRequired,true);
    assert.equal(partial.cancelledAmount,20);
    assert.ok(['required','failed','processing'].includes(partial.refundStatus));
    const marker=db.doc('stores/seller/paymentPartialRefunds/retail_partial_operation_01');
    assert.equal((await marker.get()).get('orderId'),orderId);
    assert.equal((await service.cancelOrderItemsWithRefund(cancellation)).duplicate,true);
    assert.equal((await db.collection('stores/seller/paymentPartialRefunds').where('orderId','==',orderId).get()).size,1);
    await service.transitionOrderStatusWithInventory('seller',orderId,'cancelled',{
      reason:'Pedido encerrado após cancelamento parcial pendente',
    });
    await assert.rejects(service.requestCanonicalOrderRefund({
      storeId:'seller',orderId,reason:'Reembolso integral deve recusar parcial incerto',
    }),/PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED|PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/);
    assert.equal((await db.collection('stores/seller/paymentRefunds').get()).empty,true,
      'full refund must stop before creating any provider request');
    assert.equal((await db.doc('stores/seller/payments/'+paymentId).get()).get('status'),'paid');
    assert.ok(externalCalls<=1,'any partial provider attempt was intercepted, never sent');
  } finally{
    globalThis.fetch=oldFetch;
  }
});

test('commercial candidate: actual Free provisioning and first publication join checkout, KDS, stock and internal payment records',async()=>{
  // Actual server provisioning with the existing isolated identity/PSP fixture.
  // Product configuration and owner membership are test fixtures, not UI proof.
  const {publishFirstStoreAndAwardXp}=await import('../server/gamification/firstStorePublicationAuthority.js');
  const {loadOfficialPlanPixFixture}=await import('./helpers/officialPlanPixFixture.js');
  await db.doc('stores/canonical').delete(); // Baseline fixture in the dedicated emulator only.
  assert.equal((await db.doc('users/seller/stores/seller').get()).exists,false);
  const originalToken=process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN;
  const originalSecret=process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET;
  const globalState=globalThis as any;
  const originalFixture=globalState.__officialPix;
  let fixture:Awaited<ReturnType<typeof loadOfficialPlanPixFixture>>|undefined;
  let canonicalStoreId:string;
  try{
    globalState.__officialPix={db,auth:async()=>({uid:'seller',email:'seller@example.invalid',emailVerified:true}),request:async()=>{throw Error('PSP_NOT_ALLOWED_IN_TEST');}};
    fixture=await loadOfficialPlanPixFixture();
    const ageControl=db.doc('erp_age_release_private/current');
    const ageRecord=db.doc('age_eligibility_private/seller');
    await ageControl.set({schemaVersion:1,mode:'verified_adult_only'});
    try{
      await assert.rejects(fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller'),/FREE_STORE_AGE_REQUIRED/);
      for(const status of ['pending','declared_adult','declared_underage','verified_underage','inconclusive','suspended']){
        await ageRecord.set({uid:'seller',status});
        await assert.rejects(fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller'),/FREE_STORE_AGE_REQUIRED/);
      }
      await ageRecord.set({uid:'different-user',status:'verified_adult'});
      await assert.rejects(fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller'),/FREE_STORE_AGE_REQUIRED/);
      assert.equal((await db.doc('users/seller/stores/seller').get()).exists,false);
      assert.equal((await db.collection('stores').where('ownerId','==','seller').get()).size,0);
      assert.equal((await db.doc('users/seller/verifiedStoreEvents/first_store_created').get()).exists,false);
      await ageRecord.set({uid:'seller',status:'verified_adult'});
    const initial=await fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller');
    const retry=await fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller');
    assert.equal(initial.created,true);
    assert.equal(initial.plan,'free');
    assert.equal(retry.created,false);
    assert.equal(retry.canonicalStoreId,initial.canonicalStoreId);
    canonicalStoreId=initial.canonicalStoreId;
      await ageRecord.update({status:'suspended'});
      await assert.rejects(fixture.ensureFreePlanForStoreCreation('Bearer isolated-seller'),/FREE_STORE_AGE_REQUIRED/);
      assert.equal((await db.doc('stores/'+canonicalStoreId).get()).get('plan'),'free');
    }finally{
      await Promise.all([ageControl.delete(),ageRecord.delete()]);
    }
  }finally{
    fixture?.restoreFixture();
    globalState.__officialPix=originalFixture;
    if(originalToken===undefined)delete process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN;else process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN=originalToken;
    if(originalSecret===undefined)delete process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET;else process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET=originalSecret;
  }
  const storeRef=db.doc('stores/'+canonicalStoreId);
  assert.equal((await storeRef.get()).get('publicationStatus'),'paused');
  assert.equal((await storeRef.get()).get('firstStoreCreationVerified'),true);
  assert.equal((await db.doc('users/seller/verifiedStoreEvents/first_store_created').get()).get('storeId'),canonicalStoreId);
  assert.equal((await db.collection('users/seller/xpLedger').get()).size,0);
  await storeRef.collection('products').doc('product').set({id:'product',storeId:canonicalStoreId,name:'Produto',category:'Produtos',price:20,stock:10,publicationStatus:'published',isService:false});
  await db.doc('users/seller/stores/seller').update({name:'Loja de homologação',slug:'loja-homologacao',plan:'free'});
  await db.doc('global_challenges/first_store_published').set({
    id:'first_store_published',title:'Primeira publicação',description:'Publique a loja',
    status:'published',validationMode:'deterministic',sponsorType:'kyrub',
    rewardKCoins:0,rewardXp:2,maxCompletionsPerUser:1,
  });
  const inventoryRef=db.doc('users/seller/private_store/inventory');
  await inventoryRef.set({
    ownerId:'seller',catalog:[{id:'flour',name:'Farinha',unit:'g',currentQuantity:1000,minimumQuantity:100,purchaseCost:0.02,supplier:'',updatedAt:now}],
    compositions:{product:{kind:'recipe',yieldQuantity:1,lines:[{inventoryItemId:'flour',quantity:125}],updatedAt:now}},
    consumptionTrigger:'preparing',
  });
  await storeRef.collection('members').doc('seller').set({userId:'seller',role:'owner',status:'active'});
  await db.doc('tenants/seller').set({id:'seller',ownerId:'seller',canonicalStoreId,publicationStatus:'paused'});
  await assert.rejects(service.createMarketplacePaymentIntent('Bearer isolated-test',{...checkoutBody,idempotencyKey:'joined-before-publication'}),/CHECKOUT_STORE_NOT_AVAILABLE/);
  const published=await publishFirstStoreAndAwardXp(db,{authenticatedUserId:'seller',canonicalStoreId});
  assert.deepEqual(published,{replay:false,pitangas:0,xp:2});
  assert.equal((await storeRef.get()).get('plan'),'free');
  const input={...checkoutBody,idempotencyKey:'joined-commercial-order'};
  const created=await service.createMarketplacePaymentIntent('Bearer isolated-test',input);
  assert.equal(created.status,201);
  assert.equal(created.body.providerReady,false);
  const {orderId,paymentId,paymentIntentId}=created.body;
  const orderRef=db.doc('artifacts/seller/public/data/customerOrders/'+orderId);
  const mirrorRef=storeRef.collection('orders').doc(orderId);
  const paymentRef=db.doc('stores/seller/payments/'+paymentId);
  const intentRef=db.doc('stores/seller/paymentIntents/'+paymentIntentId);
  assert.equal((await mirrorRef.get()).get('status'),'pending');
  assert.equal((await mirrorRef.get()).get('paymentStatus'),'unpaid');
  await service.transitionOrderStatusWithInventory('seller',orderId,'accepted');
  await assert.rejects(service.transitionOrderStatusWithInventory('seller',orderId,'preparing'),/liberação financeira/);
  const batch=db.batch();
  batch.update(paymentRef,{provider:'mercado-pago',providerPaymentId:'psp-joined-commercial'});
  batch.update(intentRef,{provider:'mercado-pago',providerIntentId:'psp-joined-commercial'});
  await batch.commit();
  const evidence={...paidEvent,eventId:'joined-commercial-event',providerPaymentId:'psp-joined-commercial',paymentIntentId};
  const captures=await Promise.all([1,2].map(()=>service.processVerifiedPaymentWebhook({storeId:'seller',paymentId,event:evidence})));
  assert.equal(captures.filter(x=>!x.duplicate).length,1);
  await service.settleMarketplaceOperationalOrderAfterPayment({storeId:'seller',orderId,paymentIntentId,occurredAt:now});
  assert.equal(service.isOrderVisibleInKds(service.parseCustomerOrder((await orderRef.get()).data())),true);
  const movement=await service.transitionOrderStatusWithInventory('seller',orderId,'preparing');
  assert.equal(movement.inventoryAction,'consumed');
  assert.equal((await inventoryRef.get()).get('catalog')[0].currentQuantity,875);
  assert.equal((await service.transitionOrderStatusWithInventory('seller',orderId,'preparing')).inventoryAction,'duplicate');
  const [order,mirror,payment,intent]=await Promise.all([orderRef.get(),mirrorRef.get(),paymentRef.get(),intentRef.get()]);
  assert.equal(order.get('total'),20);
  assert.equal(mirror.get('paymentStatus'),'paid');
  assert.equal(mirror.get('status'),'preparing');
  assert.equal(mirror.get('paymentId'),paymentId);
  assert.equal(payment.get('amount'),order.get('total'));
  assert.equal(payment.get('status'),'paid');
  assert.equal(intent.get('amount'),order.get('total'));
  assert.equal(intent.get('status'),'paid');
  // Actual webhook ledger and provider reconciliation, with no real PSP call
  // and no handoff, split, transfer or courier payout prerequisite.
  const ledger=await service.listStoreEconomicLedgerEntries({storeId:'seller',limit:100});
  const matched=ledger.filter((entry:any)=>entry.paymentId===paymentId&&entry.kind==='payment_capture');
  assert.equal(matched.length,1);
  assert.equal(matched[0].orderId,orderId);
  assert.equal(matched[0].amountMinor,2000);
  const obligations=await db.collection('stores/seller/economicObligations').where('orderId','==',orderId).get();
  assert.equal(obligations.size,1);
  assert.equal(obligations.docs[0].get('sourceEconomicEntryId'),matched[0].id);
  assert.equal(obligations.docs[0].get('amountMinor'),2000);
  await service.saveMercadoPagoPaymentProviderBinding({provider:'mercado-pago',providerPaymentId:'psp-joined-commercial',canonicalStoreId:'seller',legacyStoreId:'seller',paymentId,paymentIntentId,recipientAccountId:'collector'});
  const providerEvidence={id:'psp-joined-commercial',collector_id:'collector',status:'approved',currency_id:'BRL',transaction_amount:20,transaction_amount_refunded:0,payment_method_id:'pix',fee_details:[{type:'mercadopago_fee',fee_payer:'collector',amount:0.2}],transaction_details:{net_received_amount:19.8,total_paid_amount:20},money_release_status:'released',money_release_date:now,date_last_updated:now};
  const globalStateForProvider=globalThis as any;
  const previousEvidence=globalStateForProvider.__joinedDirectPixProviderEvidence;
  const reconciliationRef=db.doc(service.storeProviderPaymentReconciliationPath('seller','mercado-pago','psp-joined-commercial'));
  try{
    for(const collector_id of ['', 'other-merchant']){
      globalStateForProvider.__joinedDirectPixProviderEvidence={...providerEvidence,collector_id};
      await assert.rejects(service.reconcileMercadoPagoPayment('seller',paymentId),/STORE_PROVIDER_RECONCILIATION_ACCOUNT_MISMATCH/);
      assert.equal((await reconciliationRef.get()).exists,false);
    }
    globalStateForProvider.__joinedDirectPixProviderEvidence=providerEvidence;
    const reconciled=await Promise.all([1,2].map(()=>service.reconcileMercadoPagoPayment('seller',paymentId)));
    assert.deepEqual(reconciled[0],reconciled[1]);
    assert.equal(reconciled[0].grossMinor,matched[0].amountMinor);
    assert.equal(reconciled[0].providerFeeMinor,20);
    assert.equal(reconciled[0].netReceivedMinor,1980);
    assert.equal(reconciled[0].refundedMinor,0);
    assert.equal((await reconciliationRef.collection('observations').get()).size,1);
    // Human authorization is checked again at persistence, including
    // when an otherwise idempotent provider observation already exists.
    await assert.rejects(service.reconcileMercadoPagoPayment('seller',paymentId,{ownerId:'other',authorization:'Bearer synthetic'}),/STORE_REPRESENTATION_FORBIDDEN/);
    const financialControl=db.doc('financial_mfa_release_private/current');
    await financialControl.set({schemaVersion:1,mode:'recent_totp_required'});
    try{
      // Fixture intentionally denies all token verification, so this cannot
      // serve as positive MFA evidence.
      await assert.rejects(service.reconcileMercadoPagoPayment('seller',paymentId,{ownerId:'seller',authorization:'Bearer synthetic'}),/AUTH_NOT_ALLOWED_IN_ORDER_RELEASE_FIXTURE/);
      assert.equal((await reconciliationRef.collection('observations').get()).size,1);
    }finally{await financialControl.delete();}
    globalStateForProvider.__joinedDirectPixProviderEvidence={...providerEvidence,date_last_updated:'2026-11-05T12:00:00.000Z',money_release_status:'pending'};
    const retained=await service.reconcileMercadoPagoPayment('seller',paymentId);
    assert.deepEqual(retained,reconciled[0]);
    assert.equal((await reconciliationRef.get()).get('moneyReleaseStatus'),'released');
    assert.equal((await reconciliationRef.collection('observations').get()).size,2);
    // Recovery must not downgrade a provider-backed capture.
    const recovered=await Promise.all([1,2].map(()=>service.recoverMissingCanonicalPaidCaptures('seller','Bearer synthetic','seller')));
    assert.ok(recovered.every(n=>n===0));
    const afterRecovery=await service.listStoreEconomicLedgerEntries({storeId:'seller',limit:100});
    assert.deepEqual(afterRecovery.find((entry:any)=>entry.id===matched[0].id),matched[0]);
    assert.equal((await orderRef.get()).get('status'),'preparing');
    assert.equal((await db.collection('stores/seller/economicSettlements').get()).size,0);
  }finally{globalStateForProvider.__joinedDirectPixProviderEvidence=previousEvidence;}
  assert.equal((await db.collection('users/seller/xpLedger').get()).size,1);
  assert.equal((await db.collection('users/seller/rewardLedger').get()).size,0);
  assert.equal((await inventoryRef.get()).get('catalog')[0].currentQuantity,875);
});
