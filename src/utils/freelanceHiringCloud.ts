import { auth, db } from './firebase';
import {parseHiringTerms,termsFromVacancy,type FreelanceHiringTerms} from '../../shared/freelanceHiringTerms';
import { collection, doc, getDocFromServer, getDocsFromServer, query, where, limit, orderBy, documentId, startAfter, type QueryDocumentSnapshot, type DocumentData, serverTimestamp, setDoc, updateDoc, runTransaction } from 'firebase/firestore';

export type HiringVacancy = { id:string; ownerId:string; title:string; description:string; payment:number; employer:string; status:'open'|'closed' };
export type HiringApplication = { id:string; vagaId:string; ownerId:string; userId:string; status:'pending'|'accepted'|'rejected'|'withdrawn'|'completion_requested'|'completed'; terms?:FreelanceHiringTerms };

export function freelanceCloudPreviewEnabled():boolean{
 return import.meta.env.DEV===true && import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'
  && import.meta.env.VITE_KYRUB_FREELANCE_CLOUD_PREVIEW==='true'
  && typeof window!=='undefined' && window.location.hostname==='127.0.0.1'
  && window.location.protocol==='http:' && auth.app.options.projectId==='kyrub-security-test'
  && db.app.options.projectId==='kyrub-security-test';
}
const uid=()=>{
 if(!freelanceCloudPreviewEnabled())throw Error('FREELANCE_CLOUD_PREVIEW_UNAVAILABLE');
 const user=auth.currentUser;
 if(!user)throw Error('Entre no Kyrub para continuar.');
 return user.uid;
};
const validId=(id:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(id);
const checkSession=(actor:string)=>{if(auth.currentUser?.uid!==actor)throw Error('Sessão alterada. Entre novamente.');};
type NotifiedHiringAction='apply'|'accept'|'reject'|'withdraw'|'request_completion'|'request_review'|'complete';
const pendingHiringOperations=new Map<string,string>();
async function notifiedHiringAction(applicationId:string,action:NotifiedHiringAction,expectedTerms?:FreelanceHiringTerms):Promise<boolean>{
 const actor=uid(),key=actor+':'+applicationId+':'+action+':'+JSON.stringify(expectedTerms??null);
 const operationId=pendingHiringOperations.get(key)??crypto.randomUUID();
 pendingHiringOperations.set(key,operationId);
 const user=auth.currentUser;
 if(!user||user.uid!==actor)throw Error('Sessão alterada.');
 const token=await user.getIdToken();
 checkSession(actor);
 const response=await fetch('/api/notifications/freelance-applications/action',{method:'POST',cache:'no-store',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({applicationId,operationId,action,expectedTerms})});
 checkSession(actor);
 if(!response.ok){
  if([400,403,409].includes(response.status))pendingHiringOperations.delete(key);
  throw Error('Operação não confirmada.');
 }
 const result=await response.json();
 if(result.applicationId!==applicationId||result.operationId!==operationId||typeof result.created!=='boolean')throw Error('Recibo inválido.');
 pendingHiringOperations.delete(key);
 return result.created;
}

const parseVacancy=(id:string,data:Record<string,unknown>):HiringVacancy|null=>{
 if(!validId(id)||typeof data.ownerId!=='string'||!validId(data.ownerId)||typeof data.title!=='string'||typeof data.description!=='string'||typeof data.employer!=='string'||typeof data.payment!=='number'||!Number.isFinite(data.payment)||data.payment<=0||(data.status!=='open'&&data.status!=='closed'))return null;
 return {id,ownerId:data.ownerId,title:data.title,description:data.description,employer:data.employer,payment:data.payment,status:data.status};
};
export async function listHiringVacancies(ownOnly=false):Promise<HiringVacancy[]>{
 const actor=uid();
 const snapshot=await getDocsFromServer(query(collection(db,'vagas'),where(ownOnly?'ownerId':'status','==',ownOnly?actor:'open'),limit(50)));
 checkSession(actor);
 return snapshot.docs.flatMap(d=>{const v=parseVacancy(d.id,d.data());return v?[v]:[];});
}
export async function publishHiringVacancy(input:{title:string;description:string;payment:number}):Promise<string>{
 const actor=uid();
 const title=input.title.trim(),description=input.description.trim(),payment=input.payment;
 if(!title||title.length>120||!description||description.length>2000||!Number.isFinite(payment)||payment<=0||payment>1000000||Math.round(payment*100)/100!==payment)throw Error('Revise os dados da vaga.');
 const employer=(auth.currentUser?.displayName||'Contratante Kyrub').trim().slice(0,160)||'Contratante Kyrub';
 const ref=doc(collection(db,'vagas'));
 await setDoc(ref,{ownerId:actor,title,description,payment,employer,status:'open',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 checkSession(actor);
 return ref.id;
}
export async function applyToHiringVacancy(vagaId:string,expectedVacancy?:HiringVacancy):Promise<'created'|'existing'>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}$/.test(vagaId))throw Error('Vaga sem identificador válido para contratação.');
 if(import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true'){
  const terms=termsFromVacancy(expectedVacancy);
  if(!terms||expectedVacancy?.id!==vagaId)throw Error('Revise as condições da vaga.');
  return await notifiedHiringAction(vagaId+'__'+actor,'apply',terms)?'created':'existing';
 }
 const vacancy=doc(db,'vagas',vagaId),application=doc(db,'candidaturas',vagaId+'__'+actor);
 const result=await runTransaction(db,async tx=>{
   checkSession(actor);
   const v=await tx.get(vacancy);
   if(!v.exists()||v.get('status')!=='open'||v.get('ownerId')===actor||typeof v.get('ownerId')!=='string')throw Error('Vaga indisponível.');
   const previous=await tx.get(application);
   if(previous.exists()){
     if(previous.get('userId')!==actor||previous.get('vagaId')!==vagaId||previous.get('ownerId')!==v.get('ownerId'))throw Error('Candidatura inconsistente.');
     return 'existing' as const;
   }
   tx.set(application,{vagaId,ownerId:v.get('ownerId'),userId:actor,status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   return 'created' as const;
 });
 checkSession(actor);
 return result;
}
export async function listHiringApplications(asRequester:boolean):Promise<HiringApplication[]>{
 const actor=uid();
 const snapshot=await getDocsFromServer(query(collection(db,'candidaturas'),where(asRequester?'ownerId':'userId','==',actor),limit(50)));
 checkSession(actor);
 return snapshot.docs.flatMap(d=>{
   const x=d.data();
   if(typeof x.vagaId!=='string'||typeof x.ownerId!=='string'||typeof x.userId!=='string'||!['pending','accepted','rejected','withdrawn','completion_requested','completed'].includes(x.status))return [];
   return [{id:d.id,vagaId:x.vagaId,ownerId:x.ownerId,userId:x.userId,status:x.status as HiringApplication['status'],terms:parseHiringTerms(x.terms)??undefined}];
 });
}
export async function decideHiringApplication(id:string,status:'accepted'|'rejected'|'withdrawn',expectedTerms?:FreelanceHiringTerms):Promise<void>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Candidatura inválida.');
 const ref=doc(db,'candidaturas',id);
 if(import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true'){if(status==='accepted'&&!expectedTerms)throw Error('Condições não registradas.');await notifiedHiringAction(id,status==='accepted'?'accept':status==='rejected'?'reject':'withdraw',expectedTerms);return;}
 const current=await getDocFromServer(ref);
 checkSession(actor);
 if(!current.exists()||current.get('status')!=='pending'||(status==='withdrawn'?current.get('userId')!==actor:current.get('ownerId')!==actor))throw Error('Candidatura indisponível.');
 await updateDoc(ref,{status,updatedAt:serverTimestamp()});
 checkSession(actor);
}

export async function transitionHiringCompletion(id:string,status:'completion_requested'|'completed'|'accepted'):Promise<void>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Candidatura inválida.');
 if(import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true'){await notifiedHiringAction(id,status==='completion_requested'?'request_completion':status==='completed'?'complete':'request_review');return;}
 const ref=doc(db,'candidaturas',id);
 await runTransaction(db,async tx=>{
   checkSession(actor);
   const current=await tx.get(ref);
   if(!current.exists())throw Error('Contratação indisponível.');
   const allowed=status==='completion_requested'
     ? current.get('userId')===actor&&current.get('status')==='accepted'
     : current.get('ownerId')===actor&&current.get('status')==='completion_requested';
   if(!allowed)throw Error('Transição indisponível.');
   tx.update(ref,{status,updatedAt:serverTimestamp()});
 });
 checkSession(actor);
}


// Same four-field private DM contract, isolated from personal connections.
export type HiringMessage = {id:string;senderId:string;receiverId:string;text:string;createdAtMs:number};
const hiringMessages=(applicationId:string)=>{
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(applicationId))throw Error('Candidatura inválida.');
 return collection(db,'candidaturas',applicationId,'messages');
};
export type HiringMessageCursor = { applicationId:string; actorId:string; snapshot:QueryDocumentSnapshot<DocumentData> };
export const HIRING_MESSAGE_PAGE_SIZE=50;
export async function listHiringMessages(applicationId:string,cursor?:HiringMessageCursor):Promise<{items:HiringMessage[];nextCursor:HiringMessageCursor|null}>{
 const actor=uid();
 const messages=hiringMessages(applicationId);
 if(cursor&&(cursor.actorId!==actor||cursor.applicationId!==applicationId||cursor.snapshot.ref.parent.path!==messages.path))throw Error('Cursor inválido.');
 const ordered=query(messages,orderBy('createdAt','desc'),orderBy(documentId(),'desc'));
 const page=cursor?query(ordered,startAfter(cursor.snapshot),limit(HIRING_MESSAGE_PAGE_SIZE+1)):query(ordered,limit(HIRING_MESSAGE_PAGE_SIZE+1));
 const snapshot=await getDocsFromServer(page);
 checkSession(actor);
 const docs=snapshot.docs.slice(0,HIRING_MESSAGE_PAGE_SIZE);
 const items=docs.map(d=>{
  const data=d.data();
  if(typeof data.senderId!=='string'||typeof data.receiverId!=='string'||typeof data.text!=='string'||typeof data.createdAt?.toMillis!=='function'||![data.senderId,data.receiverId].includes(actor))throw Error('Mensagem inválida no histórico.');
  return {id:d.id,senderId:data.senderId,receiverId:data.receiverId,text:data.text,createdAtMs:data.createdAt.toMillis()};
 }).reverse();
 const last=docs[docs.length-1];
 return {items,nextCursor:snapshot.docs.length>HIRING_MESSAGE_PAGE_SIZE&&last?{applicationId,actorId:actor,snapshot:last}:null};
}
export async function sendHiringMessage(applicationId:string,text:string,requestId?:string):Promise<void>{
 const actor=uid(),message=text.trim();
 if(!message||message.length>4000)throw Error('Revise o texto da mensagem.');
 const messages=hiringMessages(applicationId);
 const receipt=doc(db,'candidaturas',applicationId);
 const messageRef=requestId?doc(messages,requestId):doc(messages);
 if(!validId(messageRef.id))throw Error('Identificador inválido.');
 if(import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true'){
  const user=auth.currentUser;
  if(!user||user.uid!==actor)throw Error('Sessão alterada.');
  const token=await user.getIdToken();
  checkSession(actor);
  const response=await fetch('/api/notifications/freelance-messages/send',{method:'POST',cache:'no-store',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({applicationId,messageId:messageRef.id,text:message})});
  checkSession(actor);
  if(!response.ok)throw Error('Envio não confirmado.');
  const result=await response.json();
  if(result.messageId!==messageRef.id||typeof result.created!=='boolean')throw Error('Recibo inválido.');
  return;
 }
 await runTransaction(db,async tx=>{
   checkSession(actor);
   const current=await tx.get(receipt);
   if(!current.exists())throw Error('Negociação indisponível.');
   const previous=await tx.get(messageRef);
   const receiverId=current.get('ownerId')===actor?current.get('userId'):current.get('userId')===actor?current.get('ownerId'):null;
   if(typeof receiverId!=='string'||!validId(receiverId)||receiverId===actor)throw Error('Negociação indisponível.');
   if(previous.exists()){
    if(previous.get('senderId')!==actor||previous.get('receiverId')!==receiverId||previous.get('text')!==message)throw Error('Recibo inconsistente.');
    return;
   }
   if(!['pending','accepted','completion_requested'].includes(current.get('status')))throw Error('Negociação encerrada.');
   tx.set(messageRef,{senderId:actor,receiverId,text:message,createdAt:serverTimestamp()});
 });
 checkSession(actor);
}


export async function readHiringApplication(applicationId:string):Promise<HiringApplication>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(applicationId))throw Error('Candidatura inválida.');
 const snapshot=await getDocFromServer(doc(db,'candidaturas',applicationId));
 checkSession(actor);
 const x=snapshot.data();
 if(!x||typeof x.ownerId!=='string'||typeof x.userId!=='string'||typeof x.vagaId!=='string'||applicationId!==x.vagaId+'__'+x.userId||![x.ownerId,x.userId].includes(actor)||!['pending','accepted','rejected','withdrawn','completion_requested','completed'].includes(x.status))throw Error('Negociação indisponível.');
 return {id:applicationId,ownerId:x.ownerId,userId:x.userId,vagaId:x.vagaId,status:x.status as HiringApplication['status'],terms:parseHiringTerms(x.terms)??undefined};
}
