import { auth, db } from './firebase';
import { collection, doc, getDocFromServer, getDocsFromServer, query, where, limit, serverTimestamp, setDoc, updateDoc, runTransaction } from 'firebase/firestore';

export type HiringVacancy = { id:string; ownerId:string; title:string; description:string; payment:number; employer:string; status:'open'|'closed' };
export type HiringApplication = { id:string; vagaId:string; ownerId:string; userId:string; status:'pending'|'accepted'|'rejected'|'withdrawn'|'completion_requested'|'completed' };

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
export async function applyToHiringVacancy(vagaId:string):Promise<'created'|'existing'>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}$/.test(vagaId))throw Error('Vaga sem identificador válido para contratação.');
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
   return [{id:d.id,vagaId:x.vagaId,ownerId:x.ownerId,userId:x.userId,status:x.status as HiringApplication['status']}];
 });
}
export async function decideHiringApplication(id:string,status:'accepted'|'rejected'|'withdrawn'):Promise<void>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Candidatura inválida.');
 const ref=doc(db,'candidaturas',id);
 const current=await getDocFromServer(ref);
 checkSession(actor);
 if(!current.exists()||current.get('status')!=='pending'||(status==='withdrawn'?current.get('userId')!==actor:current.get('ownerId')!==actor))throw Error('Candidatura indisponível.');
 await updateDoc(ref,{status,updatedAt:serverTimestamp()});
 checkSession(actor);
}

export async function transitionHiringCompletion(id:string,status:'completion_requested'|'completed'|'accepted'):Promise<void>{
 const actor=uid();
 if(!/^[A-Za-z0-9]{20}__[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Candidatura inválida.');
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
