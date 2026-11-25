import assert from 'node:assert/strict';
import { after, test } from 'node:test';

// This is a transactional integration test, never a production Firebase test.
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.VERCEL;

const { adminDb } = await import('../server/firebaseAdmin.js');
const { sendNotifiedSocialMessage } = await import('../server/notifications/socialChatNotificationService.js');
const { issueNoteInvitationNotification } = await import('../server/notifications/noteInvitationNotificationService.js');
const { listUserNotifications, markUserNotificationRead } = await import('../server/notifications/userNotificationService.js');

after(async () => {
  await adminDb.terminate();
});

test('authenticated social participants get one DM and one bell alert for retried send', async () => {
  const connectionId = 'notif_dm_accepted';
  const senderId = 'notif_dm_sender';
  const receiverId = 'notif_dm_receiver';
  const messageId = 'notif_dm_message_1';
  await adminDb.doc('connections/' + connectionId).set({
    senderId, receiverId, participantIds: [senderId, receiverId], status: 'accepted',
  });
  const input = { senderId, receiverId, connectionId, messageId, text: 'Oi! Convite para conversar.' };
  const [first, second] = await Promise.all([
    sendNotifiedSocialMessage(input),
    sendNotifiedSocialMessage(input),
  ]);
  assert.deepEqual(new Set([first.created, second.created]), new Set([true, false]));
  const message = await adminDb.doc('social_chats/' + connectionId + '/messages/' + messageId).get();
  assert.equal(message.get('senderId'), senderId);
  assert.equal(message.get('receiverId'), receiverId);
  assert.equal(message.get('text'), input.text);
  assert.ok(message.get('createdAt'));

  const inbox = await listUserNotifications({ recipientUserId: receiverId });
  const alerts = inbox.notifications.filter(n => n.category === 'social_chat');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].target.kind, 'social_chat');
  assert.equal(alerts[0].target.connectionId, connectionId);
  assert.equal(alerts[0].actorPrincipalId, senderId);
  assert.equal(inbox.unreadCount, 1);
  assert.equal((await listUserNotifications({recipientUserId: senderId})).unreadCount, 0);
  await markUserNotificationRead({recipientUserId: receiverId, notificationId: alerts[0].id});
  assert.equal((await listUserNotifications({recipientUserId: receiverId})).unreadCount, 0);
  await assert.rejects(
    sendNotifiedSocialMessage({ ...input, senderId: 'third_party', messageId: 'forged_message' }),
    /SOCIAL_CHAT_FORBIDDEN/,
  );
  await assert.rejects(
    sendNotifiedSocialMessage({ ...input, text: 'replaced text' }),
    /SOCIAL_CHAT_MESSAGE_CONFLICT/,
  );
  assert.equal((await adminDb.collection('social_chats/' + connectionId + '/messages').get()).size, 1);
});

test('real pending note invitation notifies only its recipient, once', async () => {
  const ownerId = 'notif_note_owner';
  const recipientId = 'notif_note_recipient';
  const noteId = 'notif_note_1';
  const invitationId = ownerId + '__' + noteId + '__' + recipientId;
  await adminDb.doc('users/' + ownerId + '/tasks/' + noteId).set({
    ownerId, title: 'Nota de colaboração', sharedWith: [recipientId],
  });
  await adminDb.doc('note_invitations/' + invitationId).set({
    ownerId, recipientId, noteId,
    sourcePath: 'users/' + ownerId + '/tasks/' + noteId, status: 'pending',
  });
  assert.deepEqual(await issueNoteInvitationNotification({ownerId, invitationId}), {created: true});
  assert.deepEqual(await issueNoteInvitationNotification({ownerId, invitationId}), {created: false});

  const inbox = await listUserNotifications({recipientUserId: recipientId});
  const invitations = inbox.notifications.filter(n => n.category === 'note_invitation');
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].target.kind, 'note_invitation');
  assert.equal(invitations[0].target.noteInvitationId, invitationId);
  assert.equal(invitations[0].actorPrincipalId, ownerId);
  assert.equal((await listUserNotifications({recipientUserId: ownerId})).unreadCount, 0);

  await assert.rejects(
    issueNoteInvitationNotification({ownerId: 'third_party', invitationId}),
    /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/,
  );
  await adminDb.doc('note_invitations/' + invitationId).update({status: 'revoked'});
  await assert.rejects(
    issueNoteInvitationNotification({ownerId, invitationId}),
    /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/,
  );
  assert.equal((await listUserNotifications({recipientUserId: recipientId})).notifications.length, 1);
});

