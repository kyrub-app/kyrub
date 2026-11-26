import {useRef,useState} from 'react';
import {KyrubCidSosConfigEditor} from './KyrubCidSosConfigEditor';
import type {CidEditorAdapter} from '../../shared/cidSosConfigEditor';
import {CID_SOS_RESOLUTION_LABELS,type CidSosResolution} from '../../shared/cidSosResolution';
type Overview={
 tagId:string;
 occurrences:readonly {id:string;reason:string;createdAt:number;status:string;resolution?:CidSosResolution}[];
 hasOlderOccurrences:boolean;
 notices:readonly {occurrenceId:string;createdAt:number;kind:string}[];
 sos:{enabled:boolean;available:boolean;smsAvailable:boolean;people:readonly {name:string;role:string;channels:readonly {channel:string;verified:boolean}[]}[]};
 location:{access:{observedAt:number}|null;shared:{observedAt:number;occurrenceId:string;point:{latitude:number;longitude:number;accuracy:number}}|null;device:{observedAt:number;point:{latitude:number;longitude:number;accuracy:number}}|null;labels:{access:string;shared:string;device:string;accessNote:string;sharedNote:string;deviceNote:string}};
};
export type CidOwnerCentralSession={read:()=>Promise<Overview>;revoke:()=>Promise<void>;editor?:CidEditorAdapter};
type Session=CidOwnerCentralSession;
type Props={open:()=>Promise<Session>;onOccurrence:(id:string)=>void};
const card='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm';
const date=(n:number)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(n);
const sections=[['occurrences','Ocorrências e chats'],['notices','Avisos'],['sos','Configurar SOS'],['location','Localização Assistida']] as const;
// Only mounted by an isolated harness; no production route or direct Firebase access.
export function KyrubCidOwnerCentralHomologation({open,onOccurrence}:Props){
 const [data,setData]=useState<Overview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[section,setSection]=useState<typeof sections[number][0]>('occurrences');
 const session=useRef<Session|null>(null),lock=useRef(false);
 const [editorBusy,setEditorBusy]=useState(false);
 async function authenticate(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const next=await open();const view=await next.read();session.current=next;setData(view);}catch{setError('Não foi possível autenticar o titular.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function refresh(){
  if(lock.current||!session.current)return;lock.current=true;setBusy(true);setError('');
  try{setData(await session.current.read());}catch{session.current=null;setData(null);setError('Sessão indisponível. Autentique-se novamente.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function leave(){
  if(lock.current)return;lock.current=true;setBusy(true);
  const previous=session.current;session.current=null;setData(null);setError('');
  try{await previous?.revoke();}catch{setError('Sessão local descartada; revogação não confirmada.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Central do Titular em homologação" className="mx-auto max-w-md space-y-3 rounded-xl bg-[#121A17] p-3 text-[#F5F5F3]">
  <h2 className="text-base font-bold text-[#F47825]">Central do Titular</h2><p className="text-xs text-amber-200">Homologação isolada — dados fictícios.</p>
  {!data?<button type="button" disabled={busy} className={card+' w-full'} onClick={()=>void authenticate()}>Acessar meu CID por passkey</button>:<>
   <div className="grid grid-cols-2 gap-2">{sections.map(([key,label])=><button type="button" className={card} key={key} aria-pressed={section===key} disabled={busy||editorBusy} onClick={()=>setSection(key)}>{label}</button>)}</div>
   {section==='occurrences'&&<div className="space-y-2">{data.occurrences.length===0&&<p>Nenhuma ocorrência.</p>}{data.occurrences.map(o=><button type="button" key={o.id} disabled={busy} className={card+' block w-full text-left'} onClick={()=>onOccurrence(o.id)}><strong>{o.reason}</strong><span className="block text-xs">{date(o.createdAt)} · {o.status==='open'?'Aberta':'Encerrada'}{o.resolution?' · '+CID_SOS_RESOLUTION_LABELS[o.resolution]:''}</span></button>)}{data.hasOlderOccurrences&&<p className="text-xs">Exibindo as 50 ocorrências mais recentes. Há registros anteriores.</p>}<p className="text-xs">Abrir uma conversa exige autenticação própria.</p></div>}
   {section==='notices'&&<div className="space-y-2">{data.notices.length===0&&<p>Nenhum aviso.</p>}{data.notices.map(n=><p key={n.occurrenceId} className={card}>{n.kind==='alert'?'Alerta registrado':'Ocorrência resolvida'} · {date(n.createdAt)}</p>)}<p className="text-xs">Resumo do estado das ocorrências, não comprovante de entrega.</p></div>}
   {section==='sos'&&<div className="space-y-2"><p>SOS: {data.sos.enabled?'Configurado':'Desabilitado'} · {data.sos.available?'Canais aptos':'Canais não aptos'}</p>{data.sos.people.map((p,i)=><div className={card} key={i}><strong>{p.name}</strong><p className="text-xs">{p.role==='owner'?'Titular':'Contato de emergência'}</p>{p.channels.map(c=><p key={c.channel} className="text-xs">{c.channel}: {c.verified?'Verificado e autorizado':'Pendente'}</p>)}</div>)}{session.current?.editor?<KyrubCidSosConfigEditor adapter={session.current.editor} onBusy={setEditorBusy} onSaved={async()=>{if(session.current)setData(await session.current.read());}}/>:<p className="text-xs">Consulta somente leitura. Alteração e verificação de canais ainda indisponíveis.</p>}</div>}
   {section==='location'&&<div className="space-y-2"><p className="text-sm font-semibold">{data.location.labels.access}</p><p>{data.location.access?date(data.location.access.observedAt):'Nenhum acesso registrado.'}</p><p className="text-xs">{data.location.labels.accessNote}</p><p className="text-sm font-semibold">{data.location.labels.shared}</p>{data.location.shared?<p>{date(data.location.shared.observedAt)} · {data.location.shared.point.latitude}, {data.location.shared.point.longitude} · precisão {data.location.shared.point.accuracy} m</p>:<p>Nenhuma localização compartilhada no histórico consultado.</p>}<p className="text-xs">{data.location.labels.sharedNote}</p><p className="text-xs">GPS do dispositivo: ainda indisponível.</p></div>}
   <button type="button" className={card+' w-full'} disabled={busy||editorBusy} onClick={()=>void refresh()}>Atualizar central</button><button type="button" className={card+' w-full'} disabled={busy||editorBusy} onClick={()=>void leave()}>Sair da Central</button>
  </>}
  {error&&<p role="status" className="text-sm">{error}</p>}
 </section>;
}
