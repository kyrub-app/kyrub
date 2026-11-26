// Emulator-only adapter. Fixture proofs represent previously verified identities;
// they are NOT a real passkey, recipient verification or emitter authentication.
// No public route, production adminDb, or real notification provider.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,type Transaction,type DocumentReference} from 'firebase-admin/firestore';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {createCidOccurrenceChat,issueCidChatInvite,redeemCidChatInvite,openCidChatSession,authorizeCidChatSession,prepareCidChatMessage,closeCidChat,projectCidChat,type CidChat,type ChatInvite,type ChatSession,type ChatMessage} from './cidOccurrenceChatAccess.js';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge,assertUnusedTagPasskeyChallenge,type TagPasskeyChallenge} from './kyrubTagPasskeyPolicy.js';
import {tagAuthenticationOptions,verifyTagAuthentication,type StoredTagPasskey} from './kyrubTagPasskeyVerifier.js';
import {assertSamePasskeyCredential} from './kyrubTagPasskeyState.js';
import type {AuthenticationResponseJSON} from '@simplewebauthn/server';
import type {CidSosOccurrence,CidSosMessage} from './cidSosAlertPolicy.js';
import {normalizeCidSosResolution,cidSosResolutionNotice} from '../../shared/cidSosResolution.js';
import {buildTrustedCidSosProfile,type TrustedTag,type CidSosConfig,type ChannelGrant} from './cidSosPrivateConfig.js';
type ContactRoute={participantId:string;channel:'email'|'whatsapp'|'sms';address:string;verifiedAt:number};
type ContactChallenge={id:string;inviteId:string;chatId:string;tagId:string;route:ContactRoute;digest:string;expiresAt:number;attempts:number;usedAt?:number};
const CONTACT_TTL=5*60*1000;
const randomToken=()=>randomBytes(32).toString('base64url');
const matches=(secret:unknown,hash:unknown)=>secretId(secret)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&timingSafeEqual(Buffer.from(digest(secret),'hex'),Buffer.from(hash,'hex'));

