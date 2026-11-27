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
