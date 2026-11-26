// Emulator-only outbox processor. No network, provider credentials, scheduler or external sends.
// Simulated outcomes are inputs from the test harness, NEVER delivery evidence for real messages.
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from './cidSosEmulatorStore.js';
import {buildTrustedCidSosProfile,type TrustedTag,type CidSosConfig,type ChannelGrant} from './cidSosPrivateConfig.js';
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {CidSosMessage,CidSosOccurrence} from './cidSosAlertPolicy.js';
type Channel=CidSosMessage['recipient']['channel'];
type Outcome='accepted'|'retryable'|'rejected';
type Status='simulation-pending'|'simulation-retry'|'simulation-delivered'|'simulation-failed'|'simulation-cancelled';
type Row={message:CidSosMessage;status:Status;createdAt:number;attempts?:number;nextAttemptAt?:number};
const APP='cid-notification-local-emulator';
const deny=():never=>{throw Error('CID_SIMULATION_FORBIDDEN');};
const MAX_ATTEMPTS=3;
const RETRY_MS=60000;
const MAX_AGE_MS=30*60000;
const time=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
const keyHash=(key:string)=>createHash('sha256').update(key,'utf8').digest('hex');
const outcomes=['accepted','retryable','rejected'] as const;
// Channel-specific simulated receipts, not real provider IDs or monetary charges.
const adapters:Record<Channel,string>={email:'mock-email',whatsapp:'mock-whatsapp',sms:'mock-sms'};
export function createCidSosNotificationEmulator(tagId:string){
 assertCidSosEmulator();if(!isTagId(tagId))return deny();
 const app=getApps().find(a=>a.name===APP)??initializeApp({projectId:CID_EMULATOR_PROJECT},APP);
 if(app.options.projectId!==CID_EMULATOR_PROJECT)return deny();
 const db=getFirestore(app),root=db.collection('cid_sos_emulator_tags').doc(tagId);
 const queue=root.collection('outbox');
 return {
  async process(messageKey:string,outcome:Outcome,now:number){
   assertCidSosEmulator();
   if(typeof messageKey!=='string'||!/^([A-Za-z0-9_-]{22,80}):(?:alert|resolution):(?:[0-9]|1[01])$/.test(messageKey)||!outcomes.includes(outcome)||!time(now))return deny();
   const [occurrenceId,kind,indexText]=messageKey.split(':'),index=Number(indexText);
   const ref=queue.doc(keyHash(messageKey));
   return db.runTransaction(async tx=>{
    assertCidSosEmulator();
    const [q,o,t,c,g]=await Promise.all([tx.get(ref),tx.get(root.collection('occurrences').doc(occurrenceId)),tx.get(root),tx.get(root.collection('private').doc('config')),tx.get(root.collection('private').doc('grants'))]);
    const row=q.data() as Row|undefined,occ=o.data() as CidSosOccurrence|undefined,tag=t.get('tag') as TrustedTag|undefined,config=c.get('config') as CidSosConfig|undefined,grants=g.get('grants') as ChannelGrant[]|undefined;
    if(!row||!occ||!tag||occ.id!==occurrenceId||occ.tagId!==tagId||tag.tagId!==tagId||occ.ownerId!==tag.ownerId||row.message.key!==messageKey||row.message.kind!==kind||!time(row.createdAt)||row.createdAt!==(kind==='alert'?occ.createdAt:occ.resolvedAt)||now<row.createdAt)return deny();
    const recipient=row.message.recipient,planned=occ.recipients[index];
    if(!planned||!recipient||planned.participantId!==recipient.participantId||planned.role!==recipient.role||planned.channel!==recipient.channel||planned.address!==recipient.address||!Object.hasOwn(adapters,recipient.channel))return deny();
    if(kind==='resolution'){
     const initial=await tx.get(queue.doc(keyHash(occurrenceId+':alert:'+index)));
     if(recipient.role!=='contact'||occ.status!=='resolved'||initial.get('status')!=='simulation-delivered'||initial.get('message.recipient.address')!==recipient.address)return deny();
    }
    const attempts=row.attempts??0;
    if(!Number.isSafeInteger(attempts)||attempts<0||attempts>MAX_ATTEMPTS)return deny();
    if(['simulation-delivered','simulation-failed','simulation-cancelled'].includes(row.status))return {status:row.status,attempts,duplicate:true,simulated:true as const};
    if(row.status!=='simulation-pending'&&row.status!=='simulation-retry')return deny();
    if(row.status==='simulation-retry'&&(!time(row.nextAttemptAt)||now<row.nextAttemptAt))return {status:row.status,attempts,duplicate:true,simulated:true as const};
    const profile=config&&Array.isArray(grants)?buildTrustedCidSosProfile(tag,config,grants,now):null;
    const participant=recipient.role==='owner'?profile?.owner:profile?.contacts.find(p=>p.id===recipient.participantId);
    const authorized=profile?.active&&profile.enabled&&participant?.id===recipient.participantId&&participant.channels.some(ch=>ch.channel===recipient.channel&&ch.address===recipient.address&&ch.consent===true);
    const allowedState=kind==='alert'?occ.status==='open':occ.status==='resolved';
    if(!authorized||!allowedState||now-row.createdAt>=MAX_AGE_MS){
     tx.update(ref,{status:'simulation-cancelled',completedAt:now,cancellationReason:!authorized?'consent-or-channel-unavailable':!allowedState?'occurrence-closed':'expired'});
     return {status:'simulation-cancelled' as const,attempts,duplicate:false,simulated:true as const};
    }
    const next=attempts+1;
    if(next>MAX_ATTEMPTS)return deny();
    const status:Status=outcome==='accepted'?'simulation-delivered':outcome==='retryable'&&next<MAX_ATTEMPTS?'simulation-retry':'simulation-failed';
    // All effects remain local and transactional. Never use this state as actual
    // notification delivery or as grounds to charge a user.
    tx.update(ref,{status,attempts:next,lastAttemptAt:now,adapter:adapters[recipient.channel],...(status==='simulation-retry'?{nextAttemptAt:now+RETRY_MS}:{completedAt:now})});
    return {status,attempts:next,duplicate:false,simulated:true as const};
   });
  }
 };
}
