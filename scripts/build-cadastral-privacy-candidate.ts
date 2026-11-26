import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Candidate generator only. No Firebase SDK, credentials, network or deployment.
export function buildCadastralPrivacyCandidate(baseline:string):string{
 const root=/match \/users\/\{userId\}\s*\{\s*allow read: if isSignedIn\(\);/g;
 assert.equal([...baseline.matchAll(root)].length,1);
 // Do not change the actual rules artifact or deploy the candidate.
 let rules=baseline.replace(root,"match /users/{userId} {\n allow get: if isSignedIn() && request.auth.uid == userId;\n allow list: if false;");
 const start=rules.indexOf('match /users/{userId}/public_profile/{profileId}');
 assert.ok(start>=0);
 const end=rules.indexOf('allow read: if isSignedIn();',start);
 assert.ok(end>=0&&end-start<3000);
 rules=rules.slice(0,end)+`allow get: if isSignedIn() && profileId == 'main' &&
 (request.auth.uid == userId || (exists(/databases/$(database)/documents/users/$(userId)) &&
 get(/databases/$(database)/documents/users/$(userId)).data.isProfileVisible == true));
 allow list: if false;`+rules.slice(end+'allow read: if isSignedIn();'.length);
 // Simulate the coordinated cutover only in this emulator process.
 const memberStart=rules.indexOf('match /members/{userId} {');
 assert.ok(memberStart>=0);
 const memberCreate=rules.indexOf('allow create: if isSignedIn()',memberStart);
 assert.ok(memberCreate>=0&&memberCreate-memberStart<1000);
 const memberEnd=rules.indexOf(';',memberCreate);
 assert.ok(memberEnd>memberCreate&&memberEnd-memberCreate<1500);
 const original=rules.slice(memberCreate,memberEnd+1);
 assert.ok(original.includes("incoming().status == 'invited'")&&original.includes('storeSecActorCanManageRole'));
 rules=rules.slice(0,memberCreate)+'allow create: if false;'+rules.slice(memberEnd+1);
 // New social connections must target a currently public profile. Existing
 // participant reads and responses must not depend on discovery visibility.
 const connectionStart=rules.indexOf('match /connections/{connectionId} {');
 assert.ok(connectionStart>=0);
 const connectionCreate=rules.indexOf('allow create: if isSignedIn()',connectionStart);
 assert.ok(connectionCreate>=0&&connectionCreate-connectionStart<2500);
 const createPrefix='allow create: if isSignedIn()';
 rules=rules.slice(0,connectionCreate)+createPrefix+
  '\n    && exists(/databases/$(database)/documents/users/$(incoming().receiverId))'+
  '\n    && get(/databases/$(database)/documents/users/$(incoming().receiverId)).data.isProfileVisible == true'+
  rules.slice(connectionCreate+createPrefix.length);
 return rules;
}

export function candidateSha256(value:string):string{
 return createHash('sha256').update(value,'utf8').digest('hex');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const baseline=readFileSync('.firebase/firestore.combined.rules','utf8');
 const candidate=buildCadastralPrivacyCandidate(baseline);
 const dir='.firebase/privacy-review-only';
 mkdirSync(dir,{recursive:true});
 writeFileSync(dir+'/cadastral-candidate.rules.txt',candidate,'utf8');
 writeFileSync(dir+'/manifest.json',JSON.stringify({
  purpose:'emulator-and-review-only',deployable:false,
  baselineSha256:candidateSha256(baseline),candidateSha256:candidateSha256(candidate)
 },null,2)+'\n','utf8');
}
