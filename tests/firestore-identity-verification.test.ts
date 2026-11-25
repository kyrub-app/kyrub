import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;

const verification = (uid: string, status: 'draft' | 'submitted' = 'submitted') => ({
  uid,
  status,
  requestedProfiles: ['freelancer', 'bicycle_courier'],
  approvedProfiles: [],
  fullName: 'Pessoa Teste',
  cpf: '52998224725',
  address: 'Rua Teste, 100, São Paulo - SP',
  whatsapp: '11999999999',
  documentType: 'cin',
  documentPaths: [`identity-verification/${uid}/document/id.jpg`],
  selfiePath: `identity-verification/${uid}/selfie/selfie.jpg`,
  cnhCategory: '',
  cnhHasEar: false,
  consentVersion: '2026-08-01',
  reviewReason: '',
  reviewedBy: '',
  reviewedAt: null,
  submittedAt: status === 'submitted' ? serverTimestamp() : null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'kyrub_admin',
        'control_plane',
        'admins',
        'compliance_a'
      ),
      {
        uid: 'compliance_a',
        email: 'compliance@example.com',
        displayName: 'Compliance',
        role: 'compliance',
        status: 'active',
        createdBy: 'bootstrap_admin',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
        suspendedAt: '',
        revokedAt: '',
      }
    );
  });
});

after(async () => {
  await environment.cleanup();
});

test('the owner can submit and read only their own verification', async () => {
  const owner = environment.authenticatedContext('user_a').firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'identity_verifications', 'user_a'), verification('user_a'))
  );
  await assertSucceeds(
    getDoc(doc(owner, 'identity_verifications', 'user_a'))
  );

  const outsider = environment.authenticatedContext('user_b').firestore();
  await assertFails(
    getDoc(doc(outsider, 'identity_verifications', 'user_a'))
  );
});

test('the owner cannot approve themselves or change protected review fields', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'identity_verifications', 'user_a'),
      {
        ...verification('user_a'),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        submittedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const owner = environment.authenticatedContext('user_a').firestore();
  await assertFails(
    updateDoc(doc(owner, 'identity_verifications', 'user_a'), {
      status: 'approved',
      approvedProfiles: ['freelancer'],
      reviewedBy: 'user_a',
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});

test('compliance can review a bounded list and approve requested profiles', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'identity_verifications', 'user_a'),
      {
        ...verification('user_a'),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        submittedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const compliance = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(
    getDocs(query(collection(compliance, 'identity_verifications'), limit(100)))
  );
  await assertSucceeds(
    updateDoc(doc(compliance, 'identity_verifications', 'user_a'), {
      status: 'approved',
      approvedProfiles: ['freelancer', 'bicycle_courier'],
      reviewReason: '',
      reviewedBy: 'compliance_a',
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const owner = environment.authenticatedContext('user_a').firestore();
  await assertFails(
    updateDoc(doc(owner, 'identity_verifications', 'user_a'), {
      address: 'Outro endereço',
      updatedAt: serverTimestamp(),
    })
  );
});


test('staged Renda age gate requires civil identity AND verified adulthood for direct hiring', async()=>{
  const requesterId='requester-age',freelancerId='freelancer-age';
  const requester=environment.authenticatedContext(requesterId,{role:'owner'}).firestore();
  const freelancer=environment.authenticatedContext(freelancerId).firestore();
  const vacancy=doc(requester,'vagas','AgeVacancy0000000001');
  const application=doc(freelancer,'candidaturas','AgeVacancy0000000001__freelancer-age');
  const vacancyPayload={ownerId:requesterId,title:'Vaga de homologacao',status:'open'};
  const applicationPayload={userId:freelancerId,vagaId:'AgeVacancy0000000001',ownerId:requesterId,status:'pending'};
  const age=async(uid:string,status:string,recordUid=uid)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private',uid),{uid:recordUid,status});
    });
  };
  const approve=async(uid:string,profile:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'identity_verifications',uid),{uid,status:'approved',approvedProfiles:[profile]});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'renda_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  await approve(requesterId,'requester');
  await approve(freelancerId,'freelancer');
  await assertFails(setDoc(vacancy,vacancyPayload));
  await assertFails(setDoc(application,applicationPayload));
  await age(requesterId,'declared_adult');
  await age(freelancerId,'inconclusive');
  await assertFails(setDoc(vacancy,vacancyPayload));
  await assertFails(setDoc(application,applicationPayload));
  await age(requesterId,'verified_adult',freelancerId);
  await assertFails(setDoc(vacancy,vacancyPayload));
  await age(requesterId,'verified_adult');
  await age(freelancerId,'verified_adult');
  await approve(requesterId,'freelancer');
  await assertFails(setDoc(vacancy,vacancyPayload));
  await approve(requesterId,'requester');
  await assertSucceeds(setDoc(vacancy,vacancyPayload));
  await approve(freelancerId,'requester');
  await assertFails(setDoc(application,applicationPayload));
  await approve(freelancerId,'freelancer');
  await assertFails(setDoc(application,{...applicationPayload,userId:requesterId}));
  await assertSucceeds(setDoc(application,applicationPayload));
  await age(freelancerId,'suspended');
  await assertFails(setDoc(doc(freelancer,'candidaturas','AgeVacancy0000000001__freelancer-age-other'),applicationPayload));
  await assertFails(setDoc(doc(requester,'renda_age_release_private','current'),{mode:'disabled'}));
});


