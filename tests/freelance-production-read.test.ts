import assert from 'node:assert/strict';
import test from 'node:test';
import {freelanceProductionReadEnabled,handleFreelanceProductionRead} from '../server/freelance/freelanceProductionReadTransport.js';
const env={KYRUB_FREELANCE_PRODUCTION_READ_ENABLED:'true',KYRUB_FREELANCE_PILOT_UIDS:'pilot',VERCEL:'1',VERCEL_ENV:'production',NODE_ENV:'production'};
test('production reader cannot be opened by preview, local flags, emulators or implicit defaults',()=>{
 assert.equal(freelanceProductionReadEnabled(env),true);
 for(const change of [{KYRUB_FREELANCE_PRODUCTION_READ_ENABLED:undefined},{VERCEL_ENV:'preview'},{NODE_ENV:'test'},{VERCEL:undefined},{FIRESTORE_EMULATOR_HOST:'localhost:8088'},{FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099'},{GOOGLE_APPLICATION_CREDENTIALS:'fake'},{KYRUB_FREELANCE_LOCAL_HOMOLOGATION:'true'},{KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION:'true'}])assert.equal(freelanceProductionReadEnabled({...env,...change}),false);
});
test('read-only pilot requires correct project, revoked-token verifier, verified account, adult eligibility and server allowlist',async()=>{
 let status=0,body:unknown,reads=0,eligibilityChecks=0;
 const response={setHeader(){},status(n:number){status=n;return{json(v:unknown){body=v;}}}};
 const deps={
  env,projectReady:()=>true,verify:async()=>({uid:'pilot',aud:'kyrub-b8d0e',email_verified:true}),
  accountEligible:async()=>{eligibilityChecks++;return true;},
  read:async(uid:string,view:unknown,offerId?:unknown,cursor?:unknown)=>{reads++;assert.equal(uid,'pilot');assert.equal(view,'owner');assert.equal(offerId,undefined);assert.equal(cursor,'page');return{items:[],nextCursor:null};}
 };
 const req={method:'GET',headers:{authorization:'Bearer fixture'},query:{view:'owner',cursor:'page'}};
 for(const [input,override,expected] of [
  [{...req,method:'POST'}, {},405],
  [{...req,headers:{}}, {},401],
  [{...req,query:{view:'owner',uid:'other'}}, {},400],
  [{...req,query:{view:'reputation_public_experience'}}, {},400],
  [req,{projectReady:()=>false},503],
  [req,{verify:async()=>{throw Error('revoked');}},401],
  [req,{verify:async()=>({uid:'pilot',aud:'other',email_verified:true})},401],
  [req,{verify:async()=>({uid:'pilot',aud:'kyrub-b8d0e',email_verified:false})},401],
  [req,{env:{...env,KYRUB_FREELANCE_PILOT_UIDS:''}},403],
  [req,{env:{...env,KYRUB_FREELANCE_PILOT_UIDS:'other'}},403],
  [req,{accountEligible:async()=>false},403],
 ] as const){
  await handleFreelanceProductionRead(input,response,{...deps,...override});
  assert.equal(status,expected);assert.equal(reads,0);
 }
 await handleFreelanceProductionRead(req,response,deps);
 assert.equal(status,200);assert.equal(reads,1);assert.equal(eligibilityChecks,1);assert.deepEqual(body,{items:[],nextCursor:null});
});

test('engagement preflight is private, parameterless and never dispatches a mutation',async()=>{
 let status=0,body:unknown,calls=0;
 const response={setHeader(){},status(n:number){status=n;return{json(v:unknown){body=v;}}}};
 const deps={
  env,projectReady:()=>true,verify:async()=>({uid:'pilot',aud:'kyrub-b8d0e',email_verified:true}),
  accountEligible:async()=>true,
  read:async(uid:string,view:unknown,offerId?:unknown,cursor?:unknown)=>{
   calls++;assert.equal(uid,'pilot');assert.equal(view,'engagement_preflight');assert.equal(offerId,undefined);assert.equal(cursor,undefined);
   return {requesterEligible:true,freelancerEligible:false,restricted:true,mutationsEnabled:false};
  }
 };
 const req={method:'GET',headers:{authorization:'Bearer fixture'},query:{view:'engagement_preflight'}};
 for(const query of [{...req.query,uid:'other'},{...req.query,offerId:'offer'},{...req.query,cursor:'page'}]){
  await handleFreelanceProductionRead({...req,query},response,deps);assert.equal(status,400);
 }
 await handleFreelanceProductionRead({...req,method:'POST'},response,deps);assert.equal(status,405);
 await handleFreelanceProductionRead(req,response,{...deps,accountEligible:async()=>false});assert.equal(status,403);
 assert.equal(calls,0);
 await handleFreelanceProductionRead(req,response,deps);assert.equal(status,200);assert.equal(calls,1);
 assert.deepEqual(body,{requesterEligible:true,freelancerEligible:false,restricted:true,mutationsEnabled:false});
});

test('Pix readiness accepts only own authenticated read without keys or mutations',async()=>{
 let status=0,body:unknown,calls=0;
 const response={setHeader(){},status(n:number){status=n;return{json(v:unknown){body=v;}}}};
 const deps={env,projectReady:()=>true,verify:async()=>({uid:'pilot',aud:'kyrub-b8d0e',email_verified:true}),accountEligible:async()=>true,
  read:async(uid:string,view:unknown,offerId?:unknown,cursor?:unknown)=>{
   calls++;assert.equal(uid,'pilot');assert.equal(view,'personal_pix_readiness');assert.equal(offerId,undefined);assert.equal(cursor,undefined);
   return {status:'declared',ownershipVerified:false};
  }};
 const req={method:'GET',headers:{authorization:'Bearer fixture'},query:{view:'personal_pix_readiness'}};
 for(const query of [{...req.query,uid:'other'},{...req.query,offerId:'offer'},{...req.query,cursor:'page'}]){
  await handleFreelanceProductionRead({...req,query},response,deps);assert.equal(status,400);
 }
 await handleFreelanceProductionRead({...req,method:'POST'},response,deps);assert.equal(status,405);
 await handleFreelanceProductionRead(req,response,{...deps,accountEligible:async()=>false});assert.equal(status,403);
 assert.equal(calls,0);
 await handleFreelanceProductionRead(req,response,deps);assert.equal(status,200);assert.equal(calls,1);
 assert.deepEqual(body,{status:'declared',ownershipVerified:false});
});

test('personal Pix pilot requires explicit production authority and recent authentication for mutations',async()=>{
 const {handlePersonalPixPilot}=await import('../server/payments/personalPixPilotTransport.js');
 const {personalPixPilotEnabled}=await import('../server/payments/personalPixDestinationService.js');
 const pilotEnv={VERCEL:'1',VERCEL_ENV:'production',NODE_ENV:'production',KYRUB_PERSONAL_PIX_PILOT_ENABLED:'true',KYRUB_FREELANCE_PILOT_UIDS:'pilot'};
 assert.equal(personalPixPilotEnabled(pilotEnv),true);
 for(const override of [{KYRUB_PERSONAL_PIX_PILOT_ENABLED:undefined},{VERCEL_ENV:'preview'},{FIRESTORE_EMULATOR_HOST:'localhost:8088'},{KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION:'true'}])assert.equal(personalPixPilotEnabled({...pilotEnv,...override}),false);
 let status=0,changes=0,reads=0;
 const response={setHeader(){},status(n:number){status=n;return{json(){}}}};
 const identity={uid:'pilot',aud:'kyrub-b8d0e',email_verified:true,auth_time:Math.floor(Date.now()/1000)};
 const deps={env:pilotEnv,projectReady:()=>true,verify:async()=>identity,active:async()=>true,read:async(uid:string)=>{assert.equal(uid,'pilot');reads++;return {status:'declared',revision:1};},change:async(uid:string,input:unknown)=>{assert.equal(uid,'pilot');assert.deepEqual(input,{action:'revoke',expectedRevision:1,confirmed:true});changes++;return {status:'revoked'};}};
 const req={method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:{action:'revoke',expectedRevision:1,confirmed:true}};
 await handlePersonalPixPilot(req,response,{...deps,projectReady:()=>false});assert.equal(status,503);
 await handlePersonalPixPilot(req,response,{...deps,verify:async()=>({...identity,uid:'other'})});assert.equal(status,403);
 await handlePersonalPixPilot(req,response,{...deps,verify:async()=>({...identity,auth_time:identity.auth_time-301})});assert.equal(status,403);
 await handlePersonalPixPilot({...req,body:{...req.body,uid:'other'}},response,deps);assert.equal(status,400);
 await handlePersonalPixPilot({...req,body:{...req.body,action:'import_cid'}},response,deps);assert.equal(status,400);
 assert.equal(changes,0);
 await handlePersonalPixPilot({...req,method:'GET'},response,deps);assert.equal(status,200);assert.equal(reads,1);
 await handlePersonalPixPilot(req,response,deps);assert.equal(status,200);assert.equal(changes,1);
});

test('engagement pilot is separately gated and only allows supported personal fixed-price terms',async()=>{
 const {freelanceEngagementPilotEnabled,freelanceEngagementPilotAllows,assertEngagementPilotTerms}=await import('../server/freelance/freelanceEngagementPilotAuthority.js');
 const e={...env,KYRUB_FREELANCE_ENGAGEMENT_PILOT_ENABLED:'true'};
 assert.equal(freelanceEngagementPilotEnabled(e),true);
 for(const change of [{KYRUB_FREELANCE_ENGAGEMENT_PILOT_ENABLED:undefined},{KYRUB_FREELANCE_PRODUCTION_READ_ENABLED:undefined},{VERCEL_ENV:'preview'},{FIRESTORE_EMULATOR_HOST:'localhost:8088'},{KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION:'true'}])assert.equal(freelanceEngagementPilotEnabled({...e,...change}),false);
 assert.equal(freelanceEngagementPilotAllows('pilot',e),true);
 assert.equal(freelanceEngagementPilotAllows('other',e),false);
 assert.equal(freelanceEngagementPilotAllows('tagpk_demo',{...e,KYRUB_FREELANCE_PILOT_UIDS:'tagpk_demo'}),false);
 const terms={paymentTerms:{schemaVersion:1 as const,method:'external_pix' as const,timing:'on_completion' as const,currency:'BRL' as const,amountMinor:1000,platformCommissionMinor:0 as const,providerFeeResponsibility:'financial_service_customer' as const},workTerms:{mode:'fixed' as const,location:'remote' as const,estimatedMinutes:60}};
 assert.doesNotThrow(()=>assertEngagementPilotTerms(terms));
 assert.throws(()=>assertEngagementPilotTerms({...terms,paymentTerms:undefined}));
 assert.throws(()=>assertEngagementPilotTerms({...terms,paymentTerms:{...terms.paymentTerms,method:'mercado_pago'}}));
 assert.throws(()=>assertEngagementPilotTerms({...terms,workTerms:{...terms.workTerms,mode:'hourly',hourlyRateMinor:1000}}));
 assert.throws(()=>assertEngagementPilotTerms({...terms,requesterStore:{storeId:'store',displayName:'Store',representativeRole:'owner'}}));
});

test('precontract HTTP permits only publish, apply and select under explicit pilot authority',async()=>{
 const {handleFreelanceEngagementPilot}=await import('../server/freelance/freelanceEngagementPilotTransport.js');
 const e={...env,KYRUB_FREELANCE_ENGAGEMENT_PILOT_ENABLED:'true'};
 let status=0,body:unknown,calls=0;
 const res={setHeader(){},status(n:number){status=n;return {json(v:unknown){body=v;}}}};
 const deps={env:e,verify:async()=>({uid:'pilot',aud:'kyrub-b8d0e',email_verified:true}),authorize:()=>{},execute:async(uid:string,_input:unknown)=>{assert.equal(uid,'pilot');calls++;}};
 const paymentTerms={schemaVersion:1,method:'external_pix',timing:'on_completion',currency:'BRL',amountMinor:1000,platformCommissionMinor:0,providerFeeResponsibility:'financial_service_customer'};
 const workTerms={mode:'fixed',location:'remote',estimatedMinutes:60};
 const req={method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:{action:'publish',offerId:'offer',terms:{title:'Fixture',description:'Fixture',requirements:'',paymentMinor:1000,paymentTerms,workTerms}}};
 await handleFreelanceEngagementPilot(req,res,{...deps,env});assert.equal(status,503);
 await handleFreelanceEngagementPilot(req,res,{...deps,verify:async()=>({uid:'other',aud:'kyrub-b8d0e',email_verified:true})});assert.equal(status,403);
 await handleFreelanceEngagementPilot({...req,query:{uid:'other'}},res,deps);assert.equal(status,400);
 for(const action of ['confirm','start','request_completion','confirm_completion','statement','reveal_pix']){
  await handleFreelanceEngagementPilot({...req,body:{action,offerId:'offer'}},res,deps);assert.equal(status,400);
 }
 await handleFreelanceEngagementPilot({...req,body:{...req.body,uid:'other'}},res,deps);assert.equal(status,400);
 assert.equal(calls,0);
 await handleFreelanceEngagementPilot(req,res,deps);assert.equal(status,200);assert.deepEqual(body,{confirmed:true});
 await handleFreelanceEngagementPilot({...req,body:{action:'apply',offerId:'offer',expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms}},res,deps);assert.equal(status,200);
 await handleFreelanceEngagementPilot({...req,body:{action:'select',offerId:'offer',applicantUid:'applicant'}},res,deps);assert.equal(status,200);assert.equal(calls,3);
 for(const action of ['release','withdraw','cancel_open']){
  const exit={action,offerId:'offer',...(action==='release'?{applicantUid:'applicant'}:{})};
  await handleFreelanceEngagementPilot({...req,body:exit},res,deps);assert.equal(status,400);
  await handleFreelanceEngagementPilot({...req,body:{...exit,confirmed:true,uid:'other'}},res,deps);assert.equal(status,400);
  await handleFreelanceEngagementPilot({...req,body:{...exit,confirmed:true}},res,deps);assert.equal(status,200);
 }
 assert.equal(calls,6);
});
