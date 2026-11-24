import {useEffect,useRef,useState} from 'react';
import type { OfficialCommunityBinding } from '../../../shared/globalChallengeAdmin';
import type { createGlobalChallengeAdminClient } from '../../utils/adminGlobalChallenges';

export function OfficialCommunityBindingPanel({api}:{api:ReturnType<typeof createGlobalChallengeAdminClient>}){
 const [open,setOpen]=useState(false);
 const [binding,setBinding]=useState<OfficialCommunityBinding|null>(null);
 const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 const button='rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-50';
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[api]);
 const run=async(link=false)=>{
  if(active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setError('');
  try{
   const result=link?await api.linkOfficialCommunity(selected,controller.signal):await api.officialCommunity(controller.signal);
   if(controller.signal.aborted)return;
   setBinding(result.binding);setSelected('');
  }catch{
   if(!controller.signal.aborted){setBinding(null);setSelected('');setError('Não foi possível verificar ou vincular a comunidade. Atualize a consulta e confira a propriedade e sua autorização.');}
  }finally{if(active.current===controller){active.current=null;setBusy(false);}}
 };
 return <section aria-label="Comunidade oficial" className="space-y-3 rounded-xl border border-slate-700 p-3 text-sm">
  <h3 className="font-bold text-white">Comunidade oficial</h3>
  <p className="text-slate-300">Vínculo institucional para divulgação futura dos desafios. Não publica conteúdo nem concede recompensas.</p>
  {!open?<button type="button" className={button} onClick={()=>{setOpen(true);void run();}}>Configurar comunidade oficial</button>:<>
   {busy&&<p role="status">Consultando vínculo…</p>}
   {error&&<p role="alert" className="text-amber-200">{error}</p>}
   {binding?.state==='linked'&&<p role="status" className="break-words text-emerald-300">Comunidade vinculada: {binding.community.name}</p>}
   {binding?.state==='unavailable'&&<p role="alert">Vínculo indisponível. É necessário revisar a comunidade e sua titularidade.</p>}
   {binding?.state==='unlinked'&&<>
    <label className="block text-slate-300">Selecionar comunidade pública de sua propriedade
     <select className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 p-2 text-white" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>
      <option value="">Selecione</option>{binding.candidates.map(c=><option key={c.communityId} value={c.communityId}>{c.name} ({c.communityId})</option>)}
     </select>
    </label>
    {!binding.candidates.length&&<p>Nenhuma comunidade pública de sua propriedade encontrada.</p>}
    {binding.truncated&&<p>A consulta exibe até 50 comunidades próprias. A lista pode estar incompleta.</p>}
    <button type="button" className={button} disabled={!selected||busy} onClick={()=>{
      const candidate=binding.candidates.find(c=>c.communityId===selected);
      if(candidate&&window.confirm('Vincular permanentemente a comunidade “'+candidate.name+'” como canal institucional? Nenhuma publicação será criada.'))void run(true);
    }}>Vincular comunidade oficial</button>
   </>}
   <button type="button" className={button} disabled={busy} onClick={()=>void run()}>Atualizar vínculo</button>
  </>}
 </section>;
}
