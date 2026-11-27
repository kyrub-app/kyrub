import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDirectPaymentTerms} from '../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../shared/freelancePaymentObligation.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../shared/freelanceExternalPaymentStatements.js';
const obligation:FreelancePaymentObligation={schemaVersion:1,offerId:'offer',requesterUid:'payer',beneficiaryUid:'worker',terms:createDirectPaymentTerms({method:'external_pix',amountMinor:15000}),contractedAt:'2026-11-27T12:00:00Z',dueTrigger:'bilateral_service_completion',custody:'none'};
const event=(id:string,statement:ExternalPixStatement,actorUid:string,minute:number):ExternalPixEvent=>({id,statement,actorUid,recordedAt:'2026-11-27T12:'+String(minute).padStart(2,'0')+':00Z'});
test('financial disagreement is independent of statement order',()=>{
 assert.equal(projectExternalPixStatements(obligation,[]).state,'awaiting_payment');
 for(const first of ['paid','not_received'] as const){
  const second=first==='paid'?'not_received':'paid';
  const a=event('a',first,first==='paid'?'payer':'worker',1);
  const b=event('b',second,second==='paid'?'payer':'worker',2);
  assert.equal(projectExternalPixStatements(obligation,[a]).state,first==='paid'?'awaiting_receipt':'nonreceipt_reported');
  const conflict=appendExternalPixStatement(obligation,[a],b);
  assert.equal(conflict.state,'disputed');assert.equal(conflict.hadDisagreement,true);assert.equal(conflict.bankVerified,false);
  const resolved=appendExternalPixStatement(obligation,conflict.events,event('c','received','worker',3));
  assert.equal(resolved.state,'bilaterally_reported_received');assert.equal(resolved.hadDisagreement,true);
  assert.equal(resolved.bankVerified,false);assert.deepEqual(resolved.events.slice(0,2),[a,b]);
 }
});
test('receipt can precede payer declaration; roles, immutable IDs and replay protected',()=>{
 const received=event('r','received','worker',1),paid=event('p','paid','payer',2);
 assert.equal(projectExternalPixStatements(obligation,[received]).state,'receipt_reported');
 const both=appendExternalPixStatement(obligation,[received],paid);
 assert.equal(both.state,'bilaterally_reported_received');assert.equal(both.hadDisagreement,false);
 assert.equal(appendExternalPixStatement(obligation,both.events,{...paid,recordedAt:'2026-11-27T12:05:00Z'}).changed,false);
 for(const bad of [event('x','paid','worker',3),event('x','not_received','payer',3),event('x','received','other',3),event('x','not_received','worker',3),event('p','received','worker',3)])assert.throws(()=>appendExternalPixStatement(obligation,both.events,bad),/FREELANCE_PAYMENT_STATEMENT_CONFLICT/);
 assert.throws(()=>projectExternalPixStatements({...obligation,terms:{...obligation.terms,method:'mercado_pago'}},[received]));
});
