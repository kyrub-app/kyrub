import assert from 'node:assert/strict';
import test from 'node:test';
import {handleFreelanceWorkspace,executeFreelanceWorkspaceAction,freelanceWorkspaceEnabled} from '../server/freelance/freelanceWorkspaceTransport.js';
test('disabled workspace never reaches verification, read or mutation',async()=>{
 let calls=0,status=0;
 const response={setHeader(){},status(n:number){status=n;return {json(){}};}};
 const deps={enabled:()=>false,verify:async()=>{calls++;return {uid:'actor'};},read:async()=>{calls++;throw Error();},mutate:async()=>{calls++;}};
 await handleFreelanceWorkspace({method:'POST',headers:{authorization:'Bearer fixture'}},response,deps);
 assert.equal(status,503);assert.equal(calls,0);
});
test('workspace binds UID to token, rejects non JSON and never returns mutation private data',async()=>{
 let status=0,body:unknown;const calls:unknown[]=[];
 const response={setHeader(){},status(n:number){status=n;return {json(x:unknown){body=x;}};}};
 const deps={enabled:()=>true,verify:async()=>({uid:'actor'}),read:async(uid:string,view:unknown)=>{calls.push([uid,view]);throw Error('FREELANCE_FORBIDDEN');},mutate:async(uid:string,input:unknown)=>{calls.push([uid,input]);return {private:'hidden'};}};
 await handleFreelanceWorkspace({method:'GET',headers:{},query:{view:'owner'}},response,deps);assert.equal(status,401);
 await handleFreelanceWorkspace({method:'GET',headers:{authorization:'Bearer fixture'},query:{view:'owner',uid:'other'}},response,deps);assert.equal(status,403);
 await handleFreelanceWorkspace({method:'POST',headers:{authorization:'Bearer fixture'},body:{}},response,deps);assert.equal(status,415);
 await handleFreelanceWorkspace({method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:{action:'apply',offerId:'offer'}},response,deps);assert.equal(status,200);assert.deepEqual(body,{confirmed:true});
 assert.deepEqual(calls,[['actor','owner'],['actor',{action:'apply',offerId:'offer'}]]);
 await assert.rejects(executeFreelanceWorkspaceAction('actor',{action:'apply',offerId:'offer',actorUid:'other'}),/FREELANCE_INVALID/);
 await assert.rejects(executeFreelanceWorkspaceAction('actor',{action:'confirm_funding',offerId:'offer'}),/FREELANCE_INVALID/);
});
test('production cannot enable local workspace',()=>{
 const old=process.env.VERCEL_ENV,flag=process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION;
 try{process.env.VERCEL_ENV='production';process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION='true';assert.equal(freelanceWorkspaceEnabled(),false);}
 finally{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;if(flag===undefined)delete process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION;else process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION=flag;}
});