test('a fabricated or revoked invite cannot trigger an alert for an unrelated user', async () => {
  const ownerId = 'notif_untrusted_owner';
  const recipientId = 'notif_untrusted_recipient';
  const noteId = 'notif_untrusted_note';
  const invitationId = ownerId + '__' + noteId + '__' + recipientId;
  await adminDb.doc('users/' + ownerId + '/tasks/' + noteId).set({
    ownerId, title: 'Privada', sharedWith: ['someone_else'],
  });
  await adminDb.doc('note_invitations/' + invitationId).set({
    ownerId, noteId, recipientId, sourcePath: 'users/' + ownerId + '/tasks/' + noteId,
    status: 'pending',
  });
  await assert.rejects(issueNoteInvitationNotification({ownerId, invitationId}), /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/);
  assert.equal((await listUserNotifications({recipientUserId: recipientId})).notifications.length, 0);
});


test('Freela negotiation message and private bell receipt are atomic and idempotent',async()=>{
  const {sendNotifiedHiringMessage}=await import('../server/notifications/freelanceNotificationService.js');
  const workerId='notif_freela_worker',ownerId='notif_freela_owner';
  const vagaId='Notification00000001',applicationId=vagaId+'__'+workerId;
  const control=adminDb.doc('renda_age_release_private/current');
  const receipt=adminDb.doc('candidaturas/'+applicationId);
  const oldFlag=process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW;
  const oldAuth=process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const oldControl=await control.get();
  process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW='true';
  // Only Firestore is exercised by this service test; token verification is a
  // separate HTTP boundary. The local Auth address cannot route to production.
  process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
  try{
   await control.set({schemaVersion:1,mode:'verified_adult_only',messageAuthority:'server'});
   await receipt.set({vagaId,ownerId,userId:workerId,status:'pending'});
   await adminDb.doc('age_eligibility_private/'+workerId).set({uid:workerId,status:'verified_adult'});
   await adminDb.doc('identity_verifications/'+workerId).set({uid:workerId,status:'approved',approvedProfiles:['freelancer']});
   const input={actorId:workerId,actorRole:undefined,applicationId,messageId:'freela-message-1',text:'Condições privadas'};
   const results=await Promise.all([sendNotifiedHiringMessage(input),sendNotifiedHiringMessage(input)]);
   assert.deepEqual(new Set(results.map(r=>r.created)),new Set([true,false]));
   const inbox=await listUserNotifications({recipientUserId:ownerId});
   assert.equal(inbox.notifications.length,1);
   assert.equal(inbox.notifications[0].target.hiringApplicationId,applicationId);
   assert.equal(inbox.notifications[0].category,'freelance');
   assert.ok(!JSON.stringify(inbox).includes(input.text));
   assert.equal((await listUserNotifications({recipientUserId:workerId})).unreadCount,0);
   await assert.rejects(sendNotifiedHiringMessage({...input,text:'sobrescrita'}),/FREELANCE_CONFLICT/);
   await assert.rejects(sendNotifiedHiringMessage({...input,actorId:'other',messageId:'forged'}),/FREELANCE_FORBIDDEN/);
   await adminDb.doc('age_eligibility_private/'+workerId).update({status:'suspended'});
   await assert.rejects(sendNotifiedHiringMessage({...input,messageId:'blocked'}),/FREELANCE_FORBIDDEN/);
   assert.equal((await receipt.collection('messages').get()).size,1);
   assert.equal((await listUserNotifications({recipientUserId:ownerId})).unreadCount,1);
  }finally{
   if(oldFlag===undefined)delete process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW;else process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW=oldFlag;
   if(oldAuth===undefined)delete process.env.FIREBASE_AUTH_EMULATOR_HOST;else process.env.FIREBASE_AUTH_EMULATOR_HOST=oldAuth;
   if(oldControl.exists)await control.set(oldControl.data()!);else await control.delete();
  }
});


