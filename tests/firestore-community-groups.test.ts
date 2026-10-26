import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const communityId = 'community_a';
const groupId = 'group_a';
const groupPath = ['community_groups', groupId] as const;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'kyrub-group-security-test',
    firestore: { rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'), host: '127.0.0.1', port: 8088 },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'communities', communityId), { ownerId: 'owner', visibility: 'public' });
    for (const userId of ['owner', 'member', 'outsider']) {
      await setDoc(doc(db, 'community_members', communityId + '__' + userId), { communityId, userId, status: 'active' });
    }
  });
});
after(async () => env.cleanup());

const groupData = (memberIds: string[]) => ({
  groupId, communityId, creatorId: 'owner', name: 'Equipe',
  memberIds, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
});
const dbFor = (uid: string) => env.authenticatedContext(uid).firestore();
const seedGroup = async (members: string[]) => env.withSecurityRulesDisabled(async context => {
  await setDoc(doc(context.firestore(), ...groupPath), groupData(members));
});

test('creator may create private group; non-member cannot read it', async () => {
  await assertSucceeds(setDoc(doc(dbFor('owner'), ...groupPath), groupData(['owner'])));
  await seedGroup(['owner', 'member']);
  await assertSucceeds(getDoc(doc(dbFor('member'), ...groupPath)));
  await assertFails(getDoc(doc(dbFor('outsider'), ...groupPath)));
});
test('nonmember cannot create a group under another creator ID', async () => {
  await assertFails(setDoc(doc(dbFor('outsider'), ...groupPath), groupData(['owner', 'member'])));
});
test('group membership cannot be rewritten by client', async () => {
  await seedGroup(['owner', 'member']);
  await assertFails(updateDoc(doc(dbFor('owner'), ...groupPath), { memberIds: ['owner', 'outsider'] }));
});
test('only group members may post and read messages', async () => {
  await setDoc(doc(dbFor('owner'), ...groupPath), groupData(['owner', 'member']));
  const message = (uid: string) => ({ authorId: uid, text: 'Olá', createdAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(dbFor('member'), ...groupPath, 'messages', 'one'), message('member')));
  await assertSucceeds(getDoc(doc(dbFor('owner'), ...groupPath, 'messages', 'one')));
  await assertFails(getDoc(doc(dbFor('outsider'), ...groupPath, 'messages', 'one')));
  await assertFails(setDoc(doc(dbFor('outsider'), ...groupPath, 'messages', 'two'), message('outsider')));
  await assertFails(setDoc(doc(dbFor('member'), ...groupPath, 'messages', 'three'), message('owner')));
});
test('revoked community member loses access even if listed in group', async () => {
  await setDoc(doc(dbFor('owner'), ...groupPath), groupData(['owner', 'member']));
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'community_members', communityId + '__member'), { status: 'pending' });
  });
  await assertFails(getDoc(doc(dbFor('member'), ...groupPath)));
});

test('scoped group listing returns only memberships in selected community', async () => {
  await setDoc(doc(dbFor('owner'), ...groupPath), groupData(['owner', 'member']));
  const q = query(
    collection(dbFor('member'), 'community_groups'),
    where('communityId', '==', communityId),
    where('memberIds', 'array-contains', 'member')
  );
  const snapshot = await assertSucceeds(getDocs(q));
  if (snapshot.size !== 1) throw new Error('Expected one private group.');
  const outsiderQuery = query(
    collection(dbFor('outsider'), 'community_groups'),
    where('communityId', '==', communityId),
    where('memberIds', 'array-contains', 'member')
  );
  await assertFails(getDocs(outsiderQuery));
});

test('creator cannot add arbitrary community UIDs at group creation', async () => {
  await assertFails(setDoc(doc(dbFor('owner'), ...groupPath), groupData(['owner', 'outsider'])));
});
