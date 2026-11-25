import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let environment: RulesTestEnvironment;
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'kyrub-security-test',
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1', port: 8088,
    },
  });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'age_eligibility_private', 'age_test_owner'), {
      uid: 'age_test_owner', status: 'declared_underage', method: 'self_declaration',
      policyVersion: 'test', recordedAt: '2026-11-25T00:00:00.000Z',
    });
  });
});
after(async () => {
  if (environment) await environment.cleanup();
});

test('age status is not readable or writable directly by any client', async () => {
  const clients = [
    environment.unauthenticatedContext(),
    environment.authenticatedContext('age_test_owner'),
    environment.authenticatedContext('age_test_other'),
    environment.authenticatedContext('age_test_admin', { role: 'admin' }),
  ];
  for (const context of clients) {
    const db = context.firestore();
    const ref = doc(db, 'age_eligibility_private', 'age_test_owner');
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db, 'age_eligibility_private')));
    await assertFails(updateDoc(ref, { status: 'verified_adult' }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db, 'age_eligibility_private', 'age_test_forged'), {
      uid: 'age_test_forged', status: 'verified_adult',
    }));
  }
  await environment.withSecurityRulesDisabled(async context => {
    const snap = await getDoc(doc(context.firestore(), 'age_eligibility_private', 'age_test_owner'));
    assert.equal(snap.data()?.status, 'declared_underage');
  });
});

test('restricted personal preview is not accessible directly through Firestore clients', async () => {
  const collectionId='restricted_personal_preview';
  const ownerId='age_test_owner';
  const recordId=ownerId+'_notes';
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),collectionId,recordId),{uid:ownerId,kind:'notes',items:[{id:'example',text:'private test',done:false}]});
  });
  for(const context of [environment.unauthenticatedContext(),environment.authenticatedContext(ownerId),environment.authenticatedContext('age_test_other'),environment.authenticatedContext('age_test_admin',{role:'admin'})]){
    const db=context.firestore(),ref=doc(db,collectionId,recordId);
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db,collectionId)));
    await assertFails(updateDoc(ref,{items:[]}));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db,collectionId,'forged_notes'),{uid:ownerId,kind:'notes',items:[]}));
  }
});
