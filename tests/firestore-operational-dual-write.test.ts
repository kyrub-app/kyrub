import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const STORE_ID = 'store-independent-a';
const LEGACY_STORE_ID = 'owner-a';
let environment: RulesTestEnvironment;

const storeRecord = () => ({
  id: STORE_ID,
  ownerId: 'owner-a',
  name: 'Loja A',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId: LEGACY_STORE_ID,
  migrationStatus: 'dual_write',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const migrationMetadata = () => ({
  mode: 'dual_write',
  migratedByUserId: 'owner-a',
  migratedByRole: 'owner',
});

const mirroredCustomerOrder = () => ({
  id: 'customer-order-a',
  storeId: STORE_ID,
  buyerId: 'buyer-a',
  buyerName: 'Cliente A',
  buyerEmail: 'buyer@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '12',
  customerNote: '',
  items: [
    {
      lineId: 'line-a',
      productId: 'product-a',
      name: 'Produto A',
      price: 20,
      quantity: 1,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    },
  ],
  subtotal: 20,
  total: 20,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  operatorId: '',
  operatorName: '',
  createdByUserId: 'buyer-a',
  createdByRole: 'customer',
  legacyStoreId: LEGACY_STORE_ID,
  legacyCreatedAt: '2026-07-22T10:00:00.000Z',
  legacyUpdatedAt: '2026-07-22T10:00:00.000Z',
  migratedFromPath:
    'artifacts/owner-a/public/data/customerOrders/customer-order-a',
  migration: migrationMetadata(),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'stores', STORE_ID), storeRecord());
  });
});

after(async () => {
  await environment.cleanup();
});

test('owner mirrors a legacy customer order while preserving the customer actor', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'orders', 'customer-order-a');

  await assertSucceeds(setDoc(reference, mirroredCustomerOrder()));
  await assertSucceeds(
    getDoc(doc(buyer, 'stores', STORE_ID, 'orders', 'customer-order-a'))
  );

  const snapshot = await getDoc(reference);
  assert.equal(snapshot.data()?.createdByUserId, 'buyer-a');
  assert.equal(snapshot.data()?.migration?.migratedByUserId, 'owner-a');
});

test('non-owner cannot impersonate the migration bridge', async () => {
  const stranger = environment.authenticatedContext('stranger-a').firestore();
  await assertFails(
    setDoc(
      doc(stranger, 'stores', STORE_ID, 'orders', 'customer-order-a'),
      mirroredCustomerOrder()
    )
  );
});

test('owner updates the canonical mirror without changing immutable migration identity', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const reference = doc(owner, 'stores', STORE_ID, 'orders', 'customer-order-a');
  await assertSucceeds(setDoc(reference, mirroredCustomerOrder()));

  await assertSucceeds(
    updateDoc(reference, {
      status: 'accepted',
      legacyUpdatedAt: '2026-07-22T10:05:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    updateDoc(reference, {
      legacyStoreId: 'another-store',
      updatedAt: serverTimestamp(),
    })
  );
});

test('owner mirrors a legacy table payment and outsiders remain blocked', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const stranger = environment.authenticatedContext('stranger-a').firestore();
  const payment = {
    id: 'payment-a',
    storeId: STORE_ID,
    legacyStoreId: LEGACY_STORE_ID,
    tableCode: '12',
    method: 'pix',
    amount: 20,
    quantity: 1,
    items: [
      {
        orderId: 'customer-order-a',
        lineId: 'line-a',
        productId: 'product-a',
        name: 'Produto A',
        quantity: 1,
        unitPrice: 20,
        total: 20,
      },
    ],
    actorUserId: 'owner-a',
    actorRole: 'owner',
    actorName: 'Proprietário',
    legacyCreatedAt: '2026-07-22T10:10:00.000Z',
    migratedFromPath:
      'artifacts/owner-a/public/data/tablePayments/payment-a',
    migration: migrationMetadata(),
    createdAt: serverTimestamp(),
  };

  await assertSucceeds(
    setDoc(doc(owner, 'stores', STORE_ID, 'payments', 'payment-a'), payment)
  );
  await assertFails(
    setDoc(
      doc(stranger, 'stores', STORE_ID, 'payments', 'payment-b'),
      { ...payment, id: 'payment-b' }
    )
  );
});


