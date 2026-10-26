import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
let environment: RulesTestEnvironment;
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'kyrub-security-test', firestore: {
    rules: readFileSync(process.env.TEST_RULES_PATH || '.firebase/firestore.combined.rules', 'utf8'), host: '127.0.0.1', port: 8088,
  }});
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'candidaturas', 'application-a'), { userId: 'worker-a', vagaId: 'vacancy-a', status: 'pending' });
    await setDoc(doc(context.firestore(), 'identity_verifications', 'worker-a'), { status: 'approved', approvedProfiles: ['freelancer'] });
  });
});
after(async () => { await environment.cleanup(); });

test('only the candidate or admin can read; candidate queries must be scoped', async () => {
  const db = environment.authenticatedContext('worker-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'candidaturas', 'application-a')));
  await assertSucceeds(getDocs(query(collection(db, 'candidaturas'), where('userId', '==', 'worker-a'))));
  await assertFails(getDocs(collection(db, 'candidaturas')));
  const admin = environment.authenticatedContext('admin-a', { role: 'admin' }).firestore();
  await assertSucceeds(getDoc(doc(admin, 'candidaturas', 'application-a')));
  for (const role of ['owner', 'manager', 'staff']) {
    const other = environment.authenticatedContext('other-a', { role }).firestore();
    await assertFails(getDoc(doc(other, 'candidaturas', 'application-a')));
    await assertFails(updateDoc(doc(other, 'candidaturas', 'application-a'), { status: 'accepted' }));
    await assertFails(deleteDoc(doc(other, 'candidaturas', 'application-a')));
  }
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'candidaturas', 'application-a')));
});

test('clients cannot forge approvals, ownership, vacancy linkage or create even with verified freelancer identity', async () => {
  for (const [uid, claims] of [['worker-a', {}], ['admin-a', { role: 'admin' }]] as const) {
    const db = environment.authenticatedContext(uid, claims).firestore();
    await assertFails(setDoc(doc(db, 'candidaturas', 'new-a'), { userId: uid, vagaId: 'vacancy-a', status: 'pending' }));
    for (const change of [{ userId: 'other-a' }, { vagaId: 'other-vacancy' }, { status: 'accepted' }]) {
      await assertFails(updateDoc(doc(db, 'candidaturas', 'application-a'), change));
    }
    await assertFails(deleteDoc(doc(db, 'candidaturas', 'application-a')));
  }
});