test('candidate interface has no local persistence, uses server receipt and preserves isolated boundary',async()=>{
 const {readFileSync}=await import('node:fs');
 const ui=readFileSync('src/components/modals/CanonicalFreelaWorkspace.tsx','utf8');
 assert.match(ui,/VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION/);
 assert.match(ui,/data\?\.confirmed!==true/);
 assert.match(ui,/auth.currentUser\?\.uid===user.uid/);
 assert.doesNotMatch(ui,/localStorage|Math.random|setDoc\(|deleteDoc\(/);
 const modal=readFileSync('src/components/modals/FreelaManagerModal.tsx','utf8');
 assert.match(modal,/candidate \? \(props.isOpen/);
});

test('R$20/hour is guidance only; fixed completion retains agreed amount and hourly mode fails closed',async()=>{
 const {readFreelanceWorkTerms,projectFreelanceWorkRecommendation,assertFreelanceWorkExecutionReady,sameFreelanceWorkTerms}=await import('../shared/freelanceWorkTerms.js');
 const terms={mode:'fixed',location:'remote',estimatedMinutes:360};
 assert.deepEqual(projectFreelanceWorkRecommendation(terms,12000),{recommendedMinor:12000,equivalentHourlyMinor:2000,belowRecommendation:false});
 assert.equal(projectFreelanceWorkRecommendation(terms,9000).belowRecommendation,true);
 assert.equal(projectFreelanceWorkRecommendation({...terms,estimatedMinutes:180},9000).equivalentHourlyMinor,3000);
 assert.equal(projectFreelanceWorkRecommendation({...terms,estimatedMinutes:1},33).recommendedMinor,34);
 assert.equal(sameFreelanceWorkTerms(terms,{...terms,location:'on_site'},12000),false);
 assert.equal(sameFreelanceWorkTerms(undefined,undefined,12000),true);
 assert.throws(()=>readFreelanceWorkTerms({...terms,estimatedMinutes:0},12000),/INVALID/);
 const hourly=readFreelanceWorkTerms({mode:'hourly',location:'on_site',estimatedMinutes:360,hourlyRateMinor:2000},12000);
 assert.throws(()=>assertFreelanceWorkExecutionReady(hourly),/NOT_ENABLED/);
 assert.doesNotThrow(()=>assertFreelanceWorkExecutionReady(readFreelanceWorkTerms(terms,9000)));
});

test('counterproposal changes only price and estimated duration, preserves payment timing and location',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {readFreelanceCounterproposal,negotiatedFreelanceTerms}=await import('../shared/freelanceCounterproposal.js');
 const original={paymentMinor:12000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:12000}),workTerms:{mode:'fixed' as const,location:'remote' as const,estimatedMinutes:360}};
 const proposal={amountMinor:9000,estimatedMinutes:180};
 const agreed=negotiatedFreelanceTerms(original,proposal);
 assert.equal(agreed.paymentMinor,9000);assert.equal(agreed.paymentTerms?.timing,'advance');assert.equal(agreed.paymentTerms?.amountMinor,9000);
 assert.deepEqual(agreed.workTerms,{mode:'fixed',location:'remote',estimatedMinutes:180});
 assert.equal(original.paymentMinor,12000);
 for(const invalid of [{...proposal,amountMinor:0},{...proposal,estimatedMinutes:0},{...proposal,location:'on_site'},{amountMinor:12000,estimatedMinutes:360}])assert.throws(()=>readFreelanceCounterproposal(invalid,original),/INVALID/);
 assert.throws(()=>readFreelanceCounterproposal(proposal,{paymentMinor:12000}),/INVALID/);
});

test('attendance separates early arrival, employer waiting, work and mutually agreed breaks',async()=>{
 const {projectFreelanceAttendance}=await import('../shared/freelanceAttendance.js');
 const schedule={location:'on_site' as const,scheduledStartAt:'2026-11-27T12:00:00.000Z',agreedMinutes:240};
 const at=(h:string)=>'2026-11-27T'+h+':00.000Z';
 const events=[
  {id:'a',kind:'check_in',actor:'worker',at:at('11:45')},
  {id:'b',kind:'confirm_presence',actor:'requester',at:at('11:50')},
  {id:'c',kind:'acknowledge_waiting',actor:'requester',at:at('12:05')},
  {id:'d',kind:'start',actor:'worker',at:at('12:30')},
  {id:'e',kind:'request_break',actor:'worker',at:at('13:30')},
  {id:'f',kind:'approve_break',actor:'requester',at:at('13:30')},
  {id:'g',kind:'resume',actor:'worker',at:at('14:00')},
  {id:'h',kind:'checkout',actor:'worker',at:at('16:00')},
  {id:'i',kind:'confirm_checkout',actor:'requester',at:at('16:05')},
 ] as const;
 const r=projectFreelanceAttendance(schedule,events);
 assert.equal(r.status,'confirmed');assert.equal(r.workMs,180*60000);assert.equal(r.waitMs,30*60000);assert.equal(r.breakMs,30*60000);assert.equal(r.compensableMs,210*60000);assert.equal(r.exceedsAgreedTime,false);assert.equal(r.financialSettlement,'not_verified');
 assert.equal(projectFreelanceAttendance(schedule,events.slice(0,-1)).readyForReview,false);
 assert.throws(()=>projectFreelanceAttendance(schedule,[events[0],{...events[3],at:at('11:50')}]),/CONFLICT/);
 assert.throws(()=>projectFreelanceAttendance(schedule,[...events.slice(0,6),{...events[3],id:'repeat',at:at('13:45')}]),/CONFLICT/);
 assert.throws(()=>projectFreelanceAttendance(schedule,[events[0],{...events[1],actor:'worker'}]),/CONFLICT/);
 assert.throws(()=>projectFreelanceAttendance(schedule,[events[0],events[0]]),/CONFLICT/);
});
test('remote attendance needs no location, early start requires authorization and suspension stops accrual',async()=>{
 const {projectFreelanceAttendance}=await import('../shared/freelanceAttendance.js');
 const schedule={location:'remote' as const,scheduledStartAt:'2026-11-27T12:00:00.000Z',agreedMinutes:30};
 const start={id:'start',kind:'start',actor:'worker',at:'2026-11-27T11:30:00.000Z'} as const;
 const early={id:'early',kind:'authorize_early_start',actor:'requester',at:'2026-11-27T11:20:00.000Z'} as const;
 const stop={id:'stop',kind:'suspend',actor:'system',at:'2026-11-27T12:15:00.000Z'} as const;
 assert.throws(()=>projectFreelanceAttendance(schedule,[start]),/CONFLICT/);
 assert.throws(()=>projectFreelanceAttendance(schedule,[{...start,kind:'check_in'}]),/CONFLICT/);
 const result=projectFreelanceAttendance(schedule,[early,start,stop]);
 assert.equal(result.status,'suspended');assert.equal(result.workMs,45*60000);assert.equal(result.exceedsAgreedTime,true);assert.equal(result.readyForReview,false);
 assert.throws(()=>projectFreelanceAttendance(schedule,[early,start,stop,{...start,id:'new',at:'2026-11-27T12:20:00.000Z'}]),/CONFLICT/);
});

