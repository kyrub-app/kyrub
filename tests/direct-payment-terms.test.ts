import assert from 'node:assert/strict';
import test from 'node:test';
import {createDirectPaymentTerms} from '../shared/directPaymentTerms.js';
test('launch terms default to payment on completion with zero platform commission',()=>{
 assert.deepEqual(createDirectPaymentTerms({method:'external_pix',amountMinor:15000}),{
  schemaVersion:1,timing:'on_completion',method:'external_pix',currency:'BRL',amountMinor:15000,platformCommissionMinor:0,providerFeeResponsibility:'financial_service_customer'
 });
 assert.equal(createDirectPaymentTerms({method:'mercado_pago',timing:'advance',amountMinor:15000}).timing,'advance');
});
test('client cannot supply commission, provider proof, split or change supported methods and timings',()=>{
 for(const input of [
  {method:'external_pix',amountMinor:100,platformCommissionMinor:1},
  {method:'external_pix',amountMinor:100,confirmed:true},
  {method:'split',amountMinor:100},
  {method:'mercado_pago',amountMinor:100,timing:'partial'},
  {method:'external_pix',amountMinor:0},
  {method:'external_pix',amountMinor:1.5},
  {method:'external_pix',amountMinor:'100'},
  {method:'external_pix',amountMinor:100,currency:'USD'},
 ]) assert.throws(()=>createDirectPaymentTerms(input),/DIRECT_PAYMENT_TERMS_INVALID/);
});
