import {useState} from 'react';
import type {User} from 'firebase/auth';
import type {AdminProfile} from '../../utils/adminControlPlane';
import {auth} from '../../utils/firebase';
import {freelanceCloudPreviewEnabled} from '../../utils/freelanceHiringCloud';
type CaseSummary={caseId:string;applicationId:string;kind:string;status:string;createdAt:string};
export function freelanceSupportQueueEnabled(){return freelanceCloudPreviewEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true';}
export default function AdminFreelanceSupportQueue({user,profile}:{user:User;profile:AdminProfile}){
 const [items,setItems]=useState<CaseSummary[]|null>(null),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!freelanceSupportQueueEnabled()||profile.uid!==user.uid||profile.status!=='active'||!['super_admin','operations','support'].includes(profile.role))return null;
 const load=async()=>{
  if(busy||auth.currentUser!==user)return;
  setBusy(true);setError('');setItems(null);setMore(false);
  try{
   const token=await user.getIdToken();
   if(auth.currentUser!==user)return;
   const response=await fetch('/api/notifications/freelance-support/admin',{cache:'no-store',headers:{authorization:'Bearer '+token}});
   if(!response.ok)throw Error(response.status===403?'A consulta exige segundo fator administrativo recente.':'Fila indisponível.');
   const payload=await response.json();
   if(!Array.isArray(payload.items)||typeof payload.hasMore!=='boolean')throw Error('Fila inválida.');
   if(auth.currentUser===user){setItems(payload.items);setMore(payload.hasMore);}
  }catch(e){if(auth.currentUser===user)setError(e instanceof Error?e.message:'Fila indisponível.');}
  finally{setBusy(false);}
 };
 return <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 text-sm">
  <h3 className="text-base font-bold text-white">Ocorrências de Freelas</h3>
  <p>Fila de revisão humana — homologação isolada, somente consulta. Nenhuma decisão econômica automática.</p>
  <button type="button" disabled={busy} className="border border-slate-600 rounded-xl p-2" onClick={()=>void load()}>Consultar ocorrências</button>
  {error&&<p role="alert">{error}</p>}
  {items?.length===0&&<p>Nenhuma ocorrência neste recorte.</p>}
  {items?.map(item=><article key={item.caseId} className="border border-slate-700 rounded-xl p-3 break-all"><strong>Desacordo de cancelamento</strong><p>Protocolo: {item.caseId}</p><p>Contratação: {item.applicationId}</p><p>Aberto em: {item.createdAt}</p></article>)}
  {more&&<p>Exibindo as primeiras 50 ocorrências. Paginação administrativa pendente.</p>}
 </section>;
}
