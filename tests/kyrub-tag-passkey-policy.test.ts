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

import {productionTagPasskeyScope} from '../server/identity/kyrubTagPasskeyPolicy';
import {productionPasskeyPilotId,assertProductionPasskeyUnit} from '../server/identity/kyrubTagPasskeyReleasePolicy';
test('production trial needs explicit flags, correct project and exactly one released permanent unit',()=>{
 const env={VERCEL_ENV:'production',KYRUB_TAG_PASSKEY_PRODUCTION_ENABLED:'true',KYRUB_TAG_PERMANENT_STOCK_ENABLED:'true',KYRUB_TAG_PASSKEY_PRODUCTION_TEST_ID:tagId};
 const data={distribution:'promotional',model:'adesivo',urlMode:'permanent',manufacturingState:'released',promotionalBatchId:otherTag,activationHash:null};
 assert.equal(productionPasskeyPilotId('kyrub-b8d0e',env),tagId);
 for(const config of [{...env,VERCEL_ENV:'preview'},{...env,KYRUB_TAG_PASSKEY_PRODUCTION_ENABLED:'false'},{...env,KYRUB_TAG_PERMANENT_STOCK_ENABLED:'false'},{...env,KYRUB_TAG_PASSKEY_PRODUCTION_TEST_ID:tagId+','+otherTag},{...env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088'},{}])assert.equal(productionPasskeyPilotId('kyrub-b8d0e',config),null);
 assert.equal(productionPasskeyPilotId('kyrub-tags',env),null);
 assert.doesNotThrow(()=>assertProductionPasskeyUnit(tagId,tagId,data));
 for(const invalid of [{...data,manufacturingState:'held'},{...data,urlMode:'pilot'},{...data,pilotBatch:'experimental-001'},{...data,distribution:'protected'},{...data,promotionalBatchId:undefined}])assert.throws(()=>assertProductionPasskeyUnit(tagId,tagId,invalid));
 assert.throws(()=>assertProductionPasskeyUnit(tagId,otherTag,data));
 const prod=productionTagPasskeyScope('https://www.kyrub.com');
 assert.equal(prod.rpId,'www.kyrub.com');
 for(const wrong of ['https://kyrub.com','https://admin.kyrub.com','https://kyrub.vercel.app','http://www.kyrub.com','https://www.kyrub.com/'])assert.throws(()=>productionTagPasskeyScope(wrong));
 const prodBinding={...registration,scope:prod};
 assert.doesNotThrow(()=>assertUnusedTagPasskeyChallenge(issueTagPasskeyChallenge(prodBinding,1000),prodBinding,1001));
});
