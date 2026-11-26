import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { evaluateKyrubMfa } from '../shared/kyrubMfaPolicy.js';
import { PROFILE_COMPLETION_CHALLENGE, evaluateProfileCompletion } from '../shared/profileCompletionChallenge.js';
import { assertKyrubChallengeDefinition } from '../shared/gamification.js';
import { projectPublicLegalDocument } from '../server/governance/publicLegalDocumentPolicy.js';
import type { GovernanceDocument } from '../shared/governance.js';

test('ordinary users do not require MFA; protected responsibilities fail closed', () => {
  const base = { authenticated: true, secondFactor: undefined, authTimeSeconds: 100,
    nowSeconds: 200, maxAgeSeconds: 120 };
  assert.equal(evaluateKyrubMfa({ ...base, responsibility: 'ordinary' }), 'allowed');
  assert.equal(evaluateKyrubMfa({ ...base, responsibility: 'ordinary', authenticated: false }), 'authentication_required');
  for (const responsibility of ['financial', 'administrative'] as const) {
    assert.equal(evaluateKyrubMfa({ ...base, responsibility }), 'second_factor_required');
    assert.equal(evaluateKyrubMfa({ ...base, responsibility, secondFactor: true }), 'second_factor_required');
    assert.equal(evaluateKyrubMfa({ ...base, responsibility, secondFactor: 'totp' }), 'allowed');
    for (const time of [79, 201, undefined, NaN]) {
      assert.equal(evaluateKyrubMfa({ ...base, responsibility, secondFactor: 'totp', authTimeSeconds: time }), 'reauthentication_required');
    }
  }
});

test('profile challenge draft is worth exactly 100 Pitangas once per verified adult', () => {
  assertKyrubChallengeDefinition(PROFILE_COMPLETION_CHALLENGE);
  assert.equal(PROFILE_COMPLETION_CHALLENGE.status, 'draft');
  assert.equal(PROFILE_COMPLETION_CHALLENGE.rewardKCoins, 100);
  assert.equal(PROFILE_COMPLETION_CHALLENGE.rewardXp, 0);
  assert.equal(PROFILE_COMPLETION_CHALLENGE.maxCompletionsPerUser, 1);
  const base = { uid: 'u1', ageStatus: 'verified_adult' as const, releaseApproved: true,
    challengeActive: true, receiptExists: false, displayName: 'Apelido', handle: 'apelido',
    handleOwnerUid: 'u1', bio: 'Apresentação' };
  assert.deepEqual(evaluateProfileCompletion(base), { eligible: true,
    idempotencyKey: 'profile_identity_completed:u1', rewardPitangas: 100 });
  for (const change of [{receiptExists:true}, {releaseApproved:false}, {challengeActive:false},
    {displayName:' '}, {handle:''}, {handleOwnerUid:'u2'}, {bio:' '},
    {ageStatus:'inconclusive' as const}, {ageStatus:'declared_adult' as const}]) {
    assert.deepEqual(evaluateProfileCompletion({...base,...change}), {eligible:false});
  }
});

test('public document projection rejects drafts, conflicts and modified content', () => {
  const content = 'Texto canônico de teste';
  const document: GovernanceDocument & {content: string} = {
    id:'terms-1', type:'terms', version:'1', status:'published', ownerUserId:'legal',
    createdAt:'2026-11-20T12:00:00Z', approvedAt:'2026-11-21T12:00:00Z',
    publishedAt:'2026-11-25T12:00:00Z',
    hash:createHash('sha256').update(content).digest('hex'), content,
  };
  assert.equal(projectPublicLegalDocument([document], 'terms')?.content, content);
  assert.equal(projectPublicLegalDocument([document], 'privacy'), null);
  for (const status of ['draft','legal_review','approved','superseded'] as const) {
    assert.equal(projectPublicLegalDocument([{...document,status}], 'terms'), null);
  }
  assert.equal(projectPublicLegalDocument([document,{...document,id:'terms-2'}], 'terms'), null);
  assert.equal(projectPublicLegalDocument([{...document,content:'Alterado'}], 'terms'), null);
  assert.equal(projectPublicLegalDocument([{...document,approvedAt:undefined}], 'terms'), null);
});