test('staged ERP eligibility protects order mirrors and staff status without blocking buyer cancellation',async()=>{
  const owner=environment.authenticatedContext('owner-a').firestore();
  const buyer=environment.authenticatedContext('buyer-a').firestore();
  const ref=doc(owner,'stores',STORE_ID,'orders','customer-order-a');
  const age=async(status:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private','owner-a'),{uid:'owner-a',status});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'erp_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  await assertFails(setDoc(ref,mirroredCustomerOrder()));
  await age('verified_adult');
  await assertSucceeds(setDoc(ref,mirroredCustomerOrder()));
  await age('suspended');
  await assertFails(updateDoc(ref,{status:'accepted',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{status:'accepted',legacyUpdatedAt:'2026-07-22T10:05:00.000Z',updatedAt:serverTimestamp()}));
  const buyerRef=doc(buyer,'stores',STORE_ID,'orders','customer-order-a');
  await assertSucceeds(getDoc(buyerRef));
  await assertSucceeds(updateDoc(buyerRef,{status:'cancelled',updatedAt:serverTimestamp()}));
});


test('legacy artifacts cannot bypass staged ERP age and financial MFA gates',async()=>{
  const owner=environment.authenticatedContext('owner-a').firestore();
  const buyer=environment.authenticatedContext('buyer-a').firestore();
  const ownerMfa=environment.authenticatedContext('owner-a',{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password',sign_in_second_factor:'totp'} as any}).firestore();
  const staleMfa=environment.authenticatedContext('owner-a',{auth_time:Math.floor(Date.now()/1000)-600,firebase:{sign_in_provider:'password',sign_in_second_factor:'totp'} as any}).firestore();
  const path='artifacts/owner-a/public/data';
  const orderPath=path+'/customerOrders/legacy-order';
  const secondPath=path+'/customerOrders/buyer-order';
  const paymentPath=path+'/tablePayments/legacy-payment';
  const order={buyerId:'buyer-a',storeId:'owner-a',fulfillmentType:'dine_in',source:'customer',status:'pending',paymentStatus:'unpaid'};
  const updateAge=async(uid:string,status:string)=>environment.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'age_eligibility_private',uid),{uid,status});
  });
  await environment.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),orderPath),order);
    await setDoc(doc(ctx.firestore(),'erp_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
    await setDoc(doc(ctx.firestore(),'financial_mfa_release_private','current'),{schemaVersion:1,mode:'recent_totp_required'});
  });
  await assertSucceeds(getDoc(doc(owner,orderPath)));
  await assertSucceeds(getDoc(doc(buyer,orderPath)));
  await assertFails(updateDoc(doc(owner,orderPath),{status:'accepted'}));
  await assertFails(setDoc(doc(buyer,secondPath),order));
  await updateAge('buyer-a','verified_adult');
  await assertSucceeds(setDoc(doc(buyer,secondPath),order));
  await updateAge('owner-a','verified_adult');
  await assertSucceeds(updateDoc(doc(owner,orderPath),{status:'accepted'}));
  await assertFails(updateDoc(doc(owner,orderPath),{paymentStatus:'paid'}));
  await assertFails(updateDoc(doc(owner,orderPath),{items:[{paidQuantity:1}]}));
  await assertFails(setDoc(doc(owner,paymentPath),{amount:20}));
  await assertFails(setDoc(doc(staleMfa,paymentPath),{amount:20}));
  await assertSucceeds(setDoc(doc(ownerMfa,paymentPath),{amount:20}));
  await assertSucceeds(updateDoc(doc(ownerMfa,orderPath),{paymentStatus:'paid'}));
  await assertFails(updateDoc(doc(ownerMfa,orderPath),{releaseMode:'pay_before_fulfillment'}));
  await assertFails(setDoc(doc(owner,path+'/unclassifiedLegacy/record'),{amount:20}));
  await updateAge('owner-a','suspended');
  await assertFails(updateDoc(doc(ownerMfa,paymentPath),{amount:40}));
  await updateAge('buyer-a','suspended');
  await assertSucceeds(updateDoc(doc(buyer,secondPath),{status:'cancelled',updatedAt:serverTimestamp()}));
});
