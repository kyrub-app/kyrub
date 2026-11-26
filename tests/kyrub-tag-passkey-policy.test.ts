import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,TAG_PASSKEY_TTL_MS,TAG_PASSKEY_USER_VERIFICATION,TAG_PASSKEY_REQUIRE_USER_VERIFICATION,newTagPasskeyRecoveryCode,tagPasskeyRecoveryHash,matchesTagPasskeyRecovery} from '../server/identity/kyrubTagPasskeyPolicy';
const tagId='a'.repeat(32),otherTag='b'.repeat(32),origin='https://kyrub-tag-pilot.vercel.app',scope=isolatedTagPasskeyScope(origin,origin);
const registration={tagId,purpose:'register' as const,ownerId:null,credentialId:null,scope};
const edit={tagId,purpose:'edit' as const,ownerId:'owner-123',credentialId:'registered-credential',scope};
test('exact pilot origin only; production, parent domain and request substitution rejected',()=>{
 assert.equal(scope.rpId,'kyrub-tag-pilot.vercel.app');
 for(const value of ['https://kyrub.com','https://www.kyrub.com','https://vercel.app','http://kyrub-tag-pilot.vercel.app',origin+'/tag/a',origin+':444','https://evil.example'])assert.throws(()=>isolatedTagPasskeyScope(value,value),/TAG_PASSKEY_ORIGIN/);
 assert.throws(()=>isolatedTagPasskeyScope(origin,'https://another.vercel.app'),/TAG_PASSKEY_ORIGIN/);
});
test('challenges are random, short lived and scoped to exact action, unit and credential',()=>{
 const now=1000,record=issueTagPasskeyChallenge(edit,now);
 assert.notEqual(record.challenge,issueTagPasskeyChallenge(edit,now).challenge);
 assert.notEqual(record.id,record.challenge);
 assert.doesNotThrow(()=>assertUnusedTagPasskeyChallenge(record,edit,now+1));
 assert.throws(()=>assertUnusedTagPasskeyChallenge(record,edit,now+TAG_PASSKEY_TTL_MS));
 assert.throws(()=>assertUnusedTagPasskeyChallenge({...record,usedAt:now+1},edit,now+2));
 for(const bad of [{...edit,tagId:otherTag},{...edit,purpose:'block' as const},{...edit,ownerId:'finder'},{...edit,credentialId:'other-key'},registration])assert.throws(()=>assertUnusedTagPasskeyChallenge(record,bad,now+2));
 assert.throws(()=>issueTagPasskeyChallenge({...registration,ownerId:'finder'},now));
 assert.throws(()=>issueTagPasskeyChallenge({...edit,credentialId:null},now));
 assert.equal(TAG_PASSKEY_USER_VERIFICATION,'required');
 assert.equal(TAG_PASSKEY_REQUIRE_USER_VERIFICATION,true);
});
test('recovery secret is distinct from public tag, bound to unit and checked by digest',()=>{
 const secret=newTagPasskeyRecoveryCode(),hash=tagPasskeyRecoveryHash(tagId,secret);
 assert.equal(secret.length,43);assert.equal(hash.length,64);
 assert.equal(matchesTagPasskeyRecovery(tagId,secret,hash),true);
 assert.equal(matchesTagPasskeyRecovery(otherTag,secret,hash),false);
 assert.equal(matchesTagPasskeyRecovery(tagId,newTagPasskeyRecoveryCode(),hash),false);
 assert.equal(matchesTagPasskeyRecovery(tagId,tagId,hash),false);
});
