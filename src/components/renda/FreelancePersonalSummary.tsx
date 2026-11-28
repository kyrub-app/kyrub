import {useEffect,useState,useRef} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Alert={offerId:string;role:'requester'|'freelancer';title:string;state:string};
type Entry={offerId:string;title:string;agreedMinor:number;confirmedServiceMinor:number|null;state:'projected'|'service_confirmed'|'financial_review';receivedMinor:null};
type Earnings={currency:'BRL';entries:Entry[];projectedMinor:number;confirmedMinor:number;reviewCount:number;receivedMinor:null};
const labels:Record<string,string>={applications_pending:'Candidatura recebida',application_pending:'Sua candidatura está pendente',not_selected:'Candidatura não selecionada',withdrawn:'Candidatura retirada',released:'Seleção liberada',selected:'Seleção registrada',contracted:'Contratação confirmada',in_progress:'Serviço em execução',completion_requested:'Conclusão solicitada',under_review:'Ocorrência em análise',completed:'Serviço concluído',cancelled:'Serviço cancelado'};
const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const minor=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function validAlerts(v:unknown):v is {alerts:Alert[]}{
 const x=v as {alerts:Alert[]};return !!x&&Array.isArray(x.alerts)&&x.alerts.every(a=>a&&id(a.offerId)&&typeof a.title==='string'&&['requester','freelancer'].includes(a.role)&&Object.prototype.hasOwnProperty.call(labels,a.state));
}
function validEarnings(v:unknown):v is Earnings{
 const x=v as Earnings;return !!x&&x.currency==='BRL'&&x.receivedMinor===null&&minor(x.projectedMinor)&&minor(x.confirmedMinor)&&minor(x.reviewCount)&&Array.isArray(x.entries)&&x.entries.every(e=>e&&id(e.offerId)&&typeof e.title==='string'&&minor(e.agreedMinor)&&e.receivedMinor===null&&['projected','service_confirmed','financial_review'].includes(e.state)&&(e.state==='service_confirmed'?minor(e.confirmedServiceMinor)&&e.confirmedServiceMinor===e.agreedMinor:e.confirmedServiceMinor===null));
}
export function FreelancePersonalSummary({view}:{view:'alerts'|'earnings'}){
 const [user,setUser]=useState<User|null>(null),[snapshot,setSnapshot]=useState<{alerts:Alert[]}|Earnings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);const generation=useRef(0);
 useEffect(()=>onAuthStateChanged(auth,u=>{generation.current++;setUser(u);setSnapshot(null);setError('');setBusy(false);}),[]);
 useEffect(()=>{
  if(!user||auth.currentUser?.uid!==user.uid)return;
  const n=++generation.current,abort=new AbortController();
  const active=()=>generation.current===n&&auth.currentUser?.uid===user.uid&&!abort.signal.aborted;
  setSnapshot(null);setBusy(true);setError('');
  void(async()=>{
   const token=await user.getIdToken();if(!active())return;
   const res=await fetch('/api/freelance/workspace?view='+view,{headers:{authorization:'Bearer '+token},cache:'no-store',signal:abort.signal});
   const body=await res.json().catch(()=>null);
   if(!res.ok||!(view==='alerts'?validAlerts(body):validEarnings(body)))throw Error('Consulta não confirmada.');
   if(active())setSnapshot(body);
  })().catch(()=>{if(active())setError('Não foi possível confirmar os registros de Freelas.');}).finally(()=>{if(active())setBusy(false);});
  return()=>{generation.current++;abort.abort();};
 },[user,view,refresh]);
 const current=user&&auth.currentUser?.uid===user.uid?snapshot:null;
 return <section className="space-y-2 text-xs text-slate-300">
  <p className="text-amber-300">Homologação local · registros de teste, sem dinheiro real.</p>
  <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-cyan-300 disabled:opacity-50" disabled={busy||!user} onClick={()=>setRefresh(n=>n+1)}>Atualizar</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert">{error}</p>}
  {view==='alerts'&&current&&'alerts' in current&&<>
   {(['requester','freelancer'] as const).map(role=><div key={role} className="space-y-2"><h4 className="font-bold text-white">{role==='requester'?'Como contratante':'Como prestador'}</h4>
    {current.alerts.filter(a=>a.role===role).map(a=><article key={a.offerId+role} className="rounded-xl border border-slate-800 p-3"><strong>{labels[a.state]}</strong><p className="break-words">{a.title}</p></article>)}
    {!current.alerts.some(a=>a.role===role)&&<p>Nenhum estado confirmado nesta consulta.</p>}</div>)}
   <p>Estados atuais dos contratos e candidaturas, não histórico de notificações nem contador de não lidas.</p>
  </>}
  {view==='earnings'&&current&&'entries' in current&&<>
   <div className="grid grid-cols-2 gap-2">{[['Previsto',money(current.projectedMinor)],['Serviço confirmado',money(current.confirmedMinor)],['Em análise',String(current.reviewCount)+' serviço(s)'],['Recebido','Não verificado']].map(([label,value])=><div key={label} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><p>{label}</p><strong className="block text-sm text-white break-words">{value}</strong></div>)}</div>
   {current.entries.map(e=><article key={e.offerId} className="rounded-xl border border-slate-800 p-3"><strong>{e.title}</strong><p>Valor acordado: {money(e.agreedMinor)}</p><p>{e.state==='service_confirmed'?'Serviço confirmado; recebimento não verificado':e.state==='financial_review'?'Remuneração em análise':'Valor previsto'}</p></article>)}
   <p>Valores brutos acordados, sem confirmação de liquidação. Não representam saldo disponível.</p>
  </>}
 </section>;
}
