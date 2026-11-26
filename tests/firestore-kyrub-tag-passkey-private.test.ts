import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';

const projectId='demo-kyrub-tag-passkey-e2e';
test('Passkey registry and secret-bearing documents are server-only even to linked account and admin clients',{skip:process.env.KYRUB_TAG_PASSKEY_E2E!=='true',timeout:120000},async()=>{
 assert.equal(process.env.FIREBASE_PROJECT_ID,projectId);
 assert.equal(process.env.GCLOUD_PROJECT,projectId);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
 assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
 assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.VERCEL);
 const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8088,rules:readFileSync('.firebase/firestore.combined.rules','utf8')}});
 const owner='tagpk_'+'x'.repeat(43),account='linked-account-fixture',tagId='a'.repeat(32);
 const records=[
  ['kyrub_official_tags',tagId,{ownerId:owner,linkedAccountId:account,ownerAuthMode:'passkey',passkeyRecoveryHash:'fixture-digest'}],
  ['kyrub_tag_passkey_credentials',tagId,{ownerId:owner,credential:{id:'fixture-key',publicKey:'fixture-public-key'}}],
  ['kyrub_tag_passkey_challenges','challenge-fixture',{ownerId:owner,tagId,challenge:'fixture-challenge',usedAt:null}],
  ['kyrub_tag_passkey_credential_index','index-fixture',{ownerId:owner,tagId}],
  ['kyrub_tag_passkey_quotas',tagId,{count:1,bucket:1}],
  ['kyrub_tag_minimal_identities',owner,{uid:owner,mode:'tag_only'}],
 ] as const;
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await Promise.all(records.map(([path,id,data])=>setDoc(doc(db,path,id),data)));
  });
  const contexts=[env.unauthenticatedContext(),env.authenticatedContext('unrelated-fixture'),env.authenticatedContext(account),env.authenticatedContext(owner),env.authenticatedContext('admin-fixture',{admin:true,superAdmin:true,role:'super_admin'})];
  for(const ctx of contexts){
   const db=ctx.firestore();
   for(const [path,id] of records){
    const ref=doc(db,path,id);
    await Promise.all([assertFails(getDoc(ref)),assertFails(getDocs(collection(db,path))),
     assertFails(updateDoc(ref,{tampered:true})),assertFails(deleteDoc(ref)),
     assertFails(setDoc(doc(db,path,'unauthorized-new-fixture'),{ownerId:account}))]);
   }
  }
  console.info('PASSKEY_RULES: 150 denied direct client operations; no credential, recovery digest or ownership mutation accessible');
 }finally{await env.cleanup();}
});