test('Freela lifecycle writes one immutable event and one recipient alert per accepted action',async()=>{
 const {performNotifiedHiringAction}=await import('../server/notifications/freelanceNotificationService.js');
 const ownerId='lifecycle_owner',workerId='lifecycle_worker',vagaId='Lifecycle00000000001',applicationId=vagaId+'__'+workerId;
 const control=adminDb.doc('renda_age_release_private/current');
 const original=await control.get();
 const oldFlag=process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW,oldAuth=process.env.FIREBASE_AUTH_EMULATOR_HOST;
 process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW='true';
 process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
 const receipt=adminDb.doc('candidaturas/'+applicationId);
 const terms={schemaVersion:1,title:'Vaga fictícia',description:'Turno de teste',paymentCents:10000,currency:'BRL'};
 const action=(actorId:string,action:string,operationId:string,expectedTerms=terms)=>performNotifiedHiringAction({actorId,actorRole:actorId===ownerId?'owner':undefined,action,operationId,applicationId,expectedTerms});
 try{
  await control.set({schemaVersion:1,mode:'verified_adult_only',messageAuthority:'server',applicationAuthority:'server'});
  await adminDb.doc('vagas/'+vagaId).set({ownerId,status:'open',title:terms.title,description:terms.description,payment:100});
  for(const [uid,profile] of [[ownerId,'requester'],[workerId,'freelancer']]){
   await adminDb.doc('age_eligibility_private/'+uid).set({uid,status:'verified_adult'});
   await adminDb.doc('identity_verifications/'+uid).set({uid,status:'approved',approvedProfiles:[profile]});
  }
  await assert.rejects(action(workerId,'apply','stale-apply',{...terms,paymentCents:9000}),/FREELANCE_CONFLICT/);
  const initial=await Promise.all([action(workerId,'apply','apply-1'),action(workerId,'apply','apply-1')]);
  assert.deepEqual(new Set(initial.map(r=>r.created)),new Set([true,false]));
  await assert.rejects(action(workerId,'apply','apply-2'),/FREELANCE_CONFLICT/);
  await assert.rejects(action(workerId,'accept','forged-accept'),/FREELANCE_FORBIDDEN/);
  await assert.rejects(action(ownerId,'complete','early-complete'),/FREELANCE_CONFLICT/);
  await adminDb.doc('vagas/'+vagaId).update({payment:200,description:'Alterada depois da candidatura'});
  await assert.rejects(action(ownerId,'accept','wrong-terms',{...terms,paymentCents:20000}),/FREELANCE_CONFLICT/);
  await action(ownerId,'accept','accept-1');
  await assert.rejects(action(ownerId,'accept','accept-1',{...terms,paymentCents:20000}),/FREELANCE_CONFLICT/);
  assert.deepEqual((await receipt.get()).get('terms'),terms);
  await action(workerId,'request_completion','request-1');
  await action(ownerId,'request_review','review-1');
  await action(workerId,'request_completion','request-2');
  await action(ownerId,'complete','complete-1');
  assert.equal((await action(workerId,'request_completion','request-1')).created,false);
  assert.equal((await receipt.get()).get('status'),'completed');
  assert.equal((await receipt.get()).get('paymentStatus'),undefined);
  assert.deepEqual((await receipt.get()).get('terms'),terms);
  assert.ok((await receipt.get()).get('acceptedAt'));
  assert.equal((await receipt.collection('operations_private').get()).size,6);
  const owner=await listUserNotifications({recipientUserId:ownerId});
  const worker=await listUserNotifications({recipientUserId:workerId});
  assert.equal(owner.notifications.length,3);
  assert.equal(worker.notifications.length,3);
  assert.equal(owner.notifications.filter(n=>n.eventType==='request_completion').length,2);
  assert.ok([...owner.notifications,...worker.notifications].every(n=>n.category==='freelance'&&n.target.hiringApplicationId===applicationId));
 }finally{
  if(oldFlag===undefined)delete process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW;else process.env.KYRUB_FREELANCE_NOTIFICATION_PREVIEW=oldFlag;
  if(oldAuth===undefined)delete process.env.FIREBASE_AUTH_EMULATOR_HOST;else process.env.FIREBASE_AUTH_EMULATOR_HOST=oldAuth;
  if(original.exists)await control.set(original.data()!);else await control.delete();
 }
});


