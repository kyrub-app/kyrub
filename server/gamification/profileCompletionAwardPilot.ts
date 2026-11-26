import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { evaluateStoredCapabilityAgeAccess } from '../../shared/ageEligibility.js';
import { evaluateProfileCompletion, PROFILE_COMPLETION_CHALLENGE } from '../../shared/profileCompletionChallenge.js';
import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';
import { readIsolatedZeroCurrencyBalance } from './semeaduraNoWelcomeAuthority.js';

const PROJECT='demo-kyrub-welcome';
const EPOCH='welcome-emulator-only';
const CHALLENGE=PROFILE_COMPLETION_CHALLENGE.id;
const validUid=(uid:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(uid);

/** No public route or production writer. The trusted adapter must read the
 * authoritative saved profile and handle reservation INSIDE this transaction.
 * A display handle generated from email is not evidence of ownership. */
export type ProfileCompletionEvidenceReader=(tx:Transaction,uid:string)=>Promise<{
 displayName:unknown;handle:unknown;handleOwnerUid:unknown;bio:unknown;
}>;

export function profileCompletionPilotEnabled(db:Firestore,env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_PROFILE_COMPLETION_PILOT==='true'&&env.NODE_ENV!=='production'&&
 (db as Firestore&{projectId?:string}).projectId===PROJECT&&
 env.GCLOUD_PROJECT===PROJECT&&env.GOOGLE_CLOUD_PROJECT===PROJECT&&
 env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
 !env.VERCEL&&!env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}

export async function grantIsolatedProfileCompletion(db:Firestore,uid:string,readEvidence:ProfileCompletionEvidenceReader){
 if(!profileCompletionPilotEnabled(db)||!validUid(uid))throw Error('PROFILE_COMPLETION_RELEASE_UNAVAILABLE');
 const root=db.collection('users').doc(uid);
 const receiptRef=root.collection('challengeRewards').doc(CHALLENGE);
 const balanceRef=root.collection('pitangaBalance').doc('balance');
 const ledger=root.collection('rewardLedger');
 const awardRef=ledger.doc('earn_'+CHALLENGE);
 const key=CHALLENGE+':'+uid;
 return db.runTransaction(async tx=>{
  const [fence,age,definition,receipt,award,balance,rewards]=await Promise.all([
   tx.get(db.doc('systemControl/pitangaLegacyWriterFence')),
   tx.get(db.doc('age_eligibility_private/'+uid)),
   tx.get(db.doc('global_challenges/'+CHALLENGE)),
   tx.get(receiptRef),tx.get(awardRef),tx.get(balanceRef),tx.get(ledger),
  ]);
  const f=fence.data(),d=definition.data(),b=balance.data();
  if(f?.status!=='fenced'||f.writersVerified!==true||f.epoch!==EPOCH)throw Error('PROFILE_COMPLETION_WRITERS_UNVERIFIED');
  if(!evaluateStoredCapabilityAgeAccess({actorUid:uid,record:age.data(),capability:'rewards',policy:'verified_adult_only'}))
   throw Error('PROFILE_COMPLETION_AGE_REQUIRED');
  if(!b||b.userId!==uid||!Number.isSafeInteger(b.availableKCoins)||b.availableKCoins<0)
   throw Error('PROFILE_COMPLETION_BALANCE_UNAVAILABLE');
  let available:number;
  if(b.initializedBy==='verified_clean_baseline_welcome'){
   const firstLogin=root.collection('authEvents').doc('first_login_v1');
   const original=await tx.get(firstLogin);
   available=(await verifyCleanBaselineSpendingEligibilityInTransaction(tx,{
    userId:uid,firebaseCreatedAt:original.get('firebaseCreatedAt'),receiptRef:firstLogin,balanceRef,
    welcomeAwardRef:ledger.doc('earn_first_login_welcome_v1'),
   })).availablePitangas;
  }else{
   // Existing independently initialized zero-history currency only.
   // Never initialize a wallet or issue a welcome grant from this challenge.
   available=await readIsolatedZeroCurrencyBalance(db,tx,uid);
  }
  const entries=rewards.docs.map(doc=>{
   const entry=doc.data() as KyrubRewardLedgerEntry&{economy?:string};
   if(entry.id!==doc.id||entry.userId!==uid||entry.economy!=='k_coin')throw Error('PROFILE_COMPLETION_LEDGER_INVALID');
   return entry;
  });
  if(kyrubKCoinBalance(entries)!==available||b.availableKCoins!==available)
   throw Error('PROFILE_COMPLETION_BALANCE_CONFLICT');
  if(receipt.exists||award.exists){
   const r=receipt.data(),a=award.data();
   if(!r||!a||r.userId!==uid||r.challengeId!==CHALLENGE||r.idempotencyKey!==key||
    r.pitangas!==100||r.xp!==0||!Number.isFinite(Date.parse(r.occurredAt))||
    a.id!==awardRef.id||a.userId!==uid||a.type!=='earn'||a.economy!=='k_coin'||
    a.sourceType!=='challenge'||a.sourceId!==CHALLENGE||a.correlationId!==key||
    a.idempotencyKey!==key||a.deltaKCoins!==100||a.occurredAt!==r.occurredAt)
    throw Error('PROFILE_COMPLETION_RECEIPT_CONFLICT');
   return {replay:true,pitangas:100,xp:0,balance:available};
  }
  if(!d||d.id!==CHALLENGE||!['active','published'].includes(d.status)||d.validationMode!=='deterministic'||
   d.sponsorType!=='kyrub'||d.rewardKCoins!==100||d.rewardXp!==0||d.maxCompletionsPerUser!==1||
   d.startsAt!==undefined||d.endsAt!==undefined)throw Error('PROFILE_COMPLETION_DEFINITION_INVALID');
  const evidence=await readEvidence(tx,uid);
  const eligibility=evaluateProfileCompletion({...evidence,uid,ageStatus:'verified_adult',
   releaseApproved:true,challengeActive:true,receiptExists:false});
  if(!eligibility.eligible||eligibility.idempotencyKey!==key||!Number.isSafeInteger(available+100))
   throw Error('PROFILE_COMPLETION_NOT_ELIGIBLE');
  const occurredAt=new Date().toISOString();
  tx.update(balanceRef,{availableKCoins:available+100});
  tx.create(awardRef,{id:awardRef.id,userId:uid,type:'earn',economy:'k_coin',deltaKCoins:100,
   sourceType:'challenge',sourceId:CHALLENGE,correlationId:key,idempotencyKey:key,occurredAt});
  tx.create(receiptRef,{userId:uid,challengeId:CHALLENGE,pitangas:100,xp:0,idempotencyKey:key,occurredAt});
  return {replay:false,pitangas:100,xp:0,balance:available+100};
 });
}
