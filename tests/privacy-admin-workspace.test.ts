import assert from 'node:assert/strict';
import {test} from 'node:test';
import {privacyAdminActions,type PrivacyAdminItem} from '../shared/privacyAdminWorkspace';
const item:PrivacyAdminItem={protocol:'00000000-0000-4000-8000-000000000000',draft:{right:'access',context:'ecosystem',confirmed:true},receivedAt:1,revision:0,triageStatus:'pending-review',identityStatus:'pending-verification',actionStatus:'not-executed',evidenceStatus:'awaiting-evidence',assessmentRevision:0};
test('workspace only offers relevant actions; server remains authority',()=>{
 assert.deepEqual(privacyAdminActions(item),{triage:true,assess:false,prepare:false,review:false});
 const triaged={...item,revision:1,triageStatus:'verification-required' as const};
 assert.equal(privacyAdminActions(triaged).assess,true);
 assert.equal(privacyAdminActions({...triaged,draft:{...item.draft,right:'other'}}).assess,false);
 const assessed={...triaged,assessmentRevision:1,assessmentFinding:'ready-for-fulfillment-review' as const};
 assert.deepEqual(privacyAdminActions(assessed),{triage:false,assess:false,prepare:true,review:false});
 assert.equal(privacyAdminActions({...assessed,responseStatus:'draft'}).review,false);
 assert.equal(privacyAdminActions({...assessed,responseStatus:'draft',responseRevision:1}).review,true);
 assert.equal(privacyAdminActions({...assessed,responseStatus:'reviewed',responseRevision:2}).review,false);
});
