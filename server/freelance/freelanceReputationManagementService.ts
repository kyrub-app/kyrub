import {FieldPath} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readOwnedFreelanceStore} from './freelanceStoreRepresentationService.js';
import {assertFreelanceReputationLocal,readFreelanceReputationContext,contestationContext} from './freelanceReputationService.js';
import {reputationIndexEnabled} from './freelanceReputationIndexPreparation.js';
import {validFreelanceId,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {projectReputationRating} from '../../shared/freelanceReputationCriteria.js';
type Cursor={legacy:string|null;canonical:string|null;contracts:string|null};
const keys=['legacy','canonical','contracts'] as const;
function decodeCursor(input:unknown):Cursor|undefined{
 if(input===undefined)return undefined;
 if(typeof input!=='string'||input.length>512)throw Error('FREELANCE_INVALID');
 let raw:unknown;try{raw=JSON.parse(input);}catch{throw Error('FREELANCE_INVALID');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==3)throw Error('FREELANCE_INVALID');
 const c=raw as Cursor;
 if(!keys.every(k=>Object.hasOwn(c,k)&&(c[k]===null||validFreelanceId(c[k])))||keys.every(k=>c[k]===null))throw Error('FREELANCE_INVALID');
 return c;
}
/** Management view is narrower than the team aggregate. Existing contract
 * authority remains owner-only; managers can consult public Moments. */
export async function readStoreReputationManagement(uid:string,legacyStoreId:unknown,cursorInput?:unknown){
 assertFreelanceReputationLocal();
 if(!reputationIndexEnabled())throw Error('FREELANCE_FORBIDDEN');
 if(!validFreelanceId(uid)||!validFreelanceId(legacyStoreId))throw Error('FREELANCE_INVALID');
 const cursor=decodeCursor(cursorInput);
 return adminDb.runTransaction(async tx=>{
  const store=await readOwnedFreelanceStore(tx,legacyStoreId);
  if(!store)throw Error('FREELANCE_STORE_FORBIDDEN');
  const owner=uid===legacyStoreId;
  if(!owner){
   const member=(await tx.get(adminDb.doc('stores/'+store.storeId+'/members/'+uid))).data();
   if(!member||member.userId!==uid||member.storeId!==store.storeId||member.status!=='active'||member.role!=='manager')throw Error('FREELANCE_STORE_FORBIDDEN');
  }
  if(!owner&&cursor?.contracts!=null)throw Error('FREELANCE_STORE_FORBIDDEN');
  const next:Cursor={legacy:null,canonical:null,contracts:null};
  const moments=[];let momentsTruncated=false;
  // Both existing, verified identities may have published consumer reviews.
  // Keep source identity, never merge ratings across aliases or infer authors.
  for(const [key,id] of [['legacy',legacyStoreId],['canonical',store.storeId]] as const){
   const after=cursor?.[key];if(after===null)continue;
   let query=adminDb.collection('store_reviews/'+id+'/reviews').where('status','==','published').orderBy(FieldPath.documentId()).limit(21);
   if(after!==undefined)query=query.startAfter(after);
   const page=await tx.get(query);
   if(page.size>20){momentsTruncated=true;next[key]=page.docs[19].id;}
   for(const doc of page.docs.slice(0,20)){
    const d=doc.data();
    if(d.storeId!==id||d.reviewId!==doc.id||d.authorId!==doc.id||!validFreelanceId(doc.id)||typeof d.authorName!=='string'||typeof d.content!=='string'||!Number.isInteger(d.rating)||d.rating<1||d.rating>5||typeof d.createdAtIso!=='string')throw Error('FREELANCE_REPUTATION_CONFLICT');
    moments.push({storeId:id,reviewId:doc.id,authorName:d.authorName,content:d.content,rating:d.rating,createdAtIso:d.createdAtIso});
   }
  }
  const contracts=[];let contractsTruncated=false;
  if(owner&&cursor?.contracts!==null){
   let query=adminDb.collection('freelanceOffersV1').where('ownerUid','==',uid).where('status','==','completed').orderBy(FieldPath.documentId()).limit(21);
   if(typeof cursor?.contracts==='string')query=query.startAfter(cursor.contracts);
   const page=await tx.get(query);
   contractsTruncated=page.size>20;
   if(contractsTruncated)next.contracts=page.docs[19].id;
   for(const doc of page.docs.slice(0,20)){
    const o=doc.data() as FreelanceOffer;
    if(o.requesterStore?.storeId!==store.storeId)continue;
    const x=await readFreelanceReputationContext(tx,uid,doc.id);
    if(x.parties.requester.kind!=='store_requester'||x.parties.requester.id!==store.storeId||x.c.actor!=='requester')throw Error('FREELANCE_REPUTATION_CONFLICT');
    const q=await contestationContext(tx,x);
    if(!q.own||!q.rating)continue;
    contracts.push({offerId:doc.id,completedAt:x.parties.completedAt,mean:projectReputationRating('store_requester',q.rating.scores).mean,contestationPending:!!q.raw});
   }
  }
  return {legacyStoreId,canonicalStoreId:store.storeId,owner,moments,momentsTruncated,contracts,contractsTruncated,nextCursor:keys.some(k=>next[k]!==null)?JSON.stringify(next):null};
 },{readOnly:true});
}
