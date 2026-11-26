import {useId,useRef,useState} from 'react';
import {BellRing,ShieldAlert,MapPin} from 'lucide-react';
import {CID_SOS_NOTICE,CID_SOS_REASON_PLACEHOLDER,normalizeCidSosRequest,type CidSosRequest,type CidSosSharedLocation} from '../../shared/cidSosRequest';

type Props={
 smsAvailable:boolean;
 // Adapters supplied only by a verified isolated harness or a future authorized service.
 submitAlert:(request:CidSosRequest)=>Promise<{accepted:boolean;simulated:boolean}>;
 requestLocation?:()=>Promise<Omit<CidSosSharedLocation,'consent'>>;
 simulation?:boolean;
 privacyUrl:string;
};
const field='min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm';
export function KyrubCidSosAlertForm({smsAvailable,submitAlert,requestLocation,simulation=false,privacyUrl}:Props){
 const id=useId();
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[sms,setSms]=useState(false);
 const [location,setLocation]=useState<CidSosSharedLocation>(),[locating,setLocating]=useState(false);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 const locationEpoch=useRef(0),sending=useRef(false),requestId=useRef<string|undefined>(undefined),lastPayload=useRef('');
 function cancelLocation(){
  locationEpoch.current++;setLocation(undefined);setLocating(false);
 }
 async function chooseLocation(){
  if(!requestLocation||sending.current)return;
  const epoch=++locationEpoch.current;setLocating(true);setNotice('');
  try{
   const point=await requestLocation();
   if(epoch!==locationEpoch.current)return;
   const validated=normalizeCidSosRequest({id:'a'.repeat(32),confirmed:true,reason:'validação',sms:false,location:{...point,consent:true}}).location;
   setLocation(validated);
  }catch{if(epoch===locationEpoch.current)setNotice('Não foi possível obter sua localização. Você pode emitir o alerta sem ela.');}
  finally{if(epoch===locationEpoch.current)setLocating(false);}
 }
 async function submit(){
  if(sending.current||done)return;
  if(locating)cancelLocation();
  setNotice('');
  try{
   const fields={confirmed:true,reason,sms:smsAvailable&&sms,...(!locating&&location?{location}:{})};
   const fingerprint=JSON.stringify(fields);
   if(!requestId.current||lastPayload.current!==fingerprint){requestId.current=crypto.randomUUID();lastPayload.current=fingerprint;}
   const request=normalizeCidSosRequest({id:requestId.current,...fields});
   sending.current=true;setBusy(true);
   const result=await submitAlert(request);
   if(!result.accepted)throw Error('CID_SOS_UNAVAILABLE');
   setDone(true);setNotice(result.simulated?'Simulação concluída. Nenhuma mensagem foi enviada.':'Alerta registrado. A entrega das mensagens ainda precisa ser confirmada.');
   setReason('');setSms(false);cancelLocation();
  }catch{setNotice('Não foi possível registrar o alerta. Confira o motivo e tente novamente. Em perigo imediato, use os números de emergência.');}
  finally{sending.current=false;setBusy(false);}
 }
 if(!open)return <button type="button" onClick={()=>setOpen(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#F47825] p-3 text-sm font-bold text-[#121A17]"><BellRing aria-hidden="true" className="h-5 w-5"/>Emitir alerta</button>;
 return <form aria-label="Emitir alerta SOS" className="space-y-3 rounded-xl border border-[#34443B] p-3" onSubmit={e=>{e.preventDefault();void submit();}}>
  {simulation&&<p className="text-xs text-amber-200">Ambiente de simulação: nenhum alerta real será enviado.</p>}
  {done?<p role="status" className="text-sm">{notice}</p>:<>
   <label htmlFor={id+'-reason'} className="block text-sm font-semibold">Motivo do alerta</label>
   <textarea id={id+'-reason'} className={field} rows={3} value={reason} maxLength={500} required placeholder={CID_SOS_REASON_PLACEHOLDER} disabled={busy} onChange={e=>setReason(e.target.value)}/>
   <p className="text-xs text-slate-300">O titular receberá uma cópia do alerta. Os canais configurados e autorizados pelos contatos serão utilizados quando disponíveis.</p>
   {requestLocation&&<div className="space-y-2">
    <p className="text-xs text-slate-300">Se você optar por compartilhar, a localização e sua margem de precisão ficarão disponíveis aos participantes autorizados desta ocorrência. Isso não comprova a localização da Tag.</p>
    {!location&&!locating?<button type="button" className={field} disabled={busy} onClick={()=>void chooseLocation()}><MapPin aria-hidden="true" className="mr-1 inline h-4 w-4"/>Compartilhar minha localização atual</button>:<><p role="status" className="text-xs">{locating?'Solicitando localização…':'Localização preparada para compartilhar.'}</p><button type="button" className={field} disabled={busy} onClick={cancelLocation}>Não compartilhar localização</button></>}
   </div>}
   {smsAvailable&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={sms} disabled={busy} onChange={e=>setSms(e.target.checked)}/>Enviar também por SMS</label>}
   <div className="space-y-1 rounded-lg border border-amber-500/50 p-3 text-xs text-amber-100"><strong className="flex items-center gap-2"><ShieldAlert aria-hidden="true" className="h-5 w-5"/>Uso responsável</strong><p>{CID_SOS_NOTICE}</p><a href={privacyUrl} className="underline">Aviso de privacidade</a></div>
   <p className="text-xs text-slate-300">Este alerta não substitui os serviços públicos de emergência.</p>
   <button type="submit" disabled={busy||!reason.trim()} className="min-h-11 w-full rounded-xl bg-[#F47825] p-3 text-sm font-bold text-[#121A17] disabled:opacity-50">{busy?'Registrando…':simulation?'Simular emissão do alerta':'Confirmar e emitir alerta'}</button>
   {notice&&<p role="status" className="text-xs">{notice}</p>}
  </>}
  <button type="button" className={field} disabled={busy} onClick={()=>{cancelLocation();setReason('');setSms(false);setNotice('');setDone(false);setOpen(false);requestId.current=undefined;lastPayload.current='';}}>Fechar</button>
 </form>;
}
