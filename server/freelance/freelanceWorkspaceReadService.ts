import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId,normalizeFreelanceOffer,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';

const offers=()=>adminDb.collection('freelanceOffersV1');
function project(id:string,raw:unknown,uid:string){
 const o=raw as FreelanceOffer;
 if(!o||o.id!==id||!validFreelanceId(o.ownerUid)||!['open','selected','contracted','in_progress','completion_requested','completed','cancelled','under_review'].includes(o.status))throw Error('FREELANCE_CONFLICT');
 const terms=normalizeFreelanceOffer({title:o.title,description:o.description,requirements:o.requirements,paymentMinor:o.paymentMinor});
 return {id,...terms,status:o.status,isOwner:o.ownerUid===uid,isSelected:o.selectedApplicantUid===uid,createdAt:o.createdAt};
}
function projectApplication(raw:unknown,offer:FreelanceOffer,uid:string){
 const a=raw as FreelanceApplication;
 if(!a||a.offerId!==offer.id||a.ownerUid!==offer.ownerUid||!validFreelanceId(a.applicantUid)||
   (offer.ownerUid!==uid&&a.applicantUid!==uid))throw Error('FREELANCE_CONFLICT');
 const effectiveStatus=a.status==='pending'&&offer.status!=='open'&&offer.status!=='selected'?'not_selected':a.status;
 return {applicantUid:a.applicantUid,status:effectiveStatus,createdAt:a.createdAt};
}
export async function readFreelanceWorkspace(uid:string,view:unknown,offerId?:unknown){
 if(!validFreelanceId(uid))throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  if(view==='open'||view==='owner'){
   const query=view==='open'?offers().where('status','==','open'):offers().where('ownerUid','==',uid);
   const result=await tx.get(query.limit(51));
   if(result.size>50)throw Error('FREELANCE_PAGE_LIMIT');
   return {items:result.docs.filter(d=>view!=='open'||d.get('ownerUid')!==uid).map(d=>project(d.id,d.data(),uid))};
  }
  if(view==='applications'){
   const result=await tx.get(adminDb.collectionGroup('applications').where('applicantUid','==',uid).limit(51));
   if(result.size>50)throw Error('FREELANCE_PAGE_LIMIT');
   const items=[];
   for(const d of result.docs){
    const parent=d.ref.parent.parent;
    if(!parent||parent.parent.path!=='freelanceOffersV1'||d.id!==uid)continue;
    const o=(await tx.get(parent)).data() as FreelanceOffer|undefined;
    if(!o||o.id!==parent.id)throw Error('FREELANCE_CONFLICT');
    items.push({...project(parent.id,o,uid),application:projectApplication(d.data(),o,uid)});
   }
   return {items};
  }
  if(view!=='detail'||!validFreelanceId(offerId))throw Error('FREELANCE_INVALID');
  const ref=offers().doc(offerId),o=(await tx.get(ref)).data() as FreelanceOffer|undefined;
  if(!o||o.id!==offerId)throw Error('FREELANCE_FORBIDDEN');
  const owner=o.ownerUid===uid;
  const mine=owner?null:await tx.get(ref.collection('applications').doc(uid));
  if(!owner&&!mine?.exists&&o.status!=='open')throw Error('FREELANCE_FORBIDDEN');
  const item=project(offerId,o,uid);
  if(!owner)return {item,applications:mine?.exists?[projectApplication(mine.data(),o,uid)]:[]};
  const applications=await tx.get(ref.collection('applications').limit(51));
  if(applications.size>50)throw Error('FREELANCE_PAGE_LIMIT');
  return {item,applications:applications.docs.map(d=>{
   if(d.id!==d.get('applicantUid'))throw Error('FREELANCE_CONFLICT');
   return projectApplication(d.data(),o,uid);
  })};
 },{readOnly:true});
}