test('legacy governance writes cannot approve or overwrite ingress documents',async()=>{
 const {assertLegalDraftWrite}=await import('../server/governance/legalPublicationWritePolicy.js');
 const {readFileSync}=await import('node:fs');
 const content='Synthetic draft for tests';
 const draft:GovernanceDocument&{content:string}={
  id:'terms-2',type:'terms',version:'2',status:'draft',ownerUserId:'legal-owner',
  createdAt:'2026-11-25T12:00:00Z',hash:createHash('sha256').update(content).digest('hex'),content
 };
 assert.doesNotThrow(()=>assertLegalDraftWrite(draft,undefined));
 assert.doesNotThrow(()=>assertLegalDraftWrite(draft,{...draft}));
 for(const type of ['terms','privacy'] as const){
  const current={...draft,type};
  for(const status of ['legal_review','approved','published','superseded'] as const){
   assert.throws(()=>assertLegalDraftWrite({...current,status},undefined),/LEGAL_PUBLICATION_AUTHORITY_REQUIRED/);
   assert.throws(()=>assertLegalDraftWrite(current,{...current,status}),/LEGAL_DOCUMENT_IMMUTABLE/);
   assert.throws(()=>assertLegalDraftWrite({...current,type:'policy'},{...current,status}),/LEGAL_DOCUMENT_IMMUTABLE/);
  }
  assert.throws(()=>assertLegalDraftWrite({...current,content:'altered'},undefined),/LEGAL_DOCUMENT_INTEGRITY_INVALID/);
  assert.throws(()=>assertLegalDraftWrite({...current,version:'3'},{...current}),/LEGAL_DOCUMENT_IMMUTABLE/);
  assert.throws(()=>assertLegalDraftWrite({...current,publishedAt:'2026-11-25T12:00:00Z'},undefined),/LEGAL_PUBLICATION_AUTHORITY_REQUIRED/);
 }
 assert.doesNotThrow(()=>assertLegalDraftWrite({...draft,type:'policy'},undefined));
 const source=readFileSync('server/governance/governanceRepository.ts','utf8');
 assert.match(source,/assertLegalDraftWrite\(document, prior.data\(\)\)/);
 assert.match(source,/if \(isIngressLegalType\(current.type\)\) throw Error\('LEGAL_PUBLICATION_AUTHORITY_REQUIRED'\)/);
});

test('TOTP client adapter accepts six digit codes and provider-selected TOTP factors only',async()=>{
 const {validateKyrubTotpCode,isKyrubMfaChallenge,listTotpFactors}=await import('../src/utils/kyrubTotpAccess.js');
 assert.equal(validateKyrubTotpCode('012345'),'012345');
 for(const input of ['',123456,'12345','1234567','12a456',' 123456','123456 '])assert.throws(()=>validateKyrubTotpCode(input),/MFA_CODE_INVALID/);
 assert.equal(isKyrubMfaChallenge({code:'auth/multi-factor-auth-required'}),true);
 assert.equal(isKyrubMfaChallenge({code:'auth/wrong-password'}),false);
 assert.equal(isKyrubMfaChallenge(null),false);
 const hints=[{uid:'totp-1',factorId:'totp' as const,displayName:'Autenticador',enrollmentTime:'test'},{uid:'sms-1',factorId:'phone' as const,displayName:'SMS',enrollmentTime:'test'}];
 assert.deepEqual(listTotpFactors({hints}),[{id:'totp-1',label:'Autenticador'}]);
 const {readFileSync}=await import('node:fs');
 const source=readFileSync('src/utils/kyrubTotpAccess.ts','utf8');
 assert.doesNotMatch(source,/localStorage\.|sessionStorage\.|console\./);
 assert.match(source,/resolver\.resolveSignIn\(assertion\)/);
});