test('review suspension does not accrue time and requires explicit restart after administrative resumption',async()=>{
 const {projectFreelanceAttendance}=await import('../shared/freelanceAttendance.js');
 const schedule={location:'remote' as const,scheduledStartAt:'2026-11-27T12:00:00.000Z',agreedMinutes:180};
 const events=[
 {id:'start',kind:'start',actor:'worker',at:'2026-11-27T12:00:00.000Z'},
 {id:'suspend',kind:'suspend',actor:'system',at:'2026-11-27T12:30:00.000Z'},
 {id:'resume-review',kind:'resume_review',actor:'system',at:'2026-11-27T13:00:00.000Z'},
 {id:'resume',kind:'resume',actor:'worker',at:'2026-11-27T13:15:00.000Z'},
 {id:'checkout',kind:'checkout',actor:'worker',at:'2026-11-27T14:00:00.000Z'},
 {id:'confirm',kind:'confirm_checkout',actor:'requester',at:'2026-11-27T14:05:00.000Z'},
 ] as const;
 assert.equal(projectFreelanceAttendance(schedule,events.slice(0,3)).status,'awaiting_resume');
 const r=projectFreelanceAttendance(schedule,events);
 assert.equal(r.workMs,75*60000);assert.equal(r.breakMs,0);assert.equal(r.status,'confirmed');
 assert.throws(()=>projectFreelanceAttendance(schedule,[events[0],events[1],{...events[2],actor:'requester'}]),/CONFLICT/);
});

