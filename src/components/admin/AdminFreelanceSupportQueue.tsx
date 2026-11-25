import {useState,useRef} from 'react';
import type {User} from 'firebase/auth';
import type {AdminProfile} from '../../utils/adminControlPlane';
import {auth} from '../../utils/firebase';
import {freelanceCloudPreviewEnabled} from '../../utils/freelanceHiringCloud';
type CaseSummary={caseId:string;applicationId:string;kind:string;status:string;createdAt:string};
const outcomes={guidance_provided:'Orientação prestada',agreement_reported:'Acordo informado pelas partes',referred:'Encaminhado para atendimento especializado',unresolved:'Encerrado sem acordo'} as const;
type Outcome=keyof typeof outcomes;
export function freelanceSupportQueueEnabled(){return freelanceCloudPreviewEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW==='true';}
export default function AdminFreelanceSupportQueue({user,profile}:{user:User;profile:AdminProfile}){
 const [items,setItems]=useState<CaseSummary[]|null>(null),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState(''),[outcome,setOutcome]=useState<Outcome>('guidance_provided'),[note,setNote]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<{key:string;id:string}|null>(null);
 if(!freelanceSupportQueueEnabled()||profile.uid!==user.uid||profile.status!=='active'||!['super_admin','operations','support'].includes(profile.role))return null;
 const load=async(next?:string)=>{
  if(busy||auth.currentUser!==user)return;
  setBusy(true);setError('');setNotice('');
  if(!next){setItems(null);setCursor(null);setSelected('');setNote('');}
  try{
   const token=await user.getIdToken();
   if(auth.currentUser!==user)return;
   const response=await fetch('/api/notifications/freelance-support/admin'+(next?'?cursor='+encodeURIComponent(next):''),{cache:'no-store',headers:{authorization:'Bearer '+token}});
   if(!response.ok)throw Error(response.status===403?'A consulta exige autorização e segundo fator administrativo recente.':'Fila indisponível.');
   const payload=await response.json();
   if(!Array.isArray(payload.items)||!(payload.nextCursor===null||typeof payload.nextCursor==='string'))throw Error('Fila inválida.');
   if(auth.currentUser===user){setItems(existing=>next?[...(existing??[]),...payload.items.filter((item:CaseSummary)=>!existing?.some(x=>x.caseId===item.caseId))]:payload.items);setCursor(payload.nextCursor);}
  }catch(e){if(auth.currentUser===user){setItems(null);setCursor(null);setError(e instanceof Error?e.message:'Fila indisponível.');}}
  finally{setBusy(false);}
 };
 const resolve=async()=>{
  if(busy||!selected||!note.trim()||auth.currentUser!==user)return;
  const caseId=selected,key=JSON.stringify([caseId,outcome,note.trim()]);
  const operationId=pending.current?.key===key?pending.current.id:crypto.randomUUID();
  pending.current={key,id:operationId};setBusy(true);setError('');setNotice('');
  try{
   const token=await user.getIdToken();if(auth.currentUser!==user)return;
   const response=await fetch('/api/notifications/freelance-support/resolve',{method:'POST',cache:'no-store',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({caseId,outcome,note,operationId})});
   if(!response.ok){if([400,403,409].includes(response.status))pending.current=null;throw Error('Encerramento não confirmado. Confira autorização, segundo fator e situação do chamado.');}
   const result=await response.json();
   if(result.caseId!==caseId||typeof result.created!=='boolean')throw Error('Recibo inválido.');
   if(auth.currentUser===user){pending.current=null;setItems(existing=>existing?.filter(x=>x.caseId!==caseId)??null);setSelected('');setNote('');setNotice('Atendimento encerrado. As condições da contratação permanecem inalteradas.');}
  }catch(e){if(auth.currentUser===user)setError(e instanceof Error?e.message:'Encerramento não confirmado.');}
  finally{setBusy(false);}
 };
 return <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3 text-sm">
  <h3 className="text-base font-bold text-white">Ocorrências de Freelas</h3>
  <p>Fila de revisão humana — homologação isolada. O encerramento do atendimento não modifica a contratação nem atribui responsabilidade financeira.</p>
  <button type="button" disabled={busy} className="border border-slate-600 rounded-xl p-2" onClick={()=>void load()}>Consultar ocorrências</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {items?.length===0&&<p>Nenhuma ocorrência neste recorte.</p>}
  {items?.map(item=><article key={item.caseId} className="border border-slate-700 rounded-xl p-3 break-all space-y-2"><strong>Desacordo de cancelamento</strong><p>Protocolo: {item.caseId}</p><p>Contratação: {item.applicationId}</p><p>Aberto em: {item.createdAt}</p>
    <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setSelected(item.caseId);setOutcome('guidance_provided');setNote('');}}>Registrar encerramento</button>
    {selected===item.caseId&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void resolve();}}>
      <label className="block">Resultado do atendimento<select value={outcome} onChange={e=>setOutcome(e.target.value as Outcome)} className="block w-full bg-slate-950 p-2">{Object.entries(outcomes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block">Registro interno<textarea required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} className="block w-full bg-slate-950 p-2"/></label>
      <p>Não inclua dados sensíveis. Confirme somente após o atendimento humano.</p>
      <button type="submit" disabled={busy||!note.trim()} className="border border-amber-500 rounded-lg p-2">Confirmar encerramento</button>
      <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setSelected('');setNote('');}}>Voltar</button>
    </form>}
  </article>)}
  {cursor&&<button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>void load(cursor)}>Carregar mais ocorrências</button>}
 </section>;
}
