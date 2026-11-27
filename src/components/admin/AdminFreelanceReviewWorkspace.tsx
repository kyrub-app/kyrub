import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Item={offerId:string;occurrenceId:string;title:string;kind:string;priorStatus:string;openedAt:string;openedByRole:string;response:string|null;canResume:boolean;canDecide:boolean};
type Page={items:Item[];nextCursor:string|null};
const kinds:Record<string,string>={cancellation_requested:'Pedido de cancelamento',service_disputed:'Divergência de serviço',safety_or_force_majeure:'Segurança ou força maior'};
const stages:Record<string,string>={contracted:'Contratado',in_progress:'Em execução',completion_requested:'Conclusão solicitada'};
const errors:Record<string,string>={FREELANCE_REVIEW_DISABLED:'Área preparada, ainda não habilitada.',second_factor_required:'Entre com autenticação multifator para acessar esta área.',reauthentication_required:'Renove sua sessão com autenticação multifator.',FORBIDDEN:'Acesso administrativo não autorizado.',FREELANCE_CONFLICT:'A ocorrência foi alterada ou contém inconsistências. Consulte novamente.'};
export default function AdminFreelanceReviewWorkspace({user}:{user:User}){
 const [page,setPage]=useState<Page|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState<Item|null>(null);
 const [outcome,setOutcome]=useState<'cancel'|'resume'>('cancel');
 const [reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const request=useRef(0);
 const lock=useRef(false);
 useEffect(()=>()=>{request.current+=1;},[]);
 const execute=async(method:'GET'|'POST',cursor?:string)=>{
  if(lock.current||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;const id=++request.current;
  const active=()=>request.current===id&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  if(method==='GET'){setPage(null);setSelected(null);}
  try{
   const token=await user.getIdToken(true);if(!active())return;
   const res=await fetch('/api/admin/freelance-review'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{
    method,cache:'no-store',headers:{authorization:'Bearer '+token,...(method==='POST'?{'content-type':'application/json'}:{})},
    ...(method==='POST'&&selected?{body:JSON.stringify({offerId:selected.offerId,occurrenceId:selected.occurrenceId,outcome,reason,confirmed})}:{})
   });
   const body=await res.json().catch(()=>null);if(!active())return;
   if(!res.ok)throw Error(errors[body?.code]??'Não foi possível confirmar a operação.');
   if(method==='GET'){
    if(!Array.isArray(body?.items)||(body.nextCursor!==null&&typeof body.nextCursor!=='string'))throw Error('Resposta da fila não confirmada.');
    setPage(body);
   }else{
    if(body?.decision?.outcome!==outcome)throw Error('Decisão não confirmada. Consulte novamente.');
    setPage(null);setSelected(null);setReason('');setConfirmed(false);setMessage('Decisão registrada. Consulte a fila novamente.');
   }
  }catch(e){if(active()){setError(e instanceof Error?e.message:'Consulta indisponível.');if(method==='POST'){setPage(null);setSelected(null);}}}
  finally{lock.current=false;if(active())setBusy(false);}
 };
 const button='rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50';
 return <section id="admin-freelance-review-workspace" className="space-y-3 text-xs text-slate-300">
  <p>Fila restrita de ocorrências operacionais. Não determina pagamentos, reembolsos ou responsabilidade financeira.</p>
  <button type="button" className={button} disabled={busy} onClick={()=>void execute('GET')}>Consultar ocorrências</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status" className="text-emerald-300">{message}</p>}
  {page&&page.items.length===0&&<p>Nenhuma ocorrência pendente nesta página.</p>}
  {page?.items.map(item=><article key={item.offerId+':'+item.occurrenceId} className="space-y-2 rounded-xl border border-slate-800 p-3">
   <h3 className="font-bold text-white break-words">{item.title}</h3><p>{kinds[item.kind]??'Ocorrência'} · {stages[item.priorStatus]??'Etapa não reconhecida'}</p>
   <p>Registro: {item.openedAt} · {item.openedByRole==='requester'?'Contratante':'Prestador'}</p>
   <p>Contraparte: {item.response==='agree'?'Concordou':item.response==='disagree'?'Discordou':'Sem manifestação'}</p>
   <p className="break-all text-[10px]">Referência: {item.offerId} / {item.occurrenceId}</p>
   <button type="button" className={button} disabled={busy||!item.canDecide} onClick={()=>{setSelected(item);setOutcome('cancel');setReason('');setConfirmed(false);}}>Analisar</button>
  </article>)}
  {page?.nextCursor&&<button type="button" className={button} disabled={busy} onClick={()=>void execute('GET',page.nextCursor!)}>Próxima página</button>}
  {selected&&<form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={e=>{e.preventDefault();if(confirmed&&reason.trim().length>=10)void execute('POST');}}>
   <h3 className="font-bold text-white">Decisão: {selected.title}</h3>
   <label className="block">Resultado operacional<select className="mt-1 w-full rounded bg-slate-950 p-2" value={outcome} disabled={busy} onChange={e=>{setOutcome(e.target.value==='resume'?'resume':'cancel');setConfirmed(false);}}>
    <option value="cancel">Cancelar e encaminhar para análise financeira</option>{selected.canResume&&<option value="resume">Retomar etapa anterior</option>}
   </select></label>
   <label className="block">Fundamentação (sem dados pessoais desnecessários)<textarea className="mt-1 w-full rounded bg-slate-950 p-2" minLength={10} maxLength={1000} required value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a decisão operacional fundamentada. Nenhuma movimentação financeira será executada.</label>
   <button type="submit" className={button} disabled={busy||!confirmed||reason.trim().length<10}>Registrar decisão</button>{' '}
   <button type="button" className={button} disabled={busy} onClick={()=>{setSelected(null);setReason('');setConfirmed(false);}}>Voltar</button>
  </form>}
 </section>;
}
