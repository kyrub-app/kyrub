import {useState} from 'react';
import {changeSocialBlock,legacySocialBlocks,migrateLegacySocialBlocks,useSocialBlocks} from '../hooks/useSocialBlocks';
export function BlockedContactsPanel({uid}:{uid:string}){
 const {entries,ready}=useSocialBlocks(uid);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[version,setVersion]=useState(0);
 const legacy=legacySocialBlocks(uid);
 async function unblock(id:string){
  if(busy||!window.confirm('Desbloquear este contato? A conexão anterior não será restaurada.'))return;
  setBusy(true);setNotice('');
  try{await changeSocialBlock(id,false,uid);setVersion(v=>v+1);setNotice('Contato desbloqueado.');}
  catch{setNotice('Não foi possível desbloquear. Tente novamente.');}
  finally{setBusy(false);}
 }
 return <details className="rounded-xl border border-slate-700 p-3 text-sm" data-revision={version}>
  <summary className="cursor-pointer font-semibold">Contatos bloqueados · {entries.length}</summary>
  <p className="mt-2 text-xs text-slate-400">Bloqueios impedem novas conexões e chat. Desbloquear não restabelece uma conexão antiga.</p>
  {!ready&&<p className="mt-2 text-xs text-slate-400">Consultando bloqueios…</p>}
  {ready&&!entries.length&&!legacy.length&&<p className="mt-2 text-xs text-slate-400">Nenhum contato bloqueado.</p>}
  {entries.map(item=><div key={item.id} className="mt-2 flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{item.name}</span><button type="button" disabled={busy} className="min-h-11 rounded-lg border border-slate-600 px-2" onClick={()=>void unblock(item.id)}>Desbloquear</button></div>)}
  {legacy.length>0&&<div className="mt-2 space-y-2"><p className="text-xs text-amber-200">Existem bloqueios antigos neste aparelho aguardando confirmação no servidor.</p><button type="button" disabled={busy} className="min-h-11 underline" onClick={()=>{setBusy(true);void migrateLegacySocialBlocks(uid).finally(()=>{setBusy(false);setVersion(v=>v+1);});}}>Sincronizar bloqueios antigos</button></div>}
  {notice&&<p role="status" className="mt-2 text-xs">{notice}</p>}
 </details>;
}
