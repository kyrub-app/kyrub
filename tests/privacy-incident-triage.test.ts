import assert from 'node:assert/strict';
import {test} from 'node:test';
import {triagePrivacyIncident as triage} from '../shared/privacyIncidentTriage';
const now=Date.UTC(2026,10,27),knownAt=now-1000;
const fixture={simulation:true,personalDataAffected:'yes',significantImpact:'yes',riskFactors:['financial'],factorAssessmentComplete:true,knownAt};
test('cumulative risk criteria trigger urgent human review, never automatic communication',()=>{
 assert.deepEqual(triage(fixture,now),{status:'urgent-notification-review',clockStart:knownAt,simulation:true,automaticNotification:false});
 assert.equal(triage({...fixture,riskFactors:[]},now).status,'document-human-review');
 assert.equal(triage({...fixture,significantImpact:'no'},now).status,'document-human-review');
 const unknown=triage({...fixture,significantImpact:'unknown'},now);
 assert.equal(unknown.status,'investigate');assert.equal(unknown.clockStart,knownAt);
 assert.equal(triage({...fixture,riskFactors:[],factorAssessmentComplete:false},now).status,'investigate');
 assert.equal(triage({...fixture,personalDataAffected:'unknown',knownAt:null},now).status,'investigate');
});
test('invalid or out-of-scope input cannot authorize communication',()=>{
 for(const invalid of [{...fixture,simulation:false},{...fixture,knownAt:null},{...fixture,knownAt:now+1},{...fixture,riskFactors:['invalid']},{...fixture,personalDataAffected:'no'},{...fixture,rawData:'not-allowed'},{...fixture,riskFactors:['financial','financial']}]){
  const r=triage(invalid,now);assert.equal(r.status,'invalid');assert.equal(r.automaticNotification,false);
 }
});