const APP='cid-chat-local-emulator';
export const CID_CHAT_EMULATOR_ORIGIN='https://kyrub-cid-emulator.vercel.app';
type OwnerChallenge=TagPasskeyChallenge&{occurrenceId:string;credentialVersion:string;attempts:number};
const deny=():never=>{throw Error('CID_CHAT_FORBIDDEN');};
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const secretId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const digest=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
type ProofKind='owner-passkey'|'emitter-session'|'contact-channel'|'delivery-service';
type FixtureProof={kind:ProofKind;chatId:string;tagId:string;memberId:string;digest:string;expiresAt:number;usedAt?:number};
type Credential={id:string;secret:string};
export function createCidChatEmulatorStore(tagId:string,occurrenceId:string){
 assertCidSosEmulator();
 if(!isTagId(tagId)||!safeId(occurrenceId)||occurrenceId.length<22||occurrenceId.length>80)return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),tag=db.collection('cid_sos_emulator_tags').doc(tagId);
 const occurrence=tag.collection('occurrences').doc(occurrenceId);
 const root=occurrence.collection('chat').doc('state');
 const proofs=root.collection('fixtureProofs'),invites=root.collection('invites'),sessions=root.collection('sessions'),messages=root.collection('messages');
 const ownerChallenges=root.collection('ownerChallenges'),contactChallenges=root.collection('contactChallenges'),contactQuotas=root.collection('contactQuotas');
 async function currentContactRoute(tx:Transaction,chat:CidChat,participantId:string,channel:ContactRoute['channel'],now:number){
  const [o,t,c,g]=await Promise.all([tx.get(occurrence),tx.get(tag),tx.get(tag.collection('private').doc('config')),tx.get(tag.collection('private').doc('grants'))]);
  const data=o.data() as CidSosOccurrence|undefined, trusted=t.get('tag') as TrustedTag|undefined,config=c.get('config') as CidSosConfig|undefined,grants=g.get('grants') as ChannelGrant[]|undefined;
  if(!data||data.id!==chat.id||data.tagId!==tagId||data.ownerId!==chat.ownerId||!trusted||trusted.tagId!==tagId||trusted.ownerId!==chat.ownerId||!config||!Array.isArray(grants)||!chat.members.some(m=>m.id===participantId&&m.role==='contact'))return deny();
  const profile=buildTrustedCidSosProfile(trusted,config,grants,now);
  const candidate=profile.contacts.find(p=>p.id===participantId)?.channels.find(r=>r.channel===channel);
  if(!candidate||!data.recipients.some(r=>r.role==='contact'&&r.participantId===participantId&&r.channel===channel&&r.address===candidate.address))return deny();
  return {participantId,channel,address:candidate.address,verifiedAt:candidate.verifiedAt};
 }
 const sameRoute=(a:ContactRoute,b:ContactRoute)=>a.participantId===b.participantId&&a.channel===b.channel&&a.address===b.address&&a.verifiedAt===b.verifiedAt;
 function assertInvite(invite:ChatInvite|undefined,credential:Credential,chat:CidChat,now:number){
  if(!invite||invite.id!==credential.id||invite.chatId!==chat.id||invite.usedAt!==undefined||invite.revokedAt!==undefined||chat.closedAt!==undefined||now<invite.createdAt||now>=invite.expiresAt||!matches(credential.secret,invite.digest))return deny();return invite;
 }
 const liveTag=db.collection('kyrub_official_tags').doc(tagId),liveCredential=db.collection('kyrub_tag_passkey_credentials').doc(tagId);
 const quota=db.collection('cid_sos_emulator_owner_quotas').doc(tagId);
 async function ownerCredential(tx:Transaction,chat:CidChat){
  const [t,c]=await Promise.all([tx.get(liveTag),tx.get(liveCredential)]);
  const stored=c.get('credential') as StoredTagPasskey|undefined;
  if(t.get('ownerId')!==chat.ownerId||t.get('ownerAuthMode')!=='passkey'||t.get('enabled')!==true||t.get('blocked')===true||c.get('ownerId')!==chat.ownerId||!stored||typeof stored.id!=='string'||!c.updateTime)return deny();
  const index=await tx.get(db.collection('kyrub_tag_passkey_credential_index').doc(digest(stored.id)));
  if(index.get('tagId')!==tagId||index.get('ownerId')!==chat.ownerId||index.get('revokedAt')!=null)return deny();
  return {stored,version:c.updateTime.seconds+':'+c.updateTime.nanoseconds};
 }
 function ref(collection:FirebaseFirestore.CollectionReference,id:unknown){
  if(!safeId(id))return deny();return collection.doc(id);
 }
 function checkNow(now:number){assertCidSosEmulator();if(!Number.isSafeInteger(now)||now<=0)return deny();}
 async function readProof(tx:Transaction,credential:Credential,kind:ProofKind,now:number){
  if(!credential||!secretId(credential.id)||!secretId(credential.secret))return deny();
  const reference=proofs.doc(credential.id),s=await tx.get(reference),p=s.data() as FixtureProof|undefined;
  if(!p||p.kind!==kind||p.tagId!==tagId||p.chatId!==occurrenceId||!safeId(p.memberId)||p.usedAt!==undefined||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||typeof p.digest!=='string'||!/^[a-f0-9]{64}$/.test(p.digest)||!timingSafeEqual(Buffer.from(p.digest,'hex'),Buffer.from(digest(credential.secret),'hex')))return deny();
  return {reference,proof:p};
 }
 async function readChat(tx:Transaction){
  const s=await tx.get(root),chat=s.data() as CidChat|undefined;
  if(!chat||chat.id!==occurrenceId||chat.tagId!==tagId)return deny();return chat;
 }
 async function readSession(tx:Transaction,credential:Credential,now:number){
  if(!credential||!secretId(credential.id)||!secretId(credential.secret))return deny();
  const reference=sessions.doc(credential.id),s=await tx.get(reference),session=s.data() as ChatSession|undefined;
  if(!session||session.id!==credential.id||session.chatId!==occurrenceId)return deny();
  const ownerKey=s.get('ownerCredentialId');
  if(ownerKey!==undefined){
   const chat=await readChat(tx),current=await ownerCredential(tx,chat);
   if(session.memberId!==chat.ownerId||current.stored.id!==ownerKey)return deny();
  }
  const route=s.get('contactRoute') as ContactRoute|undefined;
  if(route){const chat=await readChat(tx);if(session.memberId!==route.participantId||!sameRoute(route,await currentContactRoute(tx,chat,route.participantId,route.channel,now)))return deny();}
  return {reference,session};
 }
 function consume(tx:Transaction,reference:DocumentReference,now:number){tx.update(reference,{usedAt:now});}
 return {
  async start(emitterProof:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [o,existing,p]=await Promise.all([tx.get(occurrence),tx.get(root),readProof(tx,emitterProof,'emitter-session',now)]);
    const data=o.data() as CidSosOccurrence|undefined;
    if(!data||data.id!==occurrenceId||data.tagId!==tagId||existing.exists)return deny();
    const {chat,greeting}=createCidOccurrenceChat(data,p.proof.memberId,now);
    const opened=openCidChatSession(chat,p.proof.memberId,'emitter-session',now);
    tx.create(root,chat);tx.create(messages.doc(greeting.id),greeting);tx.create(sessions.doc(opened.record.id),opened.record);
    consume(tx,p.reference,now);
    return {id:opened.record.id,secret:opened.secret};
   });
  },
  async openOwner(ownerProof:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,p]=await Promise.all([readChat(tx),readProof(tx,ownerProof,'owner-passkey',now)]);
    if(p.proof.memberId!==chat.ownerId)return deny();
    const opened=openCidChatSession(chat,p.proof.memberId,'owner-passkey',now);
    tx.create(sessions.doc(opened.record.id),opened.record);consume(tx,p.reference,now);
    return {id:opened.record.id,secret:opened.secret};
   });
  },
  // Dedicated challenge namespace binds the signed ceremony to exactly this occurrence.
  // The existing production passkey lifecycle and public API are unchanged.
  async beginOwnerPasskey(origin:string,now:number){
   checkNow(now);
   const scope=isolatedTagPasskeyScope(CID_CHAT_EMULATOR_ORIGIN,origin);
   const issued=await db.runTransaction(async tx=>{
    checkNow(now);
    const chat=await readChat(tx),current=await ownerCredential(tx,chat),q=await tx.get(quota);
    const bucket=Math.floor(now/60000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=6)return deny();
    const record:OwnerChallenge={...issueTagPasskeyChallenge({tagId,purpose:'identify-owner',ownerId:chat.ownerId,credentialId:current.stored.id,scope},now),occurrenceId,credentialVersion:current.version,attempts:0};
    tx.set(quota,{bucket,count:count+1});
    tx.create(ownerChallenges.doc(record.id),record);
    return {record,stored:current.stored};
   });
   return {challengeId:issued.record.id,options:await tagAuthenticationOptions(issued.record,issued.stored,now)};
  },
  async finishOwnerPasskey(origin:string,challengeId:string,response:AuthenticationResponseJSON,now:number){
   checkNow(now);if(!secretId(challengeId))return deny();
   const scope=isolatedTagPasskeyScope(CID_CHAT_EMULATOR_ORIGIN,origin),reference=ownerChallenges.doc(challengeId);
   const initial=await db.runTransaction(async tx=>{
    checkNow(now);
    const chat=await readChat(tx),current=await ownerCredential(tx,chat),s=await tx.get(reference);
    const record=s.data() as OwnerChallenge|undefined;
    if(!record||record.id!==challengeId||record.occurrenceId!==occurrenceId||record.credentialVersion!==current.version||!Number.isSafeInteger(record.attempts)||record.attempts<0||record.attempts>=3)return deny();
    assertUnusedTagPasskeyChallenge(record,{tagId,purpose:'identify-owner',ownerId:chat.ownerId,credentialId:current.stored.id,scope},now);
    tx.update(reference,{attempts:record.attempts+1});
    return {record,stored:current.stored};
   });
   const next=await verifyTagAuthentication(initial.record,initial.stored,response,now);
   return db.runTransaction(async tx=>{
    checkNow(now);
    const chat=await readChat(tx),current=await ownerCredential(tx,chat),s=await tx.get(reference);
    const record=s.data() as OwnerChallenge|undefined;
    if(!record||record.id!==challengeId||record.occurrenceId!==occurrenceId||record.challenge!==initial.record.challenge||record.credentialVersion!==current.version||record.attempts!==initial.record.attempts+1)return deny();
    assertUnusedTagPasskeyChallenge(record,{tagId,purpose:'identify-owner',ownerId:chat.ownerId,credentialId:current.stored.id,scope},now);
    assertSamePasskeyCredential(initial.stored,current.stored);
    const opened=openCidChatSession(chat,chat.ownerId,'owner-passkey',now);
    tx.update(liveCredential,{credential:next,lastVerifiedAt:new Date(now).toISOString()});
    tx.update(reference,{usedAt:now});
    tx.create(sessions.doc(opened.record.id),{...opened.record,ownerCredentialId:next.id});
    return {id:opened.record.id,secret:opened.secret};
   });
  },
  async issueInvite(deliveryProof:Credential,recipientId:string,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,p]=await Promise.all([readChat(tx),readProof(tx,deliveryProof,'delivery-service',now)]);
    if(p.proof.memberId!==recipientId)return deny();
    const issued=issueCidChatInvite(chat,recipientId,now);
    tx.create(invites.doc(issued.record.id),issued.record);consume(tx,p.reference,now);
    return {id:issued.record.id,secret:issued.secret};
   });
  },
  async redeem(invitation:Credential,recipientProof:Credential,now:number){
   checkNow(now);if(!invitation||!secretId(invitation.id))return deny();
   return db.runTransaction(async tx=>{
    checkNow(now);
    const reference=invites.doc(invitation.id);
    const [chat,s,p]=await Promise.all([readChat(tx),tx.get(reference),readProof(tx,recipientProof,'contact-channel',now)]);
    const invite=s.data() as ChatInvite|undefined;
    if(!invite||invite.id!==invitation.id)return deny();
    const result=redeemCidChatInvite(chat,invite,invitation.secret,p.proof.memberId,now);
    tx.update(reference,{usedAt:result.invite.usedAt});consume(tx,p.reference,now);
    tx.create(sessions.doc(result.session.record.id),result.session.record);
    return {id:result.session.record.id,secret:result.session.secret};
   });
  },
  // Internal worker only. The returned envelope is for the authorized delivery adapter,
  // never an HTTP response. No real provider is called and no clear secret is persisted.
  async prepareContactInvitationForDelivery(participantId:string,channel:ContactRoute['channel'],now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const chat=await readChat(tx),route=await currentContactRoute(tx,chat,participantId,channel,now);
    const issued=issueCidChatInvite(chat,participantId,now);
    tx.create(invites.doc(issued.record.id),{...issued.record,contactRoute:route});
    return {simulation:true as const,route,invitation:{id:issued.record.id,secret:issued.secret}};
   });
  },
  // Requesting a second confirmation cannot change the delivery destination.
  // Only the internal simulated delivery envelope contains the confirmation secret.
  async prepareContactConfirmationForDelivery(credential:Credential,now:number){
   checkNow(now);if(!credential||!secretId(credential.id))return deny();
   return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),tx.get(invites.doc(credential.id))]);
    const invite=assertInvite(s.data() as ChatInvite|undefined,credential,chat,now);
    const bound=s.get('contactRoute') as ContactRoute|undefined;
    if(!bound||bound.participantId!==invite.memberId)return deny();
    const route=await currentContactRoute(tx,chat,bound.participantId,bound.channel,now);
    if(!sameRoute(bound,route))return deny();
    const quotaRef=contactQuotas.doc(invite.memberId),q=await tx.get(quotaRef);
    const bucket=Math.floor(now/600000),count=q.get('bucket')===bucket?q.get('count'):0;
    if(!Number.isSafeInteger(count)||count<0||count>=3)return deny();
    const secret=randomToken(),id=randomToken();
    const record:ContactChallenge={id,inviteId:invite.id,chatId:chat.id,tagId,route,digest:digest(secret),expiresAt:Math.min(invite.expiresAt,now+CONTACT_TTL),attempts:0};
    tx.set(quotaRef,{bucket,count:count+1});
    tx.create(contactChallenges.doc(id),record);
    return {simulation:true as const,publicResult:{challengeId:id},deliveryEnvelope:{route,secret}};
   });
  },
  async confirmContact(invitation:Credential,challengeId:string,confirmationSecret:unknown,now:number){
   checkNow(now);if(!invitation||!secretId(invitation.id)||!secretId(challengeId))return deny();
   const result=await db.runTransaction(async tx=>{
    checkNow(now);
    const inviteRef=invites.doc(invitation.id),challengeRef=contactChallenges.doc(challengeId);
    const [chat,i,c]=await Promise.all([readChat(tx),tx.get(inviteRef),tx.get(challengeRef)]);
    const invite=assertInvite(i.data() as ChatInvite|undefined,invitation,chat,now),challenge=c.data() as ContactChallenge|undefined;
    const bound=i.get('contactRoute') as ContactRoute|undefined;
    if(!bound||!challenge||challenge.id!==challengeId||challenge.inviteId!==invite.id||challenge.chatId!==chat.id||challenge.tagId!==tagId||challenge.usedAt!==undefined||!Number.isSafeInteger(challenge.expiresAt)||now>=challenge.expiresAt||!Number.isSafeInteger(challenge.attempts)||challenge.attempts<0||challenge.attempts>=3||!sameRoute(bound,challenge.route)||bound.participantId!==invite.memberId)return deny();
    const route=await currentContactRoute(tx,chat,bound.participantId,bound.channel,now);
    if(!sameRoute(bound,route))return deny();
    if(!matches(confirmationSecret,challenge.digest)){
     tx.update(challengeRef,{attempts:challenge.attempts+1});return null;
    }
    const redeemed=redeemCidChatInvite(chat,invite,invitation.secret,route.participantId,now);
    tx.update(inviteRef,{usedAt:now});tx.update(challengeRef,{usedAt:now,attempts:challenge.attempts+1});
    tx.create(sessions.doc(redeemed.session.record.id),{...redeemed.session.record,contactRoute:route});
    return {id:redeemed.session.record.id,secret:redeemed.session.secret};
   });
   if(!result)return deny();return result;
  },
  async send(credential:Credential,input:unknown,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential,now)]);
    const message=prepareCidChatMessage(chat,s.session,credential.secret,input,now);
    const reference=ref(messages,message.id),previous=await tx.get(reference);
    if(previous.exists){
     const prior=previous.data() as ChatMessage;
     if(prior.chatId!==chat.id||prior.authorId!==message.authorId||prior.kind!=='message'||prior.body!==message.body)return deny();
     return {accepted:true as const,duplicate:true};
    }
    tx.create(reference,message);
    return {accepted:true as const,duplicate:false};
   });
  },
  async read(credential:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential,now)]);
    const view=projectCidChat(chat,s.session,credential.secret,now);
    const [o,snapshot]=await Promise.all([tx.get(occurrence),tx.get(messages.orderBy('createdAt','desc').limit(101))]);
    const data=o.data() as CidSosOccurrence|undefined;
    if(!data||data.id!==chat.id||data.tagId!==tagId||data.ownerId!==chat.ownerId)return deny();
    const contacts=chat.members.filter(m=>m.role==='contact');
    return {...view,reason:data.reason,...(data.resolution?{resolution:data.resolution}:{}),hasOlderMessages:snapshot.size>100,messages:snapshot.docs.slice(0,100).map(d=>{
     const m=d.data() as ChatMessage;
     if(m.chatId!==chat.id||m.id!==d.id)return deny();
     const member=chat.members.find(p=>p.id===m.authorId);
     if(m.kind==='system'?m.authorId!=='system':!member)return deny();
     const authorLabel=m.kind==='system'?'Sistema':member?.role==='owner'?'Titular':member?.role==='emitter'?'Emissor do alerta':'Contato de emergência '+(contacts.findIndex(p=>p.id===m.authorId)+1);
     return {id:m.id,body:m.body,kind:m.kind,createdAt:m.createdAt,authorLabel,mine:m.authorId===s.session.memberId};
    }).reverse()};
   });
  },
  async close(credential:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential,now)]);
    const closed=closeCidChat(chat,s.session,credential.secret,now);
    tx.update(root,{closedAt:closed.closedAt});return {closed:true as const};
   });
  },
  async resolve(credential:Credential,input:unknown,now:number){
   checkNow(now);const resolution=normalizeCidSosResolution(input);
   return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s,o,t,c,g]=await Promise.all([readChat(tx),readSession(tx,credential,now),tx.get(occurrence),tx.get(tag),tx.get(tag.collection('private').doc('config')),tx.get(tag.collection('private').doc('grants'))]);
    const member=authorizeCidChatSession(chat,s.session,credential.secret,now,'read');
    if(member.role!=='owner'||member.id!==chat.ownerId)return deny();
    const data=o.data() as CidSosOccurrence|undefined,trusted=t.get('tag') as TrustedTag|undefined,config=c.get('config') as CidSosConfig|undefined,grants=g.get('grants') as ChannelGrant[]|undefined;
    if(!data||data.id!==chat.id||data.tagId!==tagId||data.ownerId!==chat.ownerId||!trusted||trusted.tagId!==tagId||trusted.ownerId!==chat.ownerId||now<data.createdAt)return deny();
    if(data.status==='resolved'&&chat.closedAt===data.resolvedAt&&data.resolution===resolution)return {closed:true as const,duplicate:true,queued:0};
    if(data.status!=='open'||chat.closedAt!==undefined)return deny();
    const profile=config&&Array.isArray(grants)?buildTrustedCidSosProfile(trusted,config,grants,now):null;
    if(data.recipients.length>12)return deny();
    const outbox=tag.collection('outbox');
    const rows=await Promise.all(data.recipients.map((_,i)=>tx.get(outbox.doc(digest(data.id+':alert:'+i)))));
    const updates:CidSosMessage[]=[];
    for(const [i,r] of data.recipients.entries()){
     const row=rows[i],key=data.id+':alert:'+i;
     if(!row.exists||row.get('message.key')!==key||row.get('message.recipient.participantId')!==r.participantId||row.get('message.recipient.role')!==r.role||row.get('message.recipient.channel')!==r.channel||row.get('message.recipient.address')!==r.address)return deny();
     if(row.get('status')==='simulation-delivered'&&r.role==='contact'&&profile?.contacts.some(p=>p.id===r.participantId&&p.channels.some(ch=>ch.channel===r.channel&&ch.address===r.address&&ch.consent===true))){
      updates.push({key:data.id+':resolution:'+i,recipient:r,kind:'resolution',text:'Kyrub CID: '+cidSosResolutionNotice(resolution)});
     }
    }
    const closed=closeCidChat(chat,s.session,credential.secret,now);
    tx.update(root,{closedAt:closed.closedAt});
    tx.update(occurrence,{status:'resolved',resolvedAt:now,resolution});
    tx.create(messages.doc(chat.id+'-resolution'),{id:chat.id+'-resolution',chatId:chat.id,authorId:'system',kind:'system',body:cidSosResolutionNotice(resolution),createdAt:now} satisfies ChatMessage);
    for(const message of updates)tx.create(outbox.doc(digest(message.key)),{message,status:'simulation-pending',createdAt:now});
    for(const row of rows)if(['simulation-pending','simulation-retry'].includes(row.get('status')))tx.update(row.ref,{status:'simulation-cancelled',completedAt:now,cancellationReason:'occurrence-closed'});
    return {closed:true as const,duplicate:false,queued:updates.length};
   });
  },
  async revokeOwnSession(credential:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential,now)]);
    authorizeCidChatSession(chat,s.session,credential.secret,now,'read');
    tx.update(s.reference,{revokedAt:now});return {revoked:true as const};
   });
  }
 };
}
