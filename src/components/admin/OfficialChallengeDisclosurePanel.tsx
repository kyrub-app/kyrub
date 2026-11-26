import {useEffect,useRef,useState} from 'react';
import type {KyrubChallengeDefinition} from '../../../shared/gamification';
import type {createGlobalChallengeAdminClient} from '../../utils/adminGlobalChallenges';
export function OfficialChallengeDisclosurePanel({challenge,api}:{challenge:KyrubChallengeDefinition;api:ReturnType<typeof createGlobalChallengeAdminClient>}){
 const [open,setOpen]=useState(false),[square,setSquare]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[api]);
 const publish=async()=>{
  if(pending.current||!window.confirm('Divulgar o desafio “'+challenge.title+'” na comunidade oficial'+(square?' e na Taba por 24 horas':'')+'?'))return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setNotice('');
  try{
   const {disclosure}=await api.discloseOfficialChallenge(challenge.id,square,controller.signal);
   if(!controller.signal.aborted)setNotice(disclosure.replay?'Desafio já divulgado.':'Divulgação registrada.');
  }catch{if(!controller.signal.aborted)setNotice('Não foi possível divulgar. A operação ainda depende de homologação e de um vínculo oficial válido.');}
  finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
 };
 return <div className="mt-3 space-y-2 rounded-xl border border-slate-700 p-3 text-sm">
 <button type="button" className="rounded-xl border border-cyan-500/40 px-3 py-2 text-xs font-bold text-cyan-200" disabled={busy} onClick={()=>setOpen(v=>!v)}>Divulgar na comunidade</button>
 {open&&<><p>Publicação institucional vinculada ao desafio original. Disponível apenas em homologação isolada.</p><label className="flex items-center gap-2"><input type="checkbox" checked={square} disabled={busy} onChange={e=>setSquare(e.target.checked)}/> Divulgar também na Taba por 24 horas</label><button type="button" disabled={busy} onClick={()=>void publish()} className="rounded-lg bg-cyan-600 px-3 py-2 font-bold text-white disabled:opacity-50">Confirmar divulgação</button></>}
 {notice&&<p role="status">{notice}</p>}
 </div>;
}
