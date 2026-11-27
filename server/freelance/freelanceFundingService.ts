import {createHash} from 'node:crypto';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';

/** No production provider is implemented. This adapter is local-emulator only. */
function assertSimulationEnvironment(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
    getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_FUNDING_PROVIDER_NOT_ENABLED');
}
type Funding={schemaVersion:1;environment:'emulator';provider:'fixture';paymentId:string;offerId:string;
 requesterUid:string;beneficiaryUid:string;amountMinor:number;currency:'BRL';status:'confirmed'|'revoked';
 confirmedAt:string;revokedAt?:string};
function binding(offer:FreelanceOffer,app:FreelanceApplication){
 if(offer.paymentTerms!==undefined||app.paymentTerms!==undefined)throw Error('FREELANCE_FUNDING_CONFLICT');
 if(!validFreelanceId(offer.id)||!validFreelanceId(offer.ownerUid)||!validFreelanceId(offer.selectedApplicantUid)||
   app.offerId!==offer.id||app.ownerUid!==offer.ownerUid||app.applicantUid!==offer.selectedApplicantUid||
   offer.ownerUid===app.applicantUid||offer.status!==app.status||!offer.contractedAt||
   offer.contractedAt!==app.contractedAt||!Number.isFinite(Date.parse(offer.contractedAt))||
   !Number.isSafeInteger(offer.paymentMinor)||offer.paymentMinor<=0||offer.paymentMinor>999999999)
   throw Error('FREELANCE_FUNDING_CONFLICT');
 return {offerId:offer.id,requesterUid:offer.ownerUid,beneficiaryUid:app.applicantUid,amountMinor:offer.paymentMinor,currency:'BRL' as const};
}
function matches(raw:unknown,offer:FreelanceOffer,app:FreelanceApplication):raw is Funding{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const f=raw as Funding;
 return f.schemaVersion===1&&f.environment==='emulator'&&f.provider==='fixture'&&validFreelanceId(f.paymentId)&&
   Object.entries(binding(offer,app)).every(([k,v])=>(f as unknown as Record<string,unknown>)[k]===v)&&
   Number.isFinite(Date.parse(f.confirmedAt))&&Date.parse(f.confirmedAt)>=Date.parse(offer.contractedAt!);
}
const paymentRef=(id:string)=>adminDb.doc('freelanceFixturePaymentsV1/'+createHash('sha256').update(id).digest('hex'));
/** Called inside the same transaction as start. Never accepts a browser confirmation. */
export async function assertFreelanceFundingForStart(tx:FirebaseFirestore.Transaction,offer:FreelanceOffer,app:FreelanceApplication){
 assertSimulationEnvironment();
 const saved=(await tx.get(adminDb.doc('freelanceOffersV1/'+offer.id+'/funding/confirmation'))).data();
 if(!matches(saved,offer,app)||saved.status!=='confirmed'||saved.revokedAt)throw Error('FREELANCE_FUNDING_REQUIRED');
 const claim=(await tx.get(paymentRef(saved.paymentId))).data();
 if(!claim||claim.offerId!==offer.id||claim.paymentId!==saved.paymentId)throw Error('FREELANCE_FUNDING_CONFLICT');
}
/** Only test harness calls this; no HTTP route, provider network or real funds. */
export async function confirmSimulatedFreelanceFunding(offerId:string,paymentId:string,amountMinor:number,requesterUid:string,beneficiaryUid:string){
 assertSimulationEnvironment();
 if(![offerId,paymentId,requesterUid,beneficiaryUid].every(validFreelanceId)||!Number.isSafeInteger(amountMinor)||amountMinor<=0)
   throw Error('FREELANCE_FUNDING_CONFLICT');
 const offerRef=adminDb.doc('freelanceOffersV1/'+offerId);
 const fundingRef=offerRef.collection('funding').doc('confirmation');
 const claimRef=paymentRef(paymentId);
 return adminDb.runTransaction(async tx=>{
   const [o,f,c]=await tx.getAll(offerRef,fundingRef,claimRef);
   const offer=o.data() as FreelanceOffer|undefined;
   if(!offer||offer.id!==offerId||offer.status!=='contracted'||!validFreelanceId(offer.selectedApplicantUid))throw Error('FREELANCE_FUNDING_CONFLICT');
   const app=(await tx.get(offerRef.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
   if(!app)throw Error('FREELANCE_FUNDING_CONFLICT');
   const expected=binding(offer,app);
   if(expected.requesterUid!==requesterUid||expected.beneficiaryUid!==beneficiaryUid||expected.amountMinor!==amountMinor)throw Error('FREELANCE_FUNDING_CONFLICT');
   if(f.exists||c.exists){
     const saved=f.data();
     if(matches(saved,offer,app)&&saved.status==='confirmed'&&!saved.revokedAt&&saved.paymentId===paymentId&&
       c.get('offerId')===offerId&&c.get('paymentId')===paymentId)return {created:false};
     throw Error('FREELANCE_FUNDING_CONFLICT');
   }
   const confirmedAt=new Date().toISOString();
   if(Date.parse(confirmedAt)<Date.parse(offer.contractedAt!))throw Error('FREELANCE_FUNDING_CONFLICT');
   const record:Funding={schemaVersion:1,environment:'emulator',provider:'fixture',paymentId,...expected,status:'confirmed',confirmedAt};
   tx.create(fundingRef,record);tx.create(claimRef,{offerId,paymentId,environment:'emulator'});
   return {created:true};
 });
}
/** Simulated revocation only before work starts; after start an occurrence is required. */
export async function revokeSimulatedFreelanceFunding(offerId:string,paymentId:string){
 assertSimulationEnvironment();
 if(!validFreelanceId(offerId)||!validFreelanceId(paymentId))throw Error('FREELANCE_FUNDING_CONFLICT');
 const offerRef=adminDb.doc('freelanceOffersV1/'+offerId);
 const fundingRef=offerRef.collection('funding').doc('confirmation');
 return adminDb.runTransaction(async tx=>{
   const [o,f,c]=await tx.getAll(offerRef,fundingRef,paymentRef(paymentId));
   const offer=o.data() as FreelanceOffer|undefined;
   if(!offer||offer.id!==offerId||offer.status!=='contracted'||!validFreelanceId(offer.selectedApplicantUid))throw Error('FREELANCE_FUNDING_CONFLICT');
   const app=(await tx.get(offerRef.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
   const saved=f.data();
   if(!app||!matches(saved,offer,app)||saved.paymentId!==paymentId||c.get('offerId')!==offerId||c.get('paymentId')!==paymentId)throw Error('FREELANCE_FUNDING_CONFLICT');
   if(saved.status==='revoked'&&saved.revokedAt)return {changed:false};
   if(saved.status!=='confirmed'||saved.revokedAt)throw Error('FREELANCE_FUNDING_CONFLICT');
   tx.update(fundingRef,{status:'revoked',revokedAt:new Date().toISOString()});
   return {changed:true};
 });
}
