import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newEmailProof,matchesEmailProof,recoveryEmailDigest,sameEmailDigest,EMAIL_RECOVERY_TTL,emailRecoveryConfigured,nextEmailSendQuota} from '../server/identity/kyrubTagPasskeyEmailPolicy';
test('optional email proof is scoped to unit, action, credential and expiry; raw code is not stored',()=>{
 const id='a'.repeat(32),other='b'.repeat(32),digest=recoveryEmailDigest(id,'person@example.test'),now=100000;
 const p=newEmailProof(id,'bind',digest,'key1',now);
 assert.ok(!JSON.stringify(p.pending).includes(p.code));assert.ok(!JSON.stringify(p.pending).includes('person@example.test'));
 assert.ok(matchesEmailProof(id,'bind',p.pending,'key1',p.code,now));
 assert.equal(matchesEmailProof(id,'recover',p.pending,'key1',p.code,now),false);
 assert.equal(matchesEmailProof(other,'bind',p.pending,'key1',p.code,now),false);
 assert.equal(matchesEmailProof(id,'bind',p.pending,'key2',p.code,now),false);
 assert.equal(matchesEmailProof(id,'bind',p.pending,'key1',p.code,now+EMAIL_RECOVERY_TTL),false);
 assert.equal(sameEmailDigest(digest,recoveryEmailDigest(other,'person@example.test')),false);
});
test('delivery stays disabled until explicitly configured and quota caps sends',()=>{
 assert.equal(emailRecoveryConfigured({}),false);
 assert.equal(emailRecoveryConfigured({KYRUB_TAG_PASSKEY_EMAIL_RECOVERY_ENABLED:'true',KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_TOKEN:'test',KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_URL:'http://example.test'}),false);
 assert.equal(emailRecoveryConfigured({KYRUB_TAG_PASSKEY_EMAIL_RECOVERY_ENABLED:'true',KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_TOKEN:'test',KYRUB_TAG_RECOVERY_EMAIL_DELIVERY_URL:'https://example.test/send'}),true);
 const now=3600000;let q=nextEmailSendQuota(undefined,now);q=nextEmailSendQuota(q,now);q=nextEmailSendQuota(q,now);assert.throws(()=>nextEmailSendQuota(q,now),/TAG_PASSKEY_RATE_LIMIT/);
});
