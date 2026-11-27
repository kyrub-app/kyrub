import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
export type HourlyAttachment={id:string;role:'worker'|'requester';recordedAt:string;size:number;mimeType:'image/png'};
export function validHourlyAttachments(v:unknown,max:number):v is HourlyAttachment[]{
 return Array.isArray(v)&&v.length<=max&&v.every(a=>a&&typeof a.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(a.id)&&['worker','requester'].includes(a.role)&&typeof a.recordedAt==='string'&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=262144&&a.mimeType==='image/png');
}
export default function HourlyAttachmentPreview({user,offerId,kind,attachment,admin=false}:{user:User;offerId:string;kind:'cancellation'|'excess';attachment:HourlyAttachment;admin?:boolean}){
 const [src,setSrc]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 useEffect(()=>{if(!src)return;const hide=()=>setSrc(null);const timer=window.setTimeout(hide,60000);window.addEventListener('blur',hide);return()=>{window.clearTimeout(timer);window.removeEventListener('blur',hide);};},[src]);
 async function open(){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setSrc(null);
  try{
   const token=await user.getIdToken(admin);if(!live())return;
   const endpoint=admin?'/api/admin/freelance-financial-review?view=hourly_attachment':'/api/freelance/finance?view=hourly_review_attachment';
   const r=await fetch(endpoint+'&kind='+kind+'&offerId='+encodeURIComponent(offerId)+'&attachmentId='+encodeURIComponent(attachment.id),{headers:{authorization:'Bearer '+token},cache:'no-store',signal:ctl.signal}),v=await r.json();if(!live())return;
   if(!r.ok||v?.id!==attachment.id||v.mimeType!=='image/png'||v.bankVerified!==false||typeof v.pngBase64!=='string'||v.pngBase64.length!==Math.ceil(attachment.size/3)*4||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.pngBase64))throw Error('Anexo não confirmado.');
   if(!document.hidden)setSrc('data:image/png;base64,'+v.pngBase64);
  }catch(e){if(live())setError(e instanceof Error?e.message:'Anexo indisponível.');}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 if(auth.currentUser?.uid!==user.uid)return null;
 return <div className="space-y-2 rounded border border-slate-700 p-2"><p>{attachment.role==='worker'?'Profissional':'Contratante'} · PNG · {Math.ceil(attachment.size/1024)} KiB</p><button type="button" disabled={busy} onClick={()=>src?setSrc(null):void open()} className="rounded-xl border border-slate-700 px-3 py-2 text-sm">{src?'Ocultar anexo':'Consultar anexo privado'}</button>{error&&<p role="alert">{error}</p>}{src&&<img src={src} alt="Anexo privado de análise" className="max-w-full max-h-96 object-contain"/>}</div>;
}
