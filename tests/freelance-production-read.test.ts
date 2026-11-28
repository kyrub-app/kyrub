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
