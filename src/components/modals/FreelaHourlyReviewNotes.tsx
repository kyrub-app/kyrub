import HourlyAttachmentPreview,{validHourlyAttachments,type HourlyAttachment} from './HourlyAttachmentPreview';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Kind='cancellation'|'excess'|'fixed_cancellation'|'fixed_adjustment';
type Note={id:string;role:'worker'|'requester';note:string;recordedAt:string};
type View={offerId:string;kind:Kind;sourceDigest:string;canSubmit:boolean;notes:Note[];attachments:HourlyAttachment[]};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
export default function FreelaHourlyReviewNotes({user,offerId,kind,sourceDigest}:{user:User;offerId:string;kind:Kind;sourceDigest:string}){
 const [v,setV]=useState<View|null>(null),[note,setNote]=useState(''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [file,setFile]=useState<File|null>(null),[attachId,setAttachId]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function execute(send=false,attach=false){
  if(active.current||auth.currentUser?.uid!==user.uid||(attach&&(!v?.canSubmit||!attachId||!file||file.type!=='image/png'||file.size<1||file.size>262144))||(send&&(!v?.canSubmit||!pending||note.trim().length<10||note.trim().length>500)))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/finance';
   if(attach&&file&&attachId){
    const bytes=new Uint8Array(await file.arrayBuffer());if(!live())return;
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action:'submit_hourly_review_attachment',kind,sourceDigest,attachmentId:attachId,pngBase64:btoa(binary),confirmed:true})}),ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error(ack?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Anexo não confirmado. Consulte novamente.');
    setFile(null);setAttachId(null);
   }
   if(send){
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action:'submit_hourly_review_note',kind,sourceDigest,evidenceId:pending,note:note.trim(),confirmed:true})}),ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error(ack?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Manifestação não confirmada. Consulte novamente.');
    setNote('');setPending(null);
   }
   const r=await fetch(url+'?view=hourly_review_notes&offerId='+encodeURIComponent(offerId)+'&kind='+kind,{headers,cache:'no-store',signal:ctl.signal}),data=await r.json();if(!live())return;
   if(!r.ok||data?.offerId!==offerId||data.kind!==kind||data.sourceDigest!==sourceDigest||typeof data.canSubmit!=='boolean'||!validHourlyAttachments(data.attachments,1)||!Array.isArray(data.notes)||data.notes.length>2||!data.notes.every((n:Note)=>n&&typeof n.id==='string'&&typeof n.note==='string'&&n.note.length>=10&&n.note.length<=500&&typeof n.recordedAt==='string'&&['worker','requester'].includes(n.role)))throw Error('Consulta de manifestações indisponível.');
   setV(data);setPending(null);setAttachId(null);
  }catch(e){if(live()){setV(null);setPending(null);setAttachId(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 return <section className="space-y-2 border-t border-slate-700 pt-2"><h5 className="font-bold">Minhas manifestações privadas</h5><p>Somente a administração autorizada poderá consultar o conteúdo das duas partes. Não inclua dados bancários, senhas ou links.</p><button type="button" className={btn} disabled={busy||!!pending||!!attachId} onClick={()=>void execute()}>Consultar minhas manifestações</button>{error&&<p role="alert">{error}</p>}
 {v&&<>{v.notes.map(n=><p key={n.id} className="whitespace-pre-wrap break-words">{n.note}</p>)}{v.canSubmit&&v.notes.length<2&&<><label className="block">Manifestação complementar<textarea className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2" maxLength={500} value={note} disabled={busy||!!pending} onChange={e=>setNote(e.target.value)}/></label><button type="button" className={btn} disabled={busy||!!pending||!!attachId||note.trim().length<10} onClick={()=>setPending(crypto.randomUUID())}>Enviar manifestação privada</button></>}{!v.canSubmit&&<p>Análise encerrada. Registro preservado.</p>}</>}
 {v&&<div className="space-y-2"><h5 className="font-bold">Meu anexo privado</h5>{v.attachments.map(a=><HourlyAttachmentPreview key={a.id} user={user} offerId={offerId} kind={kind} attachment={a}/>)}{v.canSubmit&&v.attachments.length===0&&<><label className="block">Anexo fictício PNG (até 256 KiB)<input type="file" accept="image/png" disabled={busy||!!pending||!!attachId} onChange={e=>{const f=e.target.files?.[0];if(f&&(f.type!=='image/png'||!f.size||f.size>262144)){setError('Selecione PNG de até 256 KiB.');setFile(null);e.target.value='';}else{setError('');setFile(f??null);}}}/></label><button type="button" className={btn} disabled={busy||!!pending||!!attachId||!file} onClick={()=>setAttachId(crypto.randomUUID())}>Enviar anexo privado</button></>}</div>}
 {attachId&&<div><p>Confirma o envio do anexo fictício para análise administrativa?</p><button type="button" className={btn} disabled={busy} onClick={()=>void execute(false,true)}>Confirmar anexo</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setAttachId(null)}>Voltar</button></div>}
 {pending&&<div><p>Confirma o envio da manifestação para análise administrativa?</p><button type="button" className={btn} disabled={busy} onClick={()=>void execute(true)}>Confirmar envio</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
