import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {build} from 'esbuild';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
// CI uses a synthetic old permission contract; the real production snapshot
// stays local and can be supplied for an additional A/B run without publishing it.
const baselinePath=process.env.FIRESTORE_PRODUCTION_RULES_SNAPSHOT ?? 'tests/fixtures/firestore-legacy-order-contract.rules';
const baselineLabel=process.env.FIRESTORE_PRODUCTION_RULES_SNAPSHOT ? 'production' : 'legacy-model';
const legacy='artifacts/owner/public/data/customerOrders/order';
const canonical='stores/store/orders/order';
const base={id:'order',storeId:'owner',buyerId:'buyer',buyerName:'Cliente',buyerEmail:'buyer@example.test',
  source:'customer',fulfillmentType:'dine_in',status:'pending',paymentStatus:'unpaid',total:20,subtotal:20,
  items:[],createdByUserId:'buyer',createdByRole:'customer',createdAt:'2026-11-06',updatedAt:'2026-11-06'};
const meta={legacyStoreId:'owner',legacyCreatedAt:'2026-11-06',legacyUpdatedAt:'2026-11-06',
  migratedFromPath:legacy,migration:{mode:'dual_write',migratedByUserId:'owner',migratedByRole:'owner'}};
for(const [label,filename] of [[baselineLabel,baselinePath],['proposal','.firebase/firestore.combined.rules']])
 test(label,async t=>{
  const proposed=label==='proposal';
  const env=await initializeTestEnvironment({projectId:'kyrub-security-test',firestore:{host:'127.0.0.1',port:8088,rules:readFileSync(filename,'utf8')}});
  const owner=env.authenticatedContext('owner').firestore();
  (globalThis as any).__rulesReviewDb=owner;
  const bundle=await build({stdin:{contents: "export {mirrorLegacyOrderToCanonical} from './src/utils/operationalDualWrite'; export {persistCustomerOrder} from './src/utils/customerOrders';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,plugins:[{name:'review-db',setup(plugin){
    plugin.onResolve({filter:/(^|\/)firebase(\.js)?$/},()=>({path:'db',namespace:'review-db'}));
    plugin.onLoad({filter:/.*/,namespace:'review-db'},()=>({contents:'export const db=globalThis.__rulesReviewDb; export const auth={currentUser:null};',loader:'js'}));
    plugin.onResolve({filter:/^firebase\//},args=>({path:import.meta.resolve(args.path),external:true}));
  }}]});
  const {mirrorLegacyOrderToCanonical:mirror,persistCustomerOrder:persist}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=review-actual-mirror-'+label+'.js').toString('base64')}`);
  const buyer=env.authenticatedContext('buyer').firestore();
  const stranger=env.authenticatedContext('stranger').firestore();
  const seed=async(tagged=false)=>{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,'stores/store'),{id:'store',ownerId:'owner',legacyTenantId:'owner',publicationStatus:'paused'});
      const release=tagged?{releaseMode:'pay_before_fulfillment',operationalRelease:null,paymentIntentId:'intent',paymentId:'payment'}:{};
      await setDoc(doc(db,legacy),{...base,...release});
      await setDoc(doc(db,canonical),{...base,...meta,...release,storeId:'store',createdAt:Timestamp.fromMillis(1),updatedAt:Timestamp.fromMillis(1)});
    });
  };
  const decision=(operation,denied)=>denied?assertFails(operation):assertSucceeds(operation);
  try {
    await t.test('legitimate browser flow skips prepaid mirror under both rule versions',async()=>{
      await seed();
      const order={...base,id:'actual-mirror',fulfillmentType:'pickup',releaseMode:'pay_before_fulfillment',operationalRelease:null,paymentIntentId:'intent',paymentId:'payment'};
      const operation=mirror({uid:'owner'},{id:'store',ownerId:'owner',legacyTenantId:'owner'},order);
      assert.equal(await operation,'unchanged');
      assert.equal((await getDoc(doc(owner,'stores/store/orders/actual-mirror'))).exists(),false);
      await assert.rejects(persist(order),/PREPAID_ORDER_REQUIRES_SERVER_PERSISTENCE/);
    });
    await t.test('open tab owner item/financial updates preserved',async()=>{await seed();await assertSucceeds(updateDoc(doc(owner,legacy),{paymentStatus:'partial',customerNote:'Atendimento'}));});
    await t.test('99Food untagged owner status update preserved',async()=>{await seed();await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),legacy),{source:'staff',sourceChannel:'99food'}));await assertSucceeds(updateDoc(doc(owner,legacy),{status:'accepted'}));});
    await t.test('buyer reads own order; stranger cannot',async()=>{await seed();await assertSucceeds(getDoc(doc(buyer,legacy)));await assertFails(getDoc(doc(stranger,legacy)));});
    await t.test('owner cannot change prepaid release or financial binding under proposal',async()=>{await seed(true);await decision(updateDoc(doc(owner,legacy),{operationalRelease:{forged:true},paymentId:'other',paymentIntentId:'other'}),proposed);});
    await t.test('owner prepaid direct preparation denied by proposal',async()=>{await seed(true);await decision(updateDoc(doc(owner,legacy),{status:'preparing'}),proposed);});
    await t.test('legacy order history delete denied by proposal',async()=>{await seed();await decision(deleteDoc(doc(owner,legacy)),proposed);});
    await t.test('open-tab client canonical mirror remains writable',async()=>{await seed();await assertSucceeds(updateDoc(doc(owner,canonical),{customerNote:'Mesa',updatedAt:serverTimestamp()}));});
    await t.test('prepaid client canonical mirror update is rejected by proposal',async()=>{await seed(true);await decision(updateDoc(doc(owner,canonical),{customerNote:'Atualização do legado',updatedAt:serverTimestamp()}),proposed);});
    await t.test('prepaid client canonical mirror creation is rejected by proposal',async()=>{await seed();await decision(setDoc(doc(owner,'stores/store/orders/new'),{...base,...meta,id:'new',storeId:'store',releaseMode:'pay_before_fulfillment',operationalRelease:null,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}),proposed);});
    await t.test('buyer prepaid cancellation succeeds only in legacy path under proposal',async()=>{await seed(true);await assertSucceeds(updateDoc(doc(buyer,legacy),{status:'cancelled',updatedAt:'2026-11-07'}));await decision(updateDoc(doc(buyer,canonical),{status:'cancelled',updatedAt:serverTimestamp()}),proposed);});
    await t.test('financial legacy tablePayments remains owner-only',async()=>{await seed();const path='artifacts/owner/public/data/tablePayments/test';await assertSucceeds(setDoc(doc(owner,path),{amount:20,paymentId:'local',method:'cash'}));await assertSucceeds(getDoc(doc(owner,path)));await assertFails(getDoc(doc(stranger,path)));});
    await t.test('webhook receipts remain client-inaccessible',async()=>{await seed();await assertFails(setDoc(doc(owner,'paymentWebhookEvents/forged'),{eventType:'payment.paid'}));});
    await t.test('new savedItems/selection grant is scoped to owner',async()=>{await seed();for(const collection of ['savedItems','selections']){await decision(setDoc(doc(owner,`users/owner/${collection}/one`),{value:'one'}),!proposed);await assertFails(getDoc(doc(stranger,`users/owner/${collection}/one`)));}});
  } finally {await env.cleanup();}
 });
