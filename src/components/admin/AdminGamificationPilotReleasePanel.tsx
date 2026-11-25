import { useEffect,useRef,useState } from 'react';
import { requestGamificationPilot,submitGamificationPilotRelease,type PilotSession,type PilotReleaseCommand } from '../../utils/gamificationAdminPilotClient';
type View={configured:false}|{configured:true;status:'open'|'paused';revision:number;opensAt:string};
export default function AdminGamificationPilotReleasePanel({session,isCurrent,writes}:{session:PilotSession;isCurrent:()=>boolean;writes:boolean}){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const pending=useRef<PilotReleaseCommand|null>(null),running=useRef(false);
 const scope=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;setView(null);setError('');
  void requestGamificationPilot({operation:'release'},session,isCurrent,controller.signal).then(raw=>{
   if(controller.signal.aborted||!isCurrent())return;
   const data=raw as Record<string,unknown>;
   if(data?.environment!=='isolated-emulator')throw Error('INVALID_RELEASE_VIEW');
   if(data.configured===false)setView({configured:false});
   else if(data.configured===true&&(data.status==='open'||data.status==='paused')&&typeof data.revision==='number'&&Number.isSafeInteger(data.revision)&&data.revision>0&&typeof data.opensAt==='string'&&Number.isFinite(Date.parse(data.opensAt)))
    setView({configured:true,status:data.status,revision:data.revision,opensAt:data.opensAt});
   else throw Error('INVALID_RELEASE_VIEW');
  }).catch(()=>{if(!controller.signal.aborted&&isCurrent())setError('Não foi possível consultar o controle.');});
  return ()=>controller.abort();
 },[session,isCurrent,revision]);
 const change=async()=>{
  const controller=scope.current;
  if(!writes||running.current||!controller||controller.signal.aborted||!isCurrent()||!view?.configured)return;
  const command=pending.current??(confirmed&&reason.trim().length>=10?{operation:'release_change',confirmed:true,eventId:crypto.randomUUID(),expectedRevision:view.revision,status:view.status==='open'?'paused':'open',reason:reason.trim()} as PilotReleaseCommand:null);
  if(!command)return;
  pending.current=command;running.current=true;setBusy(true);setError('');
  try{
   await submitGamificationPilotRelease(command,session,isCurrent,controller.signal);
   if(controller.signal.aborted||!isCurrent())return;
   pending.current=null;setReason('');setConfirmed(false);setRevision(r=>r+1);
  }catch{if(!controller.signal.aborted&&isCurrent())setError('Não foi possível confirmar. Consulte o estado ou repita a mesma solicitação.');}
  finally{running.current=false;if(!controller.signal.aborted&&isCurrent())setBusy(false);}
 };
 return <section aria-label="Controle de semeadura" className="mt-4 space-y-3 rounded-xl border border-slate-700 p-3">
  <h4 className="text-sm font-bold">Controle de semeadura · homologação</h4>
  <p className="text-sm text-slate-400">A pausa impede novas sementes. Não altera saldos, XP, recibos ou histórico. Não ativa produção.</p>
  <p role="status" className="text-sm">{!view?'Estado indisponível':!view.configured?'Não configurado':`Estado registrado: ${view.status==='open'?'Aberto':'Pausado'} · revisão ${view.revision}`}</p>
  {view?.configured&&writes&&<>
   <label className="block text-sm">Motivo da decisão<textarea value={reason} disabled={busy||!!pending.current} onChange={e=>setReason(e.target.value)} maxLength={500} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 p-2"/></label>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy||!!pending.current} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo a alteração no ambiente de homologação.</label>
   <button type="button" disabled={busy||(!pending.current&&(!confirmed||reason.trim().length<10))} onClick={()=>void change()} className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm disabled:opacity-50">{busy?'Confirmando…':pending.current?'Repetir mesma solicitação':view.status==='open'?'Confirmar pausa':'Confirmar retomada'}</button>
   {pending.current&&!busy&&<button type="button" onClick={()=>{pending.current=null;setConfirmed(false);setReason('');setRevision(r=>r+1);}} className="ml-2 min-h-11 text-sm underline">Descartar solicitação e consultar estado</button>}
  </>}
  <button type="button" disabled={busy} onClick={()=>setRevision(r=>r+1)} className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm">Consultar estado</button>
  {error&&<p role="alert" className="text-sm text-amber-300">{error}</p>}
 </section>;
}
