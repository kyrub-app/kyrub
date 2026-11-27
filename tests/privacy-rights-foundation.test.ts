import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PRIVACY_RIGHTS,PRIVACY_CONTEXTS,normalizePrivacyRequest} from '../shared/privacyRights';
import {preparePrivacyRequest,projectPrivacyReceipt} from '../server/governance/privacyRightsPolicy';
const now=Date.UTC(2026,10,26,12),channel={reference:'fixture-channel-reference-001',verifiedAt:now-1000};
test('all rights and contexts are available without requiring an account',()=>{
 for(const right of Object.keys(PRIVACY_RIGHTS))for(const context of Object.keys(PRIVACY_CONTEXTS)){
  const record=preparePrivacyRequest({right,context,confirmed:true},channel,now);
  assert.equal(record.identityStatus,'pending-verification');assert.equal(record.actionStatus,'not-executed');
  const receipt=projectPrivacyReceipt(record);
  assert.equal(receipt.status,'received');assert.equal(receipt.simulated,true);
  assert.ok(!JSON.stringify(receipt).includes(channel.reference));
 }
});
test('client cannot attach identity, documents, narrative, or change status',()=>{
 const draft={right:'access',context:'thirdParty',confirmed:true};
 for(const extra of [{uid:'another-user'},{document:'fixture'},{email:'fixture@example.invalid'},{status:'completed'},{consent:true},{receivedAt:now}])assert.throws(()=>normalizePrivacyRequest({...draft,...extra}));
 assert.throws(()=>normalizePrivacyRequest({...draft,confirmed:false}));
 assert.throws(()=>normalizePrivacyRequest({...draft,right:'unknown'}));
 assert.throws(()=>normalizePrivacyRequest({...draft,context:'unknown'}));
 assert.throws(()=>preparePrivacyRequest(draft,{...channel,verifiedAt:now+1},now));
 assert.throws(()=>preparePrivacyRequest(draft,{...channel,verifiedAt:now-900001},now));
 assert.throws(()=>preparePrivacyRequest(draft,{...channel,reference:'short'},now));
 assert.throws(()=>projectPrivacyReceipt({...preparePrivacyRequest(draft,channel,now),actionStatus:'completed'} as never));
});
