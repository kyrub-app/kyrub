import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { SEEDS_PER_PITANGUEIRA } from '../../shared/pitangueiraJourney.js';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from './cleanBaselineSpendingEligibility.js';

const project='demo-kyrub-welcome',epoch='welcome-emulator-only';

/** No production or preview enablement. No enrollment endpoint. A disposable
 * fixture must explicitly enroll a clean author before any eligible seeds. */
export function semeaduraEconomicPilotEnabled(db:Firestore,env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_SEMEADURA_ECONOMIC_PILOT==='true'&&env.NODE_ENV!=='production'&&
 (db as Firestore&{projectId?:string}).projectId===project&&env.GCLOUD_PROJECT===project&&
 env.GOOGLE_CLOUD_PROJECT===project&&env.KYRUB_PITANGA_WELCOME_PROJECT_ID===project&&
 env.KYRUB_PITANGA_WELCOME_FENCE_EPOCH===epoch&&env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&
 env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&!env.VERCEL&&
 !env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}

/** Called only after canonical post, membership, unique receipt and cap
 * validation, before ANY writes in the same seed transaction. The pilot
 * cursor is maintained in lockstep with accepted receipts; no catch-up
 * credits from old visual counters. Only the author's account is credited. */
export async function settleAcceptedSeedInTransaction(db:Firestore,tx:Transaction,input:{
 authorId:string;actorId:string;previousSeeds:number;occurredAt:string;postKey:string;
}):Promise<void>{
 if(!semeaduraEconomicPilotEnabled(db))return;
 const {authorId,actorId,previousSeeds,occurredAt,postKey}=input;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(authorId))throw Error('SEMEADURA_ECONOMIC_INPUT_INVALID');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(actorId)||actorId===authorId||!/^[a-f0-9]{64}$/.test(postKey)||
 !Number.isSafeInteger(previousSeeds)||previousSeeds<0||!Number.isSafeInteger(previousSeeds+1)||
 !Number.isFinite(Date.parse(occurredAt)))throw Error('SEMEADURA_ECONOMIC_INPUT_INVALID');
 const root=db.collection('users').doc(authorId);
 const enrollmentRef=root.collection('semeaduraEconomicPilot').doc('activation');
 const enrollment=await tx.get(enrollmentRef);
 if(!enrollment.exists)return; // Ordinary accounts retain visual-only behavior.
 const state=enrollment.data();
 if(state?.authorId!==authorId||state?.schemaVersion!==1||state?.epoch!==epoch||
 state?.acceptedSeeds!==previousSeeds||state?.creditedPitangas!==Math.floor(previousSeeds/SEEDS_PER_PITANGUEIRA))
 throw Error('SEMEADURA_ECONOMIC_CURSOR_CONFLICT');
 const fence=await tx.get(db.doc('systemControl/pitangaLegacyWriterFence'));
 if(fence.get('status')!=='fenced'||fence.get('writersVerified')!==true||fence.get('epoch')!==epoch)
 throw Error('SEMEADURA_ECONOMIC_WRITERS_UNVERIFIED');
 // Explicit server-only review holds, never inferred from friendships,
 // shared networks, reports alone or engagement volume. No balance reversal.
 // Read in the same transaction so a concurrent hold cannot race a credit.
 const holds=[
  {scope:'author',target:authorId},
  {scope:'actor',target:actorId},
  {scope:'post',target:postKey},
 ] as const;
 const holdSnapshots=await Promise.all(holds.map(h=>tx.get(db.doc(`systemControl/semeaduraEconomicReview/holds/${h.scope}_${h.target}`))));
 for(let i=0;i<holds.length;i++){
  const snap=holdSnapshots[i];if(!snap.exists)continue;
  const h=snap.data(),expected=holds[i];
  if(h?.schemaVersion!==1||h.scope!==expected.scope||h.target!==expected.target||
     typeof h.caseId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(h.caseId)||
     (h.status!=='held'&&h.status!=='cleared')||
     typeof h.reviewedBy!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(h.reviewedBy)||
     typeof h.updatedAt!=='string'||!Number.isFinite(Date.parse(h.updatedAt)))
   throw Error('SEMEADURA_ECONOMIC_REVIEW_INVALID');
  // All review projections must match their immutable event; missing audit
  // fields fail closed, including old unaudited fixtures.
  {
   if(!Number.isSafeInteger(h.revision)||h.revision<1||typeof h.eventId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(h.eventId))
    throw Error('SEMEADURA_ECONOMIC_REVIEW_INVALID');
   const event=await tx.get(db.doc('systemControl/semeaduraEconomicReview/events/'+h.eventId));
   const evidence=event.data();
   if(!evidence||evidence.schemaVersion!==1||
      ['scope','target','caseId','eventId','status','reviewedBy','revision','updatedAt'].some(k=>evidence[k]!==h[k]))
    throw Error('SEMEADURA_ECONOMIC_REVIEW_INVALID');
  }
  if(h.status==='held')throw Error('SEMEADURA_ECONOMIC_REVIEW_HELD');
 }
 const nextSeeds=previousSeeds+1;
 const nextCredits=Math.floor(nextSeeds/SEEDS_PER_PITANGUEIRA);
 if(nextCredits===state.creditedPitangas){
  tx.update(enrollmentRef,{acceptedSeeds:nextSeeds,updatedAt:occurredAt});
  return;
 }
 const balanceRef=root.collection('pitangaBalance').doc('balance');
 const firstLoginReceiptRef=root.collection('authEvents').doc('first_login_v1');
 const firstLogin=await tx.get(firstLoginReceiptRef);
 const {availablePitangas}=await verifyCleanBaselineSpendingEligibilityInTransaction(tx,{
  userId:authorId,firebaseCreatedAt:firstLogin.get('firebaseCreatedAt'),receiptRef:firstLoginReceiptRef,
  balanceRef,welcomeAwardRef:root.collection('rewardLedger').doc('earn_first_login_welcome_v1')
 });
 const id='earn_semeadura_'+nextCredits;
 const entryRef=root.collection('rewardLedger').doc(id);
 const [entry,ledger]=await Promise.all([tx.get(entryRef),tx.get(root.collection('rewardLedger'))]);
 if(entry.exists)throw Error('SEMEADURA_ECONOMIC_MILESTONE_CONFLICT');
 const entries=ledger.docs.map(doc=>{
  const data=doc.data() as KyrubRewardLedgerEntry&{economy?:string};
  if(data.id!==doc.id||data.userId!==authorId||data.economy!=='k_coin')throw Error('SEMEADURA_ECONOMIC_LEDGER_INVALID');
  return data;
 });
 if(kyrubKCoinBalance(entries)!==availablePitangas||!Number.isSafeInteger(availablePitangas+1))
 throw Error('SEMEADURA_ECONOMIC_BALANCE_CONFLICT');
 const priorCredits=entries.filter(e=>e.sourceType==='semeadura');
 if(priorCredits.length!==state.creditedPitangas||priorCredits.some(e=>e.type!=='earn'||e.deltaKCoins!==1))
 throw Error('SEMEADURA_ECONOMIC_MILESTONE_CONFLICT');
 tx.create(entryRef,{id,userId:authorId,economy:'k_coin',type:'earn',deltaKCoins:1,sourceType:'semeadura',
  sourceId:'pitangueira_'+nextCredits,correlationId:id,idempotencyKey:id,occurredAt,
  milestone:nextCredits,acceptedSeeds:nextSeeds,triggerPostKey:postKey});
 tx.update(balanceRef,{availableKCoins:availablePitangas+1,updatedAt:occurredAt});
 tx.update(enrollmentRef,{acceptedSeeds:nextSeeds,creditedPitangas:nextCredits,updatedAt:occurredAt});
}
