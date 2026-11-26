// Emulator-only adapter. Fixture proofs represent previously verified identities;
// they are NOT a real passkey, recipient verification or emitter authentication.
// No public route, production adminDb, or real notification provider.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,type Transaction,type DocumentReference} from 'firebase-admin/firestore';
import {createHash,timingSafeEqual} from 'node:crypto';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import {createCidOccurrenceChat,issueCidChatInvite,redeemCidChatInvite,openCidChatSession,authorizeCidChatSession,prepareCidChatMessage,closeCidChat,projectCidChat,type CidChat,type ChatInvite,type ChatSession,type ChatMessage} from './cidOccurrenceChatAccess.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';

const APP='cid-chat-local-emulator';
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
 async function readSession(tx:Transaction,credential:Credential){
  if(!credential||!secretId(credential.id)||!secretId(credential.secret))return deny();
  const reference=sessions.doc(credential.id),s=await tx.get(reference),session=s.data() as ChatSession|undefined;
  if(!session||session.id!==credential.id||session.chatId!==occurrenceId)return deny();
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
  async send(credential:Credential,input:unknown,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential)]);
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
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential)]);
    const view=projectCidChat(chat,s.session,credential.secret,now);
    const snapshot=await tx.get(messages.orderBy('createdAt','desc').limit(100));
    const contacts=chat.members.filter(m=>m.role==='contact');
    return {...view,messages:snapshot.docs.map(d=>{
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
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential)]);
    const closed=closeCidChat(chat,s.session,credential.secret,now);
    tx.update(root,{closedAt:closed.closedAt});return {closed:true as const};
   });
  },
  async revokeOwnSession(credential:Credential,now:number){
   checkNow(now);return db.runTransaction(async tx=>{
    checkNow(now);
    const [chat,s]=await Promise.all([readChat(tx),readSession(tx,credential)]);
    authorizeCidChatSession(chat,s.session,credential.secret,now,'read');
    tx.update(s.reference,{revokedAt:now});return {revoked:true as const};
   });
  }
 };
}