test('freelance vacancy and application ownership cannot be forged or used across contractors',async()=>{
  const ownerId='hiring-owner',otherId='hiring-other',workerId='hiring-worker';
  const owner=environment.authenticatedContext(ownerId,{role:'owner'}).firestore();
  const other=environment.authenticatedContext(otherId,{role:'owner'}).firestore();
  const worker=environment.authenticatedContext(workerId).firestore();
  await environment.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const [uid,profile] of [[ownerId,'requester'],[otherId,'requester'],[workerId,'freelancer']]){
      await setDoc(doc(db,'identity_verifications',uid),{uid,status:'approved',approvedProfiles:[profile]});
      await setDoc(doc(db,'age_eligibility_private',uid),{uid,status:'verified_adult'});
    }
    await setDoc(doc(db,'renda_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  const vacancy=(db:any)=>doc(db,'vagas','OwnedVacancy00000001');
  await assertFails(setDoc(vacancy(other),{ownerId,title:'Impersonacao'}));
  await assertSucceeds(setDoc(vacancy(owner),{ownerId,title:'Vaga real',status:'open'}));
  await assertFails(updateDoc(vacancy(other),{title:'Alteracao indevida'}));
  await assertFails(deleteDoc(vacancy(other)));
  await assertFails(updateDoc(vacancy(owner),{ownerId:otherId}));
  const application=(db:any)=>doc(db,'candidaturas','OwnedVacancy00000001__hiring-worker');
  const payload={ownerId,userId:workerId,vagaId:'OwnedVacancy00000001',status:'pending'};
  await assertFails(setDoc(application(worker),{...payload,ownerId:otherId}));
  await assertFails(setDoc(application(worker),{...payload,vagaId:'missing'}));
  await assertFails(setDoc(application(worker),{...payload,status:'accepted'}));
  await assertSucceeds(setDoc(application(worker),payload));
  await assertFails(updateDoc(application(worker),{status:'accepted'}));
  await assertFails(getDoc(application(other)));
  await assertSucceeds(getDoc(application(owner)));
  await assertSucceeds(getDoc(application(worker)));
  await assertFails(updateDoc(application(other),{status:'accepted'}));
  await assertFails(updateDoc(application(worker),{ownerId:otherId}));
  await assertFails(updateDoc(application(worker),{vagaId:'missing'}));
  await assertFails(deleteDoc(application(other)));
  await assertSucceeds(updateDoc(application(owner),{status:'accepted'}));
  await assertSucceeds(deleteDoc(application(worker)));
  await assertSucceeds(deleteDoc(vacancy(owner)));
});
