import assert from 'node:assert/strict';
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
  collectionGroup,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const STORE_ID = 'store-directory-a';
let environment: RulesTestEnvironment;

const storeRecord = () => ({
  id: STORE_ID,
  ownerId: 'owner-directory',
  name: 'Loja Diretório',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId: 'owner-directory',
  migrationStatus: 'registry_only',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const invitedMember = (userId: string) => ({
  storeId: STORE_ID,
  storeName: 'Loja Diretório',
  userId,
  displayName: 'Usuário convidado',
  email: `${userId}@example.com`,
  photoUrl: '',
  role: 'seller',
  status: 'invited',
  invitedBy: 'owner-directory',
  invitedAt: Timestamp.fromMillis(1_700_000_000_000),
  acceptedAt: '',
  suspendedAt: '',
  removedAt: '',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
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
});

after(async () => {
  await environment.cleanup();
});

test('owner creates and queries all stores owned by the same Kyrub account', async () => {
  const owner = environment.authenticatedContext('owner-directory').firestore();

  await assertSucceeds(
    setDoc(doc(owner, 'stores', STORE_ID), {
      ...storeRecord(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  const snapshot = await assertSucceeds(
    getDocs(
      query(
        collection(owner, 'stores'),
        where('ownerId', '==', 'owner-directory')
      )
    )
  );
  assert.equal(snapshot.size, 1);
  assert.equal(snapshot.docs[0]?.id, STORE_ID);
});

test('an invited user lists only their membership and accepts the invitation', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, 'stores', STORE_ID), storeRecord());
    await setDoc(
      doc(database, 'stores', STORE_ID, 'members', 'seller-directory'),
      invitedMember('seller-directory')
    );
    await setDoc(
      doc(database, 'stores', STORE_ID, 'members', 'another-user'),
      invitedMember('another-user')
    );
  });

  const seller = environment.authenticatedContext('seller-directory').firestore();
  const memberships = await assertSucceeds(
    getDocs(
      query(
        collectionGroup(seller, 'members'),
        where('userId', '==', 'seller-directory')
      )
    )
  );
  assert.equal(memberships.size, 1);

  await assertSucceeds(
    updateDoc(
      doc(seller, 'stores', STORE_ID, 'members', 'seller-directory'),
      {
        status: 'active',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    )
  );
});

test('an invited user may decline without receiving operational access', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, 'stores', STORE_ID), storeRecord());
    await setDoc(
      doc(database, 'stores', STORE_ID, 'members', 'decline-user'),
      invitedMember('decline-user')
    );
  });

  const invited = environment.authenticatedContext('decline-user').firestore();
  await assertSucceeds(
    updateDoc(doc(invited, 'stores', STORE_ID, 'members', 'decline-user'), {
      status: 'removed',
      removedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
});


test('staged ERP age control protects store creation and staff admission while permitting decline',async()=>{
  const ownerId='owner-directory',staffId='seller-directory';
  const owner=environment.authenticatedContext(ownerId).firestore();
  const staff=environment.authenticatedContext(staffId).firestore();
  const age=async(uid:string,status:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private',uid),{uid,status});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'erp_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  const store=doc(owner,'stores',STORE_ID);
  const create=()=>setDoc(store,{...storeRecord(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await assertFails(create());
  await age(ownerId,'verified_adult');
  await assertSucceeds(create());
  const staffRef=doc(owner,'stores',STORE_ID,'members',staffId);
  const invite=()=>setDoc(staffRef,{...invitedMember(staffId),invitedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await assertFails(invite());
  await age(staffId,'verified_adult');
  await assertSucceeds(invite());
  await age(staffId,'suspended');
  const ownMembership=doc(staff,'stores',STORE_ID,'members',staffId);
  await assertFails(updateDoc(ownMembership,{status:'active',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ownMembership,{status:'removed',removedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(owner,'erp_age_release_private','current'),{schemaVersion:1,mode:'disabled'}));
});