test('staged social age policy governs Admin SDK messages and tribe invitations atomically',async()=>{
 const {issueCommunityGroupInvitation}=await import('../server/notifications/communityGroupInvitationIssueService.js');
 const {respondToCommunityGroupInvitation}=await import('../server/notifications/communityGroupInvitationResponseService.js');
 const senderId='age_social_sender',receiverId='age_social_receiver',thirdId='age_social_third';
 const connectionId='age_social_connection',communityId='age_social_community',groupId='age_social_tribe';
 const control=adminDb.doc('social_age_release_private/current');
 const oldControl=await control.get();
 const age=(uid:string)=>adminDb.doc('age_eligibility_private/'+uid);
 const group=adminDb.doc('community_groups/'+groupId);
 const invite=group.collection('invitations').doc(receiverId);
 const message=adminDb.doc('social_chats/'+connectionId+'/messages/age_message');
 const input={senderId,receiverId,connectionId,messageId:'age_message',text:'Mensagem sintética'};
 const invitation={groupId,inviterUserId:senderId,inviteeUserId:receiverId};
 try{
  await control.set({schemaVersion:1,mode:'verified_adult_only'});
  await age(senderId).set({uid:senderId,status:'verified_adult'});
  await age(receiverId).set({uid:receiverId,status:'inconclusive'});
  await age(thirdId).set({uid:thirdId,status:'verified_adult'});
  await adminDb.doc('connections/'+connectionId).set({senderId,receiverId,participantIds:[senderId,receiverId],status:'accepted'});
  await group.set({creatorId:senderId,communityId,memberIds:[senderId],name:'Tribo de teste'});
  for(const uid of [senderId,receiverId,thirdId])await adminDb.doc('community_members/'+communityId+'__'+uid).set({communityId,userId:uid,status:'active'});
  await assert.rejects(sendNotifiedSocialMessage(input),/SOCIAL_CHAT_FORBIDDEN/);
  await assert.rejects(issueCommunityGroupInvitation(invitation),/COMMUNITY_GROUP_INVITATION_FORBIDDEN/);
  assert.equal((await message.get()).exists,false);
  assert.equal((await invite.get()).exists,false);
  assert.equal((await listUserNotifications({recipientUserId:receiverId})).notifications.length,0);
  await age(receiverId).set({uid:thirdId,status:'verified_adult'});
  await assert.rejects(sendNotifiedSocialMessage(input),/SOCIAL_CHAT_FORBIDDEN/);
  await age(receiverId).set({uid:receiverId,status:'verified_adult'});
  await control.set({schemaVersion:2,mode:'verified_adult_only'});
  await assert.rejects(issueCommunityGroupInvitation(invitation),/COMMUNITY_GROUP_INVITATION_FORBIDDEN/);
  await assert.rejects(sendNotifiedSocialMessage(input),/SOCIAL_CHAT_FORBIDDEN/);
  await control.set({schemaVersion:1,mode:'verified_adult_only'});
  assert.equal((await sendNotifiedSocialMessage(input)).created,true);
  assert.equal((await issueCommunityGroupInvitation(invitation)).created,true);
  await age(receiverId).update({status:'suspended'});
  await assert.rejects(respondToCommunityGroupInvitation({groupId,recipientUserId:receiverId,decision:'accepted'}),/COMMUNITY_GROUP_INVITATION_FORBIDDEN/);
  assert.equal((await invite.get()).get('status'),'pending');
  assert.deepEqual((await group.get()).get('memberIds'),[senderId]);
  assert.equal((await sendNotifiedSocialMessage(input)).created,false);
  await assert.rejects(sendNotifiedSocialMessage({...input,messageId:'age_message_new'}),/SOCIAL_CHAT_FORBIDDEN/);
  assert.deepEqual(await respondToCommunityGroupInvitation({groupId,recipientUserId:receiverId,decision:'declined'}),{status:'declined'});
  await issueCommunityGroupInvitation({...invitation,inviteeUserId:thirdId});
  assert.deepEqual(await respondToCommunityGroupInvitation({groupId,recipientUserId:thirdId,decision:'accepted'}),{status:'accepted'});
  assert.deepEqual((await group.get()).get('memberIds'),[senderId,thirdId]);
 }finally{
  if(oldControl.exists)await control.set(oldControl.data()!);else await control.delete();
 }
});
