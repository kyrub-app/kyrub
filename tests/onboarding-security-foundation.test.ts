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
