import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {isTagId,tagUrl} from '../../../shared/kyrubTagContract';
type Unit={id:string;url:string;claimed:boolean;reserved:boolean;batch:string;slot:string;model:'adesivo';experimental:boolean};
type NfcWriter={write(message:{records:{recordType:'url';data:string}[]},options:{overwrite:false;signal:AbortSignal}):Promise<void>};
const endpoint='/api/admin/operations/health?transport=kyrub-tag-pilot';
const button='min-h-11 rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 disabled:opacity-50';
function checkUnit(unit:Unit|null):Unit|null{
 if(unit===null)return null;
 if(!unit||!isTagId(unit.id)||unit.url!==tagUrl(unit.id)||unit.batch!=='experimental-001'||unit.slot!=='001'||unit.model!=='adesivo'||unit.experimental!==true||typeof unit.claimed!=='boolean'||typeof unit.reserved!=='boolean')throw Error('PILOT_UNAVAILABLE');
 return unit;
}
export default function AdminKyrubTagPilot({user}:{user:User}){
 const [unit,setUnit]=useState<Unit|null>(null),[email,setEmail]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[writing,setWriting]=useState(false),[confirm,setConfirm]=useState(false),[notice,setNotice]=useState('');
 const writer=useRef<AbortController|null>(null),active=useRef(true),requestLock=useRef(false);
 async function request(method:string,action?:string,signal?:AbortSignal){
  if(auth.currentUser?.uid!==user.uid)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(endpoint,{method,cache:'no-store',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:action?JSON.stringify({action,email:email.trim()}):undefined});
  if(!res.ok)throw Error('PILOT_UNAVAILABLE');
  return res.json();
 }
 useEffect(()=>{
  active.current=true;const controller=new AbortController();
  setReady(false);setEmail('');setUnit(null);
  void request('GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted){setUnit(checkUnit(data.unit));setReady(true);}}).catch(()=>{if(!controller.signal.aborted)setNotice('Não foi possível consultar o piloto.');});
  return()=>{active.current=false;controller.abort();writer.current?.abort();};
 },[user.uid]);
 async function mutate(action:'issue'|'reserve'){
  if(!ready||requestLock.current||writing||!confirm)return;
  requestLock.current=true;setBusy(true);setCode('');setShow(false);setConfirm(false);
  try{const data=await request('POST',action);if(!active.current||auth.currentUser?.uid!==user.uid)return;const next=checkUnit(data.unit);if(!next||!next.reserved)throw Error('PILOT_UNAVAILABLE');setUnit(next);setEmail('');setNotice('Destinatária reservada. Entregue somente a etiqueta gravada; ela deverá entrar com a conta indicada e confirmar.');}
  catch{if(active.current){setNotice('Não foi possível confirmar a operação. Recarregue a página antes de tentar novamente.');setReady(false);}}
  finally{requestLock.current=false;if(active.current)setBusy(false);}
 }
 async function write(){
  if(!unit||unit.claimed||writer.current||busy||!ready||auth.currentUser?.uid!==user.uid)return;
  const url=tagUrl(unit.id);
  const Reader=(window as Window&{NDEFReader?:new()=>NfcWriter}).NDEFReader;
  if(!url||!Reader){setNotice('Use um navegador Android compatível com Web NFC.');return;}
  const ctrl=new AbortController();writer.current=ctrl;setWriting(true);setNotice('Aproxime UMA etiqueta vazia e desbloqueada. Não será sobrescrito conteúdo.');
  try{await new Reader().write({records:[{recordType:'url',data:url}]},{overwrite:false,signal:ctrl.signal});if(active.current&&!ctrl.signal.aborted)setNotice('Gravação concluída. Afaste a etiqueta e aproxime novamente fora deste painel para conferir o endereço e a tela de ativação.');}
  catch{if(active.current&&!ctrl.signal.aborted)setNotice('Gravação não confirmada. Use uma etiqueta vazia, confira NFC e permissões.');}
  finally{if(writer.current===ctrl){writer.current=null;if(active.current)setWriting(false);}}
 }
 return <div className="space-y-3 text-sm text-slate-200">
 <p><strong>Lote experimental 001 · Unidade 001 · Adesivo NFC</strong> — somente teste. Não comercializar. Chip Type 2, autenticidade física não comprovada.</p>
 <p>Uma única identidade pode ser emitida. O endereço é público. Somente a conta reservada pode confirmar a vinculação; não é necessário entregar códigos. Nenhum bloqueio permanente será aplicado.</p>
 {!ready?<p role="status">Consulta pendente ou indisponível.</p>:<>
 {unit?<div className="space-y-2 rounded-xl border border-slate-700 p-3"><p>{unit.claimed?'Vinculada definitivamente':unit.reserved?'Reservada para destinatária':'Aguardando reserva da destinatária'}</p><a href={unit.url} target="_blank" rel="noopener noreferrer" className="block break-all text-orange-300 underline">{unit.url}</a>
 <button className={button} type="button" disabled={writing||busy} onClick={()=>void navigator.clipboard.writeText(unit.url).then(()=>setNotice('Endereço público copiado.')).catch(()=>setNotice('Selecione o endereço para copiar.'))}>Copiar endereço público</button>
 {!unit.claimed&&(writing?<button type="button" className={button} onClick={()=>{writer.current?.abort();writer.current=null;setWriting(false);setNotice('Gravação cancelada; confira a etiqueta.');}}>Cancelar gravação</button>:<button type="button" className={button} disabled={busy} onClick={()=>void write()}>Gravar em tag vazia</button>)}
 </div>:<p>Nenhuma unidade emitida.</p>}
 {(!unit||!unit.claimed)&&<><label className="block">E-mail da destinatária (conta Google que usará no Kyrub)<input type="email" value={email} onChange={e=>{setEmail(e.target.value);setConfirm(false);}} autoComplete="off" maxLength={254} disabled={busy||writing} className="mt-1 w-full rounded-xl bg-slate-900 p-3"/></label><label className="flex items-start gap-2"><input type="checkbox" checked={confirm} disabled={busy||writing} onChange={e=>setConfirm(e.target.checked)}/>{unit?'Confirmo reservar esta unidade para o e-mail informado; a reserva anterior e o código antigo deixam de valer.':'Confirmo emitir e reservar a única unidade experimental, sem venda.'}</label><button type="button" className={button} disabled={!confirm||busy||writing||!email.trim()} onClick={()=>void mutate(unit?'reserve':'issue')}>{unit?'Salvar reserva da destinatária':'Emitir e reservar unidade 001'}</button></>}
 </>}
 <p role="status">{notice}</p></div>;
}
