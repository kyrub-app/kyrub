import {readOwnedFreelanceStore} from './freelanceStoreRepresentationService.js';
import {readFreelanceStoreRepresentation} from '../../shared/freelanceStoreRepresentation.js';
import {readFreelanceCounterproposal} from '../../shared/freelanceCounterproposal.js';
import {adminDb} from '../firebaseAdmin.js';
import {FieldPath} from 'firebase-admin/firestore';
import {projectVisibleDirectoryEntry} from '../identity/socialDiscoveryDirectoryService.js';
import {validFreelanceId,normalizeFreelanceOffer,type FreelanceOffer,type FreelanceApplication,type FreelanceOccurrence} from '../../shared/freelanceLifecycle.js';

const offers=()=>adminDb.collection('freelanceOffersV1');
function project(id:string,raw:unknown,uid:string){
 const o=raw as FreelanceOffer;
 if(!o||o.id!==id||!validFreelanceId(o.ownerUid)||!['open','selected','contracted','in_progress','completion_requested','completed','cancelled','under_review'].includes(o.status))throw Error('FREELANCE_CONFLICT');
 const participant=o.ownerUid===uid||o.selectedApplicantUid===uid;
 const visibleTerms=!participant&&o.originalOfferTerms?o.originalOfferTerms:o;
 const terms=normalizeFreelanceOffer({title:o.title,description:o.description,requirements:o.requirements,paymentMinor:visibleTerms.paymentMinor,...(visibleTerms.paymentTerms!==undefined?{paymentTerms:visibleTerms.paymentTerms}:{}),...(visibleTerms.workTerms!==undefined?{workTerms:visibleTerms.workTerms}:{})});
 const proposal=participant?readFreelanceCounterproposal(o.selectedCounterproposal,o.originalOfferTerms??o):undefined;
 const requesterStore=readFreelanceStoreRepresentation(o.requesterStore);
 return {id,...terms,...(requesterStore?{requesterStore}:{}),...(proposal?{selectedCounterproposal:proposal}:{}),status:o.status,isOwner:o.ownerUid===uid,isSelected:o.selectedApplicantUid===uid,createdAt:o.createdAt};
}
function projectApplication(raw:unknown,offer:FreelanceOffer,uid:string){
 const a=raw as FreelanceApplication;
 if(!a||a.offerId!==offer.id||a.ownerUid!==offer.ownerUid||!validFreelanceId(a.applicantUid)||
   (offer.ownerUid!==uid&&a.applicantUid!==uid))throw Error('FREELANCE_CONFLICT');
 const effectiveStatus=a.status==='pending'&&offer.status!=='open'&&offer.status!=='selected'?'not_selected':a.status;
 const proposal=readFreelanceCounterproposal(a.counterproposal,offer.originalOfferTerms??offer);
 return {applicantUid:a.applicantUid,status:effectiveStatus,createdAt:a.createdAt,...(proposal?{counterproposal:proposal}:{})};
}
const PAGE_SIZE=20;
export async function readFreelanceWorkspace(uid:string,view:unknown,offerId?:unknown,cursor?:unknown,productionPilot=false){
 if(cursor!==undefined&&cursor!==null&&cursor!==''&&!validFreelanceId(cursor))throw Error('FREELANCE_INVALID');
 const after=validFreelanceId(cursor)?cursor:undefined;
 if(!validFreelanceId(uid))throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  if(view==='requester_stores'){if(offerId||cursor)throw Error('FREELANCE_INVALID');const store=await readOwnedFreelanceStore(tx,uid,productionPilot);return {items:store?[store]:[]};}
  if(view==='open'||view==='owner'){
   let query=(view==='open'?offers().where('status','==','open'):offers().where('ownerUid','==',uid)).orderBy(FieldPath.documentId()).limit(PAGE_SIZE+1);
   if(after)query=query.startAfter(after);
   const result=await tx.get(query);
   const page=result.docs.slice(0,PAGE_SIZE);
   return {items:page.filter(d=>view!=='open'||d.get('ownerUid')!==uid).map(d=>project(d.id,d.data(),uid)),nextCursor:result.size>PAGE_SIZE?page[page.length-1].id:null};
  }
  if(view==='applications'){
   // Cursor is the examined document path, never an arbitrary document supplied by the browser.
   let query=adminDb.collectionGroup('applications').where('applicantUid','==',uid).orderBy(FieldPath.documentId()).limit(PAGE_SIZE+1);
   if(after)query=query.startAfter(adminDb.doc('freelanceOffersV1/'+after+'/applications/'+uid));
   const result=await tx.get(query);
   const page=result.docs.slice(0,PAGE_SIZE);
   const items=[];
   for(const d of page){
    const parent=d.ref.parent.parent;
    if(!parent||parent.parent.path!=='freelanceOffersV1'||d.id!==uid)continue;
    const o=(await tx.get(parent)).data() as FreelanceOffer|undefined;
    if(!o||o.id!==parent.id)throw Error('FREELANCE_CONFLICT');
    items.push({...project(parent.id,o,uid),application:projectApplication(d.data(),o,uid)});
   }
   const last=page[page.length-1];
   // Do not silently truncate a page containing an unexpected collection-group namespace.
   if(page.some(d=>d.ref.parent.parent?.parent.path!=='freelanceOffersV1'||d.id!==uid))throw Error('FREELANCE_CONFLICT');
   return {items,nextCursor:result.size>PAGE_SIZE?last.ref.parent.parent!.id:null};
  }
  if(view!=='detail'||!validFreelanceId(offerId))throw Error('FREELANCE_INVALID');
  const ref=offers().doc(offerId),o=(await tx.get(ref)).data() as FreelanceOffer|undefined;
  if(!o||o.id!==offerId)throw Error('FREELANCE_FORBIDDEN');
  const owner=o.ownerUid===uid;
  const mine=owner?null:await tx.get(ref.collection('applications').doc(uid));
  if(!owner&&!mine?.exists&&o.status!=='open')throw Error('FREELANCE_FORBIDDEN');
  const item=project(offerId,o,uid);
  let occurrence: {id:string;kind:string;openedByMe:boolean;response:string|null}|null=null;
  if(o.status==='under_review'&&(owner||o.selectedApplicantUid===uid)){
   if(!validFreelanceId(o.occurrenceId))throw Error('FREELANCE_CONFLICT');
   const r=(await tx.get(ref.collection('occurrences').doc(o.occurrenceId))).data() as FreelanceOccurrence|undefined;
   if(!r||r.id!==o.occurrenceId||r.offerId!==o.id||r.ownerUid!==o.ownerUid||r.applicantUid!==o.selectedApplicantUid||r.status!=='awaiting_review')throw Error('FREELANCE_CONFLICT');
   occurrence={id:r.id,kind:r.kind,openedByMe:r.openedBy===uid,response:r.response?.position??null};
  }
  if(!owner){if(after)throw Error('FREELANCE_INVALID');return {item,occurrence,applications:mine?.exists?[{...projectApplication(mine.data(),o,uid),publicName:null}]:[],nextApplicationCursor:null};}
  let query=ref.collection('applications').orderBy(FieldPath.documentId()).limit(PAGE_SIZE+1);
  if(after)query=query.startAfter(after);
  const applications=await tx.get(query);
  const page=applications.docs.slice(0,PAGE_SIZE);
  const names=new Map<string,string>();
  if(page.length){
   const profiles=await tx.getAll(...page.map(d=>adminDb.doc('users/'+d.id)),{fieldMask:['uid','name','isProfileVisible']});
   for(const p of profiles){const data=p.data();const entry=data?projectVisibleDirectoryEntry(p.id,data):null;if(entry)names.set(p.id,entry.name);}
  }
  return {item,occurrence,applications:page.map(d=>{
   if(d.id!==d.get('applicantUid'))throw Error('FREELANCE_CONFLICT');
   return {...projectApplication(d.data(),o,uid),publicName:names.get(d.id)??null};
  }),nextApplicationCursor:applications.size>PAGE_SIZE?page[page.length-1].id:null};
 },{readOnly:true});
}
