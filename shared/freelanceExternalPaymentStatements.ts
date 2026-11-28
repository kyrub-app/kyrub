import type {FreelancePaymentObligation} from './freelancePaymentObligation.js';
import {validFreelanceId} from './freelanceLifecycle.js';

/** Pure external Pix declaration policy. Not proof of bank settlement. */
export type ExternalPixStatement='paid'|'received'|'not_received';
export type ExternalPixEvent={id:string;actorUid:string;statement:ExternalPixStatement;recordedAt:string};
export type ExternalPixState='awaiting_payment'|'awaiting_receipt'|'nonreceipt_reported'|'disputed'|'receipt_reported'|'bilaterally_reported_received';
const fail=():never=>{throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');};
export function projectExternalPixStatements(obligation:FreelancePaymentObligation,events:readonly ExternalPixEvent[]){
 if(obligation.terms.method!=='external_pix'||!validFreelanceId(obligation.requesterUid)||!validFreelanceId(obligation.beneficiaryUid)||
 obligation.requesterUid===obligation.beneficiaryUid||!Number.isFinite(Date.parse(obligation.contractedAt)))return fail();
 let paid=false,receipt:'received'|'not_received'|null=null,prior=Date.parse(obligation.contractedAt),hadDisagreement=false;
 const ids=new Set<string>();
 for(const event of events){
  const at=Date.parse(event.recordedAt);
  if(!validFreelanceId(event.id)||ids.has(event.id)||!Number.isFinite(at)||at<prior)return fail();
  ids.add(event.id);prior=at;
  if(event.statement==='paid'){
   if(event.actorUid!==obligation.requesterUid||paid)return fail();
   paid=true;
  }else if(event.statement==='not_received'){
   if(event.actorUid!==obligation.beneficiaryUid||receipt!==null)return fail();
   receipt='not_received';
  }else if(event.statement==='received'){
   if(event.actorUid!==obligation.beneficiaryUid||receipt==='received')return fail();
   receipt='received';
  }else return fail();
  if(paid&&receipt==='not_received')hadDisagreement=true;
 }
 const state:ExternalPixState=paid?(receipt==='received'?'bilaterally_reported_received':receipt==='not_received'?'disputed':'awaiting_receipt'):
  receipt==='received'?'receipt_reported':receipt==='not_received'?'nonreceipt_reported':'awaiting_payment';
 return {state,hadDisagreement,bankVerified:false as const,settlementEvidence:'participant_statements_only' as const};
}
/** Append only. Server supplies actor, time and event ID; due and access checks
 * must be enforced transactionally by the future service before calling this.
 * Only the recipient can subsequently acknowledge actual receipt; no erase or
 * unilateral administrative "paid" override. A new dispute after receipt needs review.
 */
export function appendExternalPixStatement(obligation:FreelancePaymentObligation,events:readonly ExternalPixEvent[],event:ExternalPixEvent){
 projectExternalPixStatements(obligation,events);
 const prior=events.find(e=>e.id===event.id);
 if(prior){
  if(prior.actorUid!==event.actorUid||prior.statement!==event.statement)return fail();
  return {events:[...events],changed:false,...projectExternalPixStatements(obligation,events)};
 }
 const next=[...events,event];
 return {events:next,changed:true,...projectExternalPixStatements(obligation,next)};
}
