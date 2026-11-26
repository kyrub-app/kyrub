import {test} from 'node:test';
import assert from 'node:assert/strict';
import {issueTagPasskeyChallenge,isolatedTagPasskeyScope} from '../server/identity/kyrubTagPasskeyPolicy';
import {tagRegistrationOptions,tagAuthenticationOptions,verifyTagRegistration,verifyTagAuthentication} from '../server/identity/kyrubTagPasskeyVerifier';
const origin='https://kyrub-tag-pilot.vercel.app',scope=isolatedTagPasskeyScope(origin,origin),tagId='a'.repeat(32),now=10000;
const register=()=>issueTagPasskeyChallenge({tagId,scope,purpose:'register',ownerId:null,credentialId:null},now);
const credential={id:'credential-123',publicKey:'YWJj',counter:0,userHandle:'x'.repeat(43),backedUp:false};
const edit=()=>issueTagPasskeyChallenge({tagId,scope,purpose:'edit',ownerId:'owner-123',credentialId:credential.id},now);
test('library registration options require local user verification and preserve the exact challenge',async()=>{
 const r=register(),options=await tagRegistrationOptions(r,now+1);
 assert.equal(options.challenge,r.challenge);
 assert.equal(options.rp.id,scope.rpId);
 assert.equal(options.user.id,r.id);
 assert.equal(options.authenticatorSelection?.userVerification,'required');
 assert.equal(options.authenticatorSelection?.residentKey,'required');
 assert.equal(options.attestation,'none');
 await assert.rejects(tagRegistrationOptions({...r,usedAt:now+1},now+2));
 await assert.rejects(tagRegistrationOptions(edit(),now+1));
});
test('authentication permits only stored credential and exact challenge',async()=>{
 const r=edit(),options=await tagAuthenticationOptions(r,credential,now+1);
 assert.equal(options.challenge,r.challenge);assert.equal(options.rpId,scope.rpId);
 assert.equal(options.userVerification,'required');assert.deepEqual(options.allowCredentials?.map(c=>c.id),[credential.id]);
 await assert.rejects(tagAuthenticationOptions(r,{...credential,id:'finder'},now+1));
 await assert.rejects(tagAuthenticationOptions(register(),credential,now+1));
});
test('malformed or foreign responses fail closed, never grant ownership',async()=>{
 const r=register();
 await assert.rejects(verifyTagRegistration(r,{} as Parameters<typeof verifyTagRegistration>[1],now+1));
 const a=edit();
 await assert.rejects(verifyTagAuthentication(a,credential,{id:'finder',rawId:'finder',response:{}} as Parameters<typeof verifyTagAuthentication>[2],now+1),/TAG_PASSKEY_INVALID/);
 await assert.rejects(verifyTagAuthentication(a,credential,{id:credential.id,rawId:credential.id,response:{userHandle:'other'}} as Parameters<typeof verifyTagAuthentication>[2],now+1),/TAG_PASSKEY_INVALID/);
});
