import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication,type FreelanceOccurrence} from '../../shared/freelanceLifecycle.js';
import {buildFreelanceRemunerationBasis,matchesFreelanceRemunerationBasis} from '../../shared/freelanceRemuneration.js';

const collection=()=>adminDb.collection('freelanceOffersV1');
const activeStates:string[]=['selected','contracted','in_progress','completion_requested','under_review'];
type Alert={offerId:string;role:'requester'|'freelancer';title:string;state:string};
type Earning={offerId:string;title:string;agreedMinor:number;confirmedServiceMinor:number|null;state:'projected'|'service_confirmed'|'financial_review';receivedMinor:null};
function verifyOffer(id:string,o:FreelanceOffer,uid:string,role:'requester'|'freelancer'){
 if(!o||o.id!==id||!validFreelanceId(o.ownerUid)||typeof o.title!=='string'||!o.title.trim()||o.title.length>120||
 !Number.isSafeInteger(o.paymentMinor)||o.paymentMinor<=0||o.paymentMinor>999999999||
 (role==='requester'?o.ownerUid!==uid:o.selectedApplicantUid!==uid||o.ownerUid===uid))throw Error('FREELANCE_CONFLICT');
}
export async function readFreelancePersonalSummary(uid:string,view:'alerts'|'earnings'){
 if(!validFreelanceId(uid))throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const worker=await tx.get(collection().where('selectedApplicantUid','==',uid).limit(51));
  if(worker.size>50)throw Error('FREELANCE_PAGE_LIMIT');
  const alerts:Alert[]=[],entries:Earning[]=[];
  for(const d of worker.docs){
   const o=d.data() as FreelanceOffer;verifyOffer(d.id,o,uid,'freelancer');
   const a=(await tx.get(d.ref.collection('applications').doc(uid))).data() as FreelanceApplication|undefined;
   if(!a||a.applicantUid!==uid||a.ownerUid!==o.ownerUid||a.offerId!==o.id||a.status!==o.status)throw Error('FREELANCE_CONFLICT');
   if(view==='alerts'){
    if([...activeStates,'completed','cancelled'].includes(o.status))alerts.push({offerId:o.id,role:'freelancer',title:o.title,state:o.status});
    continue;
   }
   if(o.status==='completed'||o.status==='cancelled'){
    const saved=(await tx.get(d.ref.collection('financialBasis').doc('remuneration'))).data();
    let occurrence:FreelanceOccurrence|undefined;
    if(o.status==='cancelled'){
     if(!validFreelanceId(saved?.sourceOccurrenceId))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
     occurrence=(await tx.get(d.ref.collection('occurrences').doc(saved.sourceOccurrenceId))).data() as FreelanceOccurrence|undefined;
    }
    const basis=buildFreelanceRemunerationBasis(o,a,occurrence);
    if(!matchesFreelanceRemunerationBasis(saved,basis))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
    entries.push({offerId:o.id,title:o.title,agreedMinor:basis.agreedMinor,confirmedServiceMinor:basis.confirmedServiceMinor,
     state:o.status==='completed'?'service_confirmed':'financial_review',receivedMinor:null});
   }else if(o.status==='under_review'){
    entries.push({offerId:o.id,title:o.title,agreedMinor:o.paymentMinor,confirmedServiceMinor:null,state:'financial_review',receivedMinor:null});
   }else if(['contracted','in_progress','completion_requested'].includes(o.status)){
    if(!o.contractedAt||a.contractedAt!==o.contractedAt)throw Error('FREELANCE_CONFLICT');
    entries.push({offerId:o.id,title:o.title,agreedMinor:o.paymentMinor,confirmedServiceMinor:null,state:'projected',receivedMinor:null});
   }
  }
  if(view==='alerts'){
   const owner=await tx.get(collection().where('ownerUid','==',uid).limit(51));
   if(owner.size>50)throw Error('FREELANCE_PAGE_LIMIT');
   for(const d of owner.docs){
    const o=d.data() as FreelanceOffer;verifyOffer(d.id,o,uid,'requester');
    if(o.status==='open'){
     const pending=await tx.get(d.ref.collection('applications').where('status','==','pending').limit(1));
     if(!pending.empty)alerts.push({offerId:o.id,role:'requester',title:o.title,state:'applications_pending'});
    }else if([...activeStates,'completed','cancelled'].includes(o.status))alerts.push({offerId:o.id,role:'requester',title:o.title,state:o.status});
   }
   return {alerts};
  }
  const projectedMinor=entries.filter(e=>e.state==='projected').reduce((sum,e)=>sum+e.agreedMinor,0);
  const confirmedMinor=entries.reduce((sum,e)=>sum+(e.confirmedServiceMinor??0),0);
  if(!Number.isSafeInteger(projectedMinor)||!Number.isSafeInteger(confirmedMinor))throw Error('FREELANCE_CONFLICT');
  return {currency:'BRL',entries,projectedMinor,confirmedMinor,reviewCount:entries.filter(e=>e.state==='financial_review').length,receivedMinor:null};
 },{readOnly:true});
}
