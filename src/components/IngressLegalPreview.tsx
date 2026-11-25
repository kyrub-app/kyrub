import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../utils/firebase';
type LegalDoc={type:'terms'|'privacy';id:string;version:string;hash:string;content:string;publishedAt:string};
type Snapshot={terms:LegalDoc;privacy:LegalDoc;accepted:boolean};
type Decision={terms:{id:string;version:string;hash:string;accepted:true};privacy:{id:string;version:string;hash:string;acknowledged:true}};
async function legalRequest(user:User,signal:AbortSignal,decision?:Decision){
 const token=await user.getIdToken(true);
 if(signal.aborted||auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/onboarding/legal',{method:decision?'POST':'GET',signal,cache:'no-store',headers:{Authorization:'Bearer '+token,...(decision?{'Content-Type':'application/json'}:{})},...(decision?{body:JSON.stringify(decision)}:{})});
 if(!response.ok)throw Error(response.status===409?'LEGAL_VERSION_CHANGED':'LEGAL_UNAVAILABLE');
 const data=await response.json();
 if(signal.aborted||auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
 return data;
}
export function IngressLegalPreview({user}:{user:User}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [accepted,setAccepted]=useState(false);
 const [acknowledged,setAcknowledged]=useState(false);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 const active=useRef<AbortController|null>(null);
 const running=useRef(false);
 useEffect(()=>{
  const ctrl=new AbortController();active.current=ctrl;
  setSnapshot(null);setAccepted(false);setAcknowledged(false);setNotice('');
  void legalRequest(user,ctrl.signal).then((data:Snapshot)=>{
   if(data.terms?.type!=='terms'||data.privacy?.type!=='privacy'||typeof data.accepted!=='boolean')throw Error('LEGAL_INVALID');
   if(!ctrl.signal.aborted)setSnapshot(data);
  }).catch(()=>{if(!ctrl.signal.aborted)setNotice('Documentos jurídicos indisponíveis.');});
  return ()=>active.current?.abort();
 },[user,revision]);
 async function submit(){
  if(!snapshot||snapshot.accepted||!accepted||!acknowledged||running.current)return;
  running.current=true;setBusy(true);setNotice('');
  active.current?.abort();const ctrl=new AbortController();active.current=ctrl;
  const ref=(doc:LegalDoc)=>({id:doc.id,version:doc.version,hash:doc.hash});
  try{
   await legalRequest(user,ctrl.signal,{terms:{...ref(snapshot.terms),accepted:true},privacy:{...ref(snapshot.privacy),acknowledged:true}});
   const current:Snapshot=await legalRequest(user,ctrl.signal);
   if(!ctrl.signal.aborted){setSnapshot(current);setAccepted(false);setAcknowledged(false);}
  }catch(error){if(!ctrl.signal.aborted){setSnapshot(null);setAccepted(false);setAcknowledged(false);setNotice(error instanceof Error&&error.message==='LEGAL_VERSION_CHANGED'?'Os documentos foram atualizados. Consulte as novas versões.':'Não foi possível registrar o aceite.');}}
  finally{running.current=false;setBusy(false);}
 }
 return <section aria-label="Documentos de ingresso" className="space-y-3 rounded-xl border border-slate-700 p-3 text-sm">
  <h2 className="text-base font-semibold">Documentos de ingresso</h2>
  <p className="text-xs text-slate-400">Somente homologação. Este registro não libera o aplicativo.</p>
  {notice&&<p role="alert">{notice}</p>}
  {!snapshot?<button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Consultar documentos</button>:<>
   {[snapshot.terms,snapshot.privacy].map(doc=><details key={doc.type+':'+doc.hash} className="rounded-lg border border-slate-700 p-2">
    <summary>{doc.type==='terms'?'Termos de Uso':'Política de Privacidade'} — versão {doc.version}</summary>
    <p className="whitespace-pre-wrap break-words">{doc.content}</p>
   </details>)}
   {snapshot.accepted?<p role="status">Aceite das versões vigentes registrado.</p>:<>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={accepted} disabled={busy} onChange={()=>setAccepted(v=>!v)}/>Aceito os Termos de Uso.</label>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={()=>setAcknowledged(v=>!v)}/>Estou ciente da Política de Privacidade.</label>
    <button type="button" disabled={busy||!accepted||!acknowledged} className="min-h-11 rounded-lg bg-[#F27429] px-3 text-[#121A17] disabled:opacity-50" onClick={()=>void submit()}>Registrar aceite</button>
   </>}
  </>}
 </section>;
}
