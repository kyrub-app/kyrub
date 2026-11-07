import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({stdin: {contents: `export {parseCustomerOrder,persistCustomerOrder} from './src/utils/customerOrders';
  export {mirrorLegacyOrderToCanonical} from './src/utils/operationalDualWrite';
  export {isOrderVisibleInKds} from './src/utils/orderWorkflow';`, resolveDir: process.cwd(), loader:'ts'},
  bundle:true, platform:'node', format:'cjs', packages:'external', write:false,
  plugins:[{name:'no-browser-session',setup(plugin){
    plugin.onResolve({filter: /(^|\/)firebase(\.js)?$/}, () => ({path:'firebase',namespace:'no-browser-session'}));
    plugin.onLoad({filter:/.*/,namespace:'no-browser-session'}, () => ({contents:'export const db = null; export const auth = {currentUser:null};',loader:'js'}));
  }}]});
const module = {exports: {} as any};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {parseCustomerOrder, persistCustomerOrder, mirrorLegacyOrderToCanonical, isOrderVisibleInKds} = module.exports;
const now = '2026-11-06T12:00:00.000Z';
const order = () => ({id:'order',storeId:'seller',buyerId:'buyer',buyerName:'Cliente',buyerEmail:'buyer@example.test',
  source:'customer',fulfillmentType:'pickup',status:'accepted',paymentStatus:'paid',subtotal:20,total:20,
  items:[{lineId:'line',productId:'product',name:'Produto',price:20,quantity:1,paidQuantity:0,transferredQuantity:0}],
  releaseMode:'pay_before_fulfillment',paymentIntentId:'intent',paymentId:'payment',createdAt:now,updatedAt:now,
  operationalRelease:{schemaVersion:1,orderId:'order',storeId:'seller',buyerId:'buyer',paymentIntentId:'intent',
    paymentId:'payment',providerPaymentId:'psp',paymentEventKey:'verified',recipientAccountId:'collector',amountMinor:2000,authorizedAt:now}});
test('prepaid browser persistence fails before touching the null Firestore instance',async()=>{
  await assert.rejects(persistCustomerOrder(order()),/PREPAID_ORDER_REQUIRES_SERVER_PERSISTENCE/);
  const markerOnly = {...order()} as any;
  delete markerOnly.releaseMode;
  await assert.rejects(persistCustomerOrder(markerOnly),/PREPAID_ORDER_REQUIRES_SERVER_PERSISTENCE/);
});
test('active browser mirror skips prepaid before migration checks or Firestore access',async()=>{
  assert.equal(await mirrorLegacyOrderToCanonical({uid:'seller'}, {}, order()),'unchanged');
});
test('server authorization survives customer order parsing and reaches the KDS visibility gate',()=>{
  const raw = order();
  const parsed = parseCustomerOrder(JSON.parse(JSON.stringify(raw)));
  assert.ok(parsed);
  assert.deepEqual(parsed.operationalRelease,raw.operationalRelease);
  assert.equal(parsed.releaseMode,'pay_before_fulfillment');
  assert.equal(isOrderVisibleInKds(parsed),true);
});
for (const status of ['pending','rejected','cancelled']) test(`KDS excludes ${status} despite a stale paid marker`,()=>{
  assert.equal(isOrderVisibleInKds(parseCustomerOrder({...order(),status})),false);
});
for (const patch of [{operationalRelease:null},{paymentStatus:'partial'},{paymentId:'other'}, {total:21}])
  test(`KDS excludes a request without matching authorization: ${JSON.stringify(patch)}`,()=>{
    assert.equal(isOrderVisibleInKds(parseCustomerOrder({...order(),...patch})),false);
  });
test('approved open dine-in tab and legacy partner order retain visibility',()=>{
  const raw = order() as any;
  delete raw.releaseMode; delete raw.operationalRelease;
  assert.equal(isOrderVisibleInKds(parseCustomerOrder({...raw,fulfillmentType:'dine_in',status:'pending',operatorId:'owner',paymentStatus:'unpaid'})),true);
  assert.equal(isOrderVisibleInKds(parseCustomerOrder({...raw,source:'staff',sourceChannel:'99food',paymentStatus:'unpaid'})),true);
});
