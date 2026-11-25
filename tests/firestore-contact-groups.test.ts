import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'group-owner';
const GROUP_ID = 'family_group';
const GROUP_PATH = `users/${OWNER_ID}/contact_groups/${GROUP_ID}`;
let environment: RulesTestEnvironment;

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

const groupPayload = () => ({
  groupId: GROUP_ID,
  ownerId: OWNER_ID,
  name: 'Família',
  memberIds: ['connected-user-1'],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test('owner creates, reads, updates and deletes a private contact group', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, GROUP_PATH), groupPayload()));
  await assertSucceeds(getDoc(doc(owner, GROUP_PATH)));
  await assertSucceeds(
    updateDoc(doc(owner, GROUP_PATH), {
      name: 'Família próxima',
      memberIds: ['connected-user-1', 'connected-user-2'],
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(deleteDoc(doc(owner, GROUP_PATH)));
});

test('another authenticated user cannot read or mutate the group', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const outsider = environment.authenticatedContext('group-outsider').firestore();
  await assertSucceeds(setDoc(doc(owner, GROUP_PATH), groupPayload()));
  await assertFails(getDoc(doc(outsider, GROUP_PATH)));
  await assertFails(
    updateDoc(doc(outsider, GROUP_PATH), {
      name: 'Alteração indevida',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(deleteDoc(doc(outsider, GROUP_PATH)));
});

test('invalid group shapes and unauthenticated access are rejected', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      name: 'x'.repeat(61),
    })
  );
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      ownerId: 'another-owner',
    })
  );
  await assertFails(
    setDoc(doc(owner, GROUP_PATH), {
      ...groupPayload(),
      memberIds: Array.from({ length: 201 }, (_, index) => `user-${index}`),
    })
  );
  await assertFails(getDoc(doc(visitor, GROUP_PATH)));
});


test('staged social eligibility protects connections and direct messages while preserving disconnection', async () => {
  const a=OWNER_ID,b='connected-user-1',id=a+'_'+b;
  const sender=environment.authenticatedContext(a).firestore();
  const receiver=environment.authenticatedContext(b).firestore();
  const age=async(uid:string,status:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private',uid),{uid,status});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'social_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  const connection=doc(sender,'connections',id);
  const payload=()=>({senderId:a,receiverId:b,participantIds:[a,b],status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await assertFails(setDoc(connection,payload()));
  await age(a,'verified_adult');
  await assertFails(setDoc(connection,payload()));
  await age(b,'verified_adult');
  await assertSucceeds(setDoc(connection,payload()));
  const accept=()=>updateDoc(doc(receiver,'connections',id),{status:'accepted',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await age(a,'suspended');
  await assertFails(accept());
  await age(a,'verified_adult');
  await assertSucceeds(accept());
  const send=(key:string)=>setDoc(doc(sender,'social_chats',id,'messages',key),{senderId:a,receiverId:b,text:'Mensagem de teste',createdAt:serverTimestamp()});
  await age(b,'inconclusive');
  await assertFails(send('message-1'));
  await age(b,'verified_adult');
  await assertSucceeds(send('message-1'));
  await age(a,'suspended');
  await assertFails(send('message-2'));
  await assertSucceeds(getDoc(doc(sender,'social_chats',id,'messages','message-1')));
  await assertSucceeds(deleteDoc(connection));
});

test('staged contact group restriction preserves private access and deletion', async()=>{
  const owner=environment.authenticatedContext(OWNER_ID).firestore();
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'social_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  const group=doc(owner,GROUP_PATH);
  await assertFails(setDoc(group,groupPayload()));
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'age_eligibility_private',OWNER_ID),{uid:OWNER_ID,status:'verified_adult'});
  });
  await assertSucceeds(setDoc(group,groupPayload()));
  await environment.withSecurityRulesDisabled(async context=>{
    await updateDoc(doc(context.firestore(),'age_eligibility_private',OWNER_ID),{status:'suspended'});
  });
  await assertFails(updateDoc(group,{name:'Novo nome',updatedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(group));
  await assertSucceeds(deleteDoc(group));
});