test('hourly assessment uses actual recorded time, waiting and approved breaks, not the estimate',async()=>{
 const {calculateFreelanceHourlyAccounting}=await import('../shared/freelanceHourlyAccounting.js');
 const {projectFreelanceAttendance}=await import('../shared/freelanceAttendance.js');
 const schedule={location:'on_site' as const,scheduledStartAt:'2026-11-27T12:00:00.000Z',agreedMinutes:360};
 const at=(h:string)=>'2026-11-27T'+h+':00.000Z';
 const events=[
 {id:'a',kind:'check_in',actor:'worker',at:at('11:45')},
 {id:'b',kind:'confirm_presence',actor:'requester',at:at('11:50')},
 {id:'c',kind:'acknowledge_waiting',actor:'requester',at:at('12:05')},
 {id:'d',kind:'start',actor:'worker',at:at('12:30')},
 {id:'e',kind:'request_break',actor:'worker',at:at('13:30')},
 {id:'f',kind:'approve_break',actor:'requester',at:at('13:30')},
 {id:'g',kind:'resume',actor:'worker',at:at('14:00')},
 {id:'h',kind:'checkout',actor:'worker',at:at('16:00')},
 {id:'i',kind:'confirm_checkout',actor:'requester',at:at('16:05')},
 ] as const;
 const input={workTerms:{mode:'hourly',location:'on_site',estimatedMinutes:360,hourlyRateMinor:2000},estimatedMinor:12000,schedule,events,extensions:[]};
 const result=calculateFreelanceHourlyAccounting(input);
 assert.equal(result.status,'calculated');assert.equal(result.calculatedServiceMinor,7000);assert.equal(result.authorizedCapMinor,12000);
 assert.equal(result.workMs,180*60000);assert.equal(result.waitMs,30*60000);assert.equal(result.breakMs,30*60000);
 assert.equal(result.bankVerified,false);assert.equal(result.settlement,'not_verified');
 const before=calculateFreelanceHourlyAccounting({...input,events:events.slice(0,-1)});
 assert.equal(before.status,'awaiting_confirmation');assert.equal(before.calculatedServiceMinor,null);
 const suspended=calculateFreelanceHourlyAccounting({...input,events:[...events.slice(0,4),{id:'stop',kind:'suspend',actor:'system',at:at('13:00')}]});
 assert.equal(suspended.status,'requires_suspension_review');assert.equal(suspended.calculatedServiceMinor,null);
 assert.equal(projectFreelanceAttendance(schedule,events.slice(0,4),at('13:00')).elapsedCompensableMs,60*60000);
 assert.throws(()=>calculateFreelanceHourlyAccounting({...input,workTerms:{mode:'fixed',location:'on_site',estimatedMinutes:360}}),/CONFLICT/);
 assert.throws(()=>calculateFreelanceHourlyAccounting({...input,estimatedMinor:13000}),/INVALID/);
});
test('hourly extensions require both roles before the cap, unapproved excess remains unresolved',async()=>{
 const {calculateFreelanceHourlyAccounting}=await import('../shared/freelanceHourlyAccounting.js');
 const at=(h:string)=>'2026-11-27T'+h+':00.000Z';
 const schedule={location:'remote' as const,scheduledStartAt:at('08:00'),agreedMinutes:360};
 const events=[
 {id:'start',kind:'start',actor:'worker',at:at('08:00')},
 {id:'out',kind:'checkout',actor:'worker',at:at('15:00')},
 {id:'confirmed',kind:'confirm_checkout',actor:'requester',at:at('15:05')},
 ] as const;
 const input={workTerms:{mode:'hourly',location:'remote',estimatedMinutes:360,hourlyRateMinor:2000},estimatedMinor:12000,schedule,events,extensions:[]};
 const excess=calculateFreelanceHourlyAccounting(input);
 assert.equal(excess.status,'requires_excess_review');assert.equal(excess.excessMs,3600000);
 assert.equal(excess.withinCapReferenceMinor,12000);assert.equal(excess.calculatedServiceMinor,null);
 const extension={id:'e1',extraMinutes:60,proposedBy:'worker' as const,acceptedBy:'requester' as const,proposedAt:at('13:00'),acceptedAt:at('13:15')};
 const extended=calculateFreelanceHourlyAccounting({...input,extensions:[extension]});
 assert.equal(extended.authorizedMinutes,420);assert.equal(extended.authorizedCapMinor,14000);assert.equal(extended.calculatedServiceMinor,14000);
 for(const bad of [{...extension,acceptedBy:'worker' as const},{...extension,acceptedAt:at('14:00')},{...extension,acceptedAt:at('15:01')},{...extension,extraMinutes:0}]){
  assert.throws(()=>calculateFreelanceHourlyAccounting({...input,extensions:[bad]}),/CONFLICT/);
 }
 assert.throws(()=>calculateFreelanceHourlyAccounting({...input,extensions:[extension,extension]}),/CONFLICT/);
 const seconds=calculateFreelanceHourlyAccounting({...input,events:[events[0],{...events[1],at:'2026-11-27T08:00:01.000Z'},{...events[2],at:at('08:01')}]});
 assert.equal(seconds.calculatedServiceMinor,1);
});
