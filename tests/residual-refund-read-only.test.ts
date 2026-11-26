import assert from 'node:assert/strict';
import test from 'node:test';
import {observeResidualRefund} from '../shared/residualRefundReadOnly';
import {parseProviderRefundListing} from '../shared/mercadoPagoRefundReadOnly';
const provider={id:'refund1',payment_id:'mp1',amount:30,status:'approved'};
const local={storeId:'seller',orderId:'order',paymentId:'payment',providerPaymentId:'mp1',providerRefundId:'refund1',status:'refunded',amount:30};
const input={paymentId:'payment',providerPaymentId:'mp1',storeId:'seller',orderId:'order',originalAmountMinor:10000,storedAmountMinor:10000,reportedRefundedMinor:3000,currency:'BRL',paymentStatus:'approved',providerListing:[provider],localAttempts:[local],historyComplete:true};
test('residual is original paid amount minus independently matched refunds, without authority to execute',()=>{
 assert.deepEqual(observeResidualRefund(input),{state:'matched',remainingMinor:7000,reason:'point_in_time_only',executionEnabled:false});
 assert.equal(observeResidualRefund({...input,providerListing:[],localAttempts:[],reportedRefundedMinor:0}).remainingMinor,10000);
 assert.equal(observeResidualRefund({...input,paymentStatus:'refunded',reportedRefundedMinor:10000,providerListing:[{...provider,amount:100}],localAttempts:[{...local,amount:100}]}).remainingMinor,0);
});
test('uncertain, mismatched, duplicate, truncated or overpaid histories fail closed',()=>{
 for(const changed of [
  {reportedRefundedMinor:null},{reportedRefundedMinor:2999},{historyComplete:false},{currency:'USD'},
  {storedAmountMinor:10001},{paymentStatus:'refunded'},
  {providerListing:[provider,provider]},{providerListing:[{...provider,amount:101}]},
  {providerListing:[{...provider,status:'pending'}]},{providerListing:[{...provider,payment_id:'other'}]},
  {providerListing:{results:[provider]}},{localAttempts:[]},{localAttempts:[local,local]},
  {localAttempts:[{...local,status:'failed'}]},{localAttempts:[{...local,paymentId:'other'}]},
  {localAttempts:[{...local,providerRefundId:'different'}]},{localAttempts:[{...local,amount:30.001}]},
 ]){
  const result=observeResidualRefund({...input,...changed});
  assert.equal(result.state,'review_required',JSON.stringify(changed));
  assert.equal(result.remainingMinor,null);
  assert.equal(result.executionEnabled,false);
 }
 assert.throws(()=>parseProviderRefundListing([provider,provider],'mp1',10000),/DUPLICATE_ID/);
});