test('isolated TOTP enrollment reauthenticates first and does not bypass the second factor',async()=>{
 const {readFileSync}=await import('node:fs');
 const entry=readFileSync('src/components/OnboardingEmulatorEntry.tsx','utf8');
 const enrollment=readFileSync('src/components/KyrubTotpEnrollment.tsx','utf8');
 assert.match(entry,/status==='verified_adult'&&totpPreview&&<KyrubTotpEnrollment/);
 assert.match(entry,/VITE_KYRUB_ONBOARDING_EMULATOR==='true'&&import.meta.env.VITE_KYRUB_TOTP_PREVIEW==='true'/);
 assert.ok(enrollment.indexOf('await reauthenticateWithCredential')<enrollment.indexOf('await beginKyrubTotpEnrollment'));
 assert.match(enrollment,/await finishKyrubTotpEnrollment/);
 assert.match(enrollment,/setSecret\(null\)/);
 assert.doesNotMatch(enrollment,/localStorage|sessionStorage|console\.|unenroll\(/);
});

test('stored age eligibility denies mismatched identity, unknown capability and all non-adult restricted requests',async()=>{
 const {evaluateStoredCapabilityAgeAccess}=await import('../shared/ageEligibility.js');
 type Input=Parameters<typeof evaluateStoredCapabilityAgeAccess>[0];
 const capabilities:Input['capability'][]=['account_ingress','tag_publication','social_publication','social_comment','sowing','connections','messages','communities','tribes','store_erp','freelance','delivery','financial_operations','rewards','private_notes','private_tasks','appropriate_courses','private_tag_management'];
 const personal=new Set(['private_notes','private_tasks','appropriate_courses','private_tag_management']);
 for(const capability of capabilities){
  for(const status of ['pending','declared_adult','declared_underage','verified_adult','verified_underage','inconclusive','suspended','unexpected',undefined]){
   const input={actorUid:'owner',record:{uid:'owner',status},capability};
   assert.equal(evaluateStoredCapabilityAgeAccess(input),false);
   assert.equal(evaluateStoredCapabilityAgeAccess({...input,policy:'blocked'}),false);
   assert.equal(evaluateStoredCapabilityAgeAccess({...input,policy:'verified_adult_only'}),status==='verified_adult');
   assert.equal(evaluateStoredCapabilityAgeAccess({...input,policy:'reviewed_personal_only'}),personal.has(capability)&&(status==='verified_adult'||status==='inconclusive'));
  }
  for(const record of [undefined,{}, {uid:'other',status:'verified_adult'}]){
   assert.equal(evaluateStoredCapabilityAgeAccess({actorUid:'owner',record,capability,policy:'verified_adult_only'}),false);
  }
 }
 assert.equal(evaluateStoredCapabilityAgeAccess({actorUid:'',record:{uid:'',status:'verified_adult'},capability:'account_ingress',policy:'verified_adult_only'}),false);
 assert.equal(evaluateStoredCapabilityAgeAccess({actorUid:'owner',record:{uid:'owner',status:'verified_adult'},capability:'unknown' as Input['capability'],policy:'verified_adult_only'}),false);
});


test('profile award is isolated and cannot reach real Firebase even with the pilot flag',async()=>{
 const {profileCompletionPilotEnabled,grantIsolatedProfileCompletion}=await import('../server/gamification/profileCompletionAwardPilot.js');
 const db={projectId:'demo-kyrub-welcome'} as unknown as Parameters<typeof profileCompletionPilotEnabled>[0];
 const env={KYRUB_PROFILE_COMPLETION_PILOT:'true',NODE_ENV:'test',GCLOUD_PROJECT:'demo-kyrub-welcome',
  GOOGLE_CLOUD_PROJECT:'demo-kyrub-welcome',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'};
 assert.equal(profileCompletionPilotEnabled(db,env),true);
 for(const override of [{NODE_ENV:'production'},{VERCEL:'1'},{FIREBASE_SERVICE_ACCOUNT_JSON:'present'},
  {GOOGLE_APPLICATION_CREDENTIALS:'present'},{FIRESTORE_EMULATOR_HOST:'remote:8088'},
  {FIREBASE_AUTH_EMULATOR_HOST:''},{KYRUB_PROFILE_COMPLETION_PILOT:'false'},{GCLOUD_PROJECT:'kyrub-b8d0e'}])
  assert.equal(profileCompletionPilotEnabled(db,{...env,...override}),false);
 const remote={projectId:'kyrub-b8d0e'} as unknown as typeof db;
 assert.equal(profileCompletionPilotEnabled(remote,env),false);
 await assert.rejects(grantIsolatedProfileCompletion(remote,'u1'),/PROFILE_COMPLETION_RELEASE_UNAVAILABLE/);
});

test('profile award atomically credits once, validates saved evidence and refuses corrupt receipts in isolated zero-history fixture',async()=>{
 const {grantIsolatedProfileCompletion}=await import('../server/gamification/profileCompletionAwardPilot.js');
 const {emptyCurrencyCheckpoint}=await import('../server/gamification/semeaduraNoWelcomeAuthority.js');
 const {pitangaHistoricalMembershipDigest}=await import('../server/gamification/pitangaHistoricalMembership.js');
 const env={KYRUB_PROFILE_COMPLETION_PILOT:'true',NODE_ENV:'test',GCLOUD_PROJECT:'demo-kyrub-welcome',
  GOOGLE_CLOUD_PROJECT:'demo-kyrub-welcome',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  KYRUB_SEMEADURA_NO_WELCOME_PILOT:'true',KYRUB_PITANGA_WELCOME_PROJECT_ID:'demo-kyrub-welcome',
  KYRUB_PITANGA_WELCOME_FENCE_EPOCH:'welcome-emulator-only',KYRUB_WELCOME_BONUS_EFFECTIVE_AT:'2026-11-15T00:00:00.000Z'};
 const keys=[...Object.keys(env),'VERCEL','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,env);for(const k of keys.filter(k=>!(k in env)))delete process.env[k];
  const uid='profile-test',root='users/'+uid,epoch='welcome-emulator-only',challenge=PROFILE_COMPLETION_CHALLENGE.id;
  const balance=root+'/pitangaBalance/balance',award=root+'/rewardLedger/earn_'+challenge,receipt=root+'/challengeRewards/'+challenge;
  const checkpoint=emptyCurrencyCheckpoint(uid);
  const records=new Map<string,Record<string,unknown>>([
   ['systemControl/pitangaLegacyWriterFence',{status:'fenced',writersVerified:true,epoch}],
   ['age_eligibility_private/'+uid,{uid,status:'verified_adult'}],
   ['global_challenges/'+challenge,{...PROFILE_COMPLETION_CHALLENGE,status:'active'}],
   [balance,{userId:uid,availableKCoins:0,migrationEpoch:epoch}],
   [root+'/pitangaMigration/receipt',{userId:uid,fenceEpoch:epoch,balance:0,entryCount:0,ledgerSha256:checkpoint.ledgerSha256,
    historicalMembershipSha256:pitangaHistoricalMembershipDigest({userId:uid,entryIds:[]})}],
  ]);
  const ref=(path:string):any=>({path,id:path.split('/').pop(),collection:(n:string)=>ref(path+'/'+n),doc:(n:string)=>ref(path+'/'+n)});
  const snap=(path:string)=>({id:path.split('/').pop(),exists:records.has(path),data:()=>records.get(path),get:(key:string)=>records.get(path)?.[key]});
  let writes=0;
  const db={projectId:'demo-kyrub-welcome',collection:ref,doc:ref,runTransaction:async(fn:(tx:any)=>Promise<unknown>)=>{
   const staged:Array<()=>void>=[];
   const result=await fn({get:async(r:any)=>r.path===root+'/rewardLedger'
    ?{docs:[...records.keys()].filter(p=>p.startsWith(r.path+'/')).map(snap)}
    :snap(r.path),update:(r:any,data:Record<string,unknown>)=>staged.push(()=>{records.set(r.path,{...records.get(r.path),...data});writes++;}),
    create:(r:any,data:Record<string,unknown>)=>staged.push(()=>{assert.equal(records.has(r.path),false);records.set(r.path,data);writes++;})});
   staged.forEach(write=>write());return result;
  }} as unknown as Parameters<typeof grantIsolatedProfileCompletion>[0];
  const profile=root+'/public_profile/main',reverse='public_social_address_targets/profile:'+uid,forward='public_social_addresses/profile:apelido';
  const identity={kind:'profile',identifier:'apelido',targetId:uid};
  records.set(root,{name:'Apelido',isProfileVisible:false,email:'apelido@example.test'});
  records.set(profile,{userId:uid,name:'Apelido',bio:'Apresentação'});
  const grant=()=>grantIsolatedProfileCompletion(db,uid);
  // A matching email and saved profile do not prove ownership.
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(reverse,identity);
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(forward,{...identity,targetId:'other'});
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(forward,identity);
  records.set(profile,{userId:'other',name:'Apelido',bio:'Apresentação'});
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(profile,{userId:uid,name:'Apelido',bio:' '});
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(profile,{userId:uid,name:'Outro',bio:'Apresentação'});
  await assert.rejects(grant(),/NOT_ELIGIBLE/);
  records.set(profile,{userId:uid,name:'Apelido',bio:'Apresentação'});
  records.set('age_eligibility_private/'+uid,{uid,status:'declared_adult'});
  await assert.rejects(grant(),/AGE_REQUIRED/);
  records.set('age_eligibility_private/'+uid,{uid,status:'verified_adult'});
  assert.equal(writes,0);
  assert.deepEqual(await grant(),{replay:false,pitangas:100,xp:0,balance:100});
  assert.equal(writes,3);assert.equal(records.get(award)?.deltaKCoins,100);assert.equal(records.get(receipt)?.xp,0);
  records.delete(profile);
  assert.deepEqual(await grant(),{replay:true,pitangas:100,xp:0,balance:100});
  assert.equal(writes,3);assert.equal([...records.keys()].some(p=>p.includes('/xpLedger/')||p.includes('first_login_v1')),false);
  records.delete(receipt);
  await assert.rejects(grant(),/RECEIPT_CONFLICT/);assert.equal(writes,3);
 }finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
