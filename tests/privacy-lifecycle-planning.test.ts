import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planFixturePreferenceLifecycle as plan,FIXTURE_PREFERENCE_REVIEW_MS as window} from '../shared/privacyLifecyclePlanning';
const end=Date.UTC(2026,10,1),now=end+window;
const fixture={category:'fixture-temporary-preference',simulation:true,purposeEndedAt:end,recordCount:4,estimatedBytes:1024,dependenciesChecked:true,copiesInventoried:true};
test('review window is synthetic and never grants deletion authority',()=>{
 assert.equal(plan({...fixture,purposeEndedAt:null},now).status,'retain');
 assert.equal(plan(fixture,now-1).status,'retain');
 assert.equal(plan(fixture,now).status,'review-candidate');
 assert.equal(plan(fixture,now).authorizesDeletion,false);
 assert.equal(plan(fixture,now).estimatedBytes,1024);
 assert.equal(plan({...fixture,dependenciesChecked:false},now).status,'blocked');
 assert.equal(plan({...fixture,copiesInventoried:false},now).status,'blocked');
});
test('reject non-fixtures, personal identifiers, invalid times and counts',()=>{
 for(const invalid of [{...fixture,simulation:false},{...fixture,category:'account'},{...fixture,category:'logs'},{...fixture,ownerUid:'fixture'},{...fixture,recordCount:-1},{...fixture,estimatedBytes:Infinity},{...fixture,purposeEndedAt:now+1},{...fixture,dependenciesChecked:'true'}]){
  const result=plan(invalid,now);assert.equal(result.status,'blocked');assert.equal(result.authorizesDeletion,false);assert.equal(result.recordCount,0);
 }
 assert.equal(plan(fixture,NaN).status,'blocked');
});
