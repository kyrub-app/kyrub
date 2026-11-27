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
