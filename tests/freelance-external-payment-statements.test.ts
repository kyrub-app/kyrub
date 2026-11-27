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

import {appendHourlyAdvance,projectHourlyAdvances,type HourlyAdvanceEvent} from '../shared/freelanceHourlyReconciliation.js';
import type {FreelanceHourlyCommitment} from '../shared/freelanceVariablePaymentBasis.js';
const hourly:FreelanceHourlyCommitment={schemaVersion:1,kind:'hourly_commitment',offerId:'hourly',requesterUid:'payer',beneficiaryUid:'worker',contractedAt:'2026-11-27T12:00:00.000Z',currency:'BRL',estimatedMinor:10000,hourlyRateMinor:10000,initialMinutes:60,location:'remote',paymentMethod:'external_pix',paymentTiming:'on_completion',custody:'none'};
const advance=(id:string,paymentId:string,statement:HourlyAdvanceEvent['statement'],amountMinor:number,minute:number,actorUid=statement==='paid'?'payer':'worker'):HourlyAdvanceEvent=>({id,paymentId,statement,amountMinor,actorUid,recordedAt:'2026-11-27T12:'+String(minute).padStart(2,'0')+':00.000Z'});
test('hourly advance reconciliation: estimate never due, installments counted once, balance directional',()=>{
 const events=[advance('a','one','paid',5000,1),advance('b','one','received',5000,2),advance('c','two','received',3000,3),advance('d','two','paid',3000,4)];
 const pending=projectHourlyAdvances(hourly,events,null);assert.equal(pending.state,'awaiting_accounting');assert.equal(pending.bilateralMinor,8000);assert.equal(pending.adjustment,null);
 const additional=projectHourlyAdvances(hourly,events,12000);assert.deepEqual(additional.adjustment,{direction:'additional',amountMinor:4000,payerUid:'payer',recipientUid:'worker'});
 assert.equal(projectHourlyAdvances(hourly,events,8000).state,'no_adjustment');
 for(const value of [0,3000])assert.deepEqual(projectHourlyAdvances(hourly,events,value).adjustment,{direction:'refund',amountMinor:8000-value,payerUid:'worker',recipientUid:'payer'});
 assert.equal(additional.bankVerified,false);
 assert.equal(projectHourlyAdvances(hourly,[],12000).adjustment?.amountMinor,12000);
 assert.equal(projectHourlyAdvances(hourly,[],0).state,'no_adjustment');
});
test('hourly advance reconciliation: unmatched and contradictory declarations cannot produce a balance',()=>{
 const paid=advance('a','one','paid',5000,1),denied=advance('b','one','not_received',5000,2),received=advance('c','one','received',5000,3);
 for(const events of [[paid],[received]]){const r=projectHourlyAdvances(hourly,events,12000);assert.equal(r.state,'awaiting_confirmation');assert.equal(r.adjustment,null);assert.equal(r.bilateralMinor,0);}
 for(const events of [[paid,denied],[paid,advance('x','one','received',4000,2)]]){const r=projectHourlyAdvances(hourly,events,12000);assert.equal(r.state,'disputed');assert.equal(r.adjustment,null);}
 assert.equal(projectHourlyAdvances(hourly,[paid,denied,received],12000).adjustment?.amountMinor,7000);
});
test('hourly advance reconciliation: replay, actor roles, ordering and amounts fail closed',()=>{
 const a=advance('a','one','paid',5000,1),b=advance('b','one','received',5000,2);
 assert.equal(appendHourlyAdvance(hourly,[a,b],{...a,recordedAt:b.recordedAt}).changed,false);
 for(const e of [{...a,amountMinor:5001},{...a,paymentId:'other'},advance('c','one','paid',5000,3),advance('c','two','paid',5000,3,'worker'),advance('c','two','paid',0,3),advance('c','two','paid',0.5,3),advance('c','two','paid',10,0)])assert.throws(()=>appendHourlyAdvance(hourly,[a,b],e),/FREELANCE_HOURLY_RECONCILIATION_CONFLICT/);
 assert.throws(()=>projectHourlyAdvances(hourly,[a,b],-1));
 assert.throws(()=>projectHourlyAdvances(hourly,[advance('a','one','paid',999999999,1),advance('b','two','paid',1,2)],null));
});
