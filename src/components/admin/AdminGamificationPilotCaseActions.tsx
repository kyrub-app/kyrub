import {useEffect,useRef,useState} from 'react';
import {submitGamificationPilotCase,type PilotCaseCommand,type PilotSession} from '../../utils/gamificationAdminPilotClient';

const outcomes={resolved:'Resolvido',inconclusive:'Inconclusivo',referred_for_review:'Encaminhado para revisão'} as const;
type Outcome=keyof typeof outcomes;
const messages:Record<string,string>={
 SUSPICION_CASE_NO_INDICATORS:'Nenhum indício técnico permite abrir o caso.',
 SUSPICION_CASE_NOT_RESOLVED:'Ainda há indícios ou a cobertura é incompleta.',
 SUSPICION_CASE_ALREADY_OPEN:'Já existe um caso aberto nesta publicação.',
 SUSPICION_CASE_ID_CONFLICT:'Identificador de caso em conflito.',
 SUSPICION_CASE_CLOSE_CONFLICT:'O caso já foi encerrado com outra decisão.',
};
export default function AdminGamificationPilotCaseActions({session,isCurrent,openCaseId,onSaved}:{
 session:PilotSession;isCurrent:()=>boolean;openCaseId?:string;onSaved:(caseId:string)=>void;
}){
 const [kind,setKind]=useState<'personal'|'community'>('personal');
 const [postId,setPostId]=useState('');
 const [outcome,setOutcome]=useState<Outcome>('inconclusive');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const request=useRef<AbortController|null>(null);
 // Keep an identical command on retry after an uncertain network response.
 const pending=useRef<PilotCaseCommand|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 const reset=()=>{pending.current=null;setConfirmed(false);setMessage('');};
 const submit=async()=>{
  if(!confirmed||request.current||!isCurrent()||(!openCaseId&&!/^[A-Za-z0-9_-]{1,500}$/.test(postId)))return;
  const command=pending.current??(openCaseId?{operation:'close',caseId:openCaseId,outcome,confirmed:true}:
    {operation:'open',caseId:crypto.randomUUID(),kind,postId,confirmed:true});
  pending.current=command;
  const controller=new AbortController();
  request.current=controller;setBusy(true);setMessage('');
  try{
   await submitGamificationPilotCase(command,session,isCurrent,controller.signal);
   if(controller.signal.aborted||!isCurrent())return;
   pending.current=null;setConfirmed(false);onSaved(command.caseId);
  }catch(error){
   if(controller.signal.aborted||!isCurrent())return;
   const code=error instanceof Error?error.message:'';
   setMessage(messages[code]??'Resultado não confirmado. Consulte o histórico ou repita a mesma solicitação.');
  }finally{
   if(!controller.signal.aborted){request.current=null;setBusy(false);}
  }
 };
 return <form className="mt-4 space-y-2 rounded-xl border border-slate-700 p-3" onSubmit={event=>{event.preventDefault();void submit();}}>
  <h4 className="font-bold">{openCaseId?'Encerrar investigação':'Abrir investigação'}</h4>
  <p>Teste isolado. Não bloqueia conta nem altera Pitangas.</p>
  {openCaseId?<label className="block">Desfecho<select value={outcome} disabled={busy} onChange={e=>{setOutcome(e.target.value as Outcome);reset();}}>{Object.entries(outcomes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>:
   <><label className="block">Tipo de publicação<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as 'personal'|'community');reset();}}><option value="personal">Pessoal</option><option value="community">Comunidade</option></select></label>
   <label className="block">Identificador da publicação<input className="block w-full rounded border border-slate-600 bg-slate-900 p-2" value={postId} maxLength={500} disabled={busy} onChange={e=>{setPostId(e.target.value);reset();}} required/></label></>}
  <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta decisão de triagem.</label>
  <button className="rounded border border-slate-600 px-3 py-2 disabled:opacity-50" type="submit" disabled={!confirmed||busy}>{busy?'Enviando…':openCaseId?'Confirmar encerramento':'Confirmar abertura'}</button>
  {message&&<p role="alert">{message}</p>}
 </form>;
}
