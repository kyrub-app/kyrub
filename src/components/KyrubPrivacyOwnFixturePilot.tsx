import {useRef,useState} from 'react';
import type {PrivacyOwnFixtureAdapter} from '../../shared/privacyOwnFixtureWorkspace';
import {PRIVACY_EXPORT_CATEGORIES,type PrivacyOwnDataExport} from '../../shared/privacyOwnDataExport';
import {normalizePrivacyFixtureCorrection,type PrivacyFixtureConfirmation} from '../../shared/privacyOwnDataCorrection';
type Action='export'|'confirm'|'correct';
const field='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50';
export function KyrubPrivacyOwnFixturePilot({adapter}:{adapter?:PrivacyOwnFixtureAdapter}){
 const [protocol,setProtocol]=useState(''),[code,setCode]=useState(''),[action,setAction]=useState<Action>('export');
 const [before,setBefore]=useState(''),[after,setAfter]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [data,setData]=useState<PrivacyOwnDataExport|null>(null),[confirmation,setConfirmation]=useState<PrivacyFixtureConfirmation|null>(null),lock=useRef(false);
 function clear(){setData(null);setConfirmation(null);setNotice('');setConfirmed(false);}
 const ready=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(protocol.trim())&&/^[A-Za-z0-9_-]{43}$/.test(code.trim());
 async function run(){
  if(!adapter||!ready||lock.current||action==='correct'&&!confirmed)return;
  lock.current=true;setBusy(true);clear();
  try{
   const p=protocol.trim(),c=code.trim();
   if(action==='export'){
    const r=await adapter.exportOwn(p,c);if(r.protocol!==p||r.simulation!==true||r.completeAccessResponse!==false||r.formatVersion!==1)throw Error('UNCONFIRMED');
    setData(r);
   }else if(action==='confirm'){
    const r=await adapter.confirmOwn(p,c);if(r.protocol!==p||r.simulation!==true||r.completeConfirmationResponse!==false)throw Error('UNCONFIRMED');
    setConfirmation(r);
   }else{
    const r=await adapter.correctOwn(p,c,normalizePrivacyFixtureCorrection({expectedDisplayName:before,displayName:after}));
    if(r.protocol!==p||r.simulation!==true||r.completeCorrectionResponse!==false||r.corrected!==true||r.field!=='displayName')throw Error('UNCONFIRMED');
    setBefore('');setAfter('');setNotice('Nome fictício corrigido. O protocolo permanece aberto.');
   }
  }catch{setNotice('Não foi possível confirmar a operação. Confira a titularidade, o protocolo, o aviso revisado e a autenticação recente.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Atendimento de dados próprios" className="space-y-3">
  <h3 className="text-base font-bold">Meus dados — homologação</h3>
  <p className="text-xs text-amber-200">Somente dados fictícios. Cada operação exige seu próprio protocolo revisado e a conta correspondente autenticada recentemente. Não é resposta completa de privacidade.</p>
  <form className="space-y-2" onSubmit={e=>{e.preventDefault();void run();}}>
   <label className="block text-sm">Operação<select aria-label="Operação" className={field+' block w-full bg-[#1D2924]'} disabled={busy} value={action} onChange={e=>{clear();setBefore('');setAfter('');setAction(e.target.value as Action);}}><option value="export">Consultar dados fictícios</option><option value="confirm">Confirmar tratamento fictício</option><option value="correct">Corrigir nome fictício</option></select></label>
   <label className="block text-sm">Protocolo<input className={field+' block w-full bg-[#1D2924]'} value={protocol} maxLength={36} disabled={busy} onChange={e=>{clear();setProtocol(e.target.value);}}/></label>
   <label className="block text-sm">Código privado<input type="password" autoComplete="off" className={field+' block w-full bg-[#1D2924]'} value={code} maxLength={43} disabled={busy} onChange={e=>{clear();setCode(e.target.value);}}/></label>
   {action==='correct'&&<><label className="block text-sm">Nome fictício atual<input className={field+' block w-full bg-[#1D2924]'} value={before} maxLength={120} disabled={busy} onChange={e=>{clear();setBefore(e.target.value);}}/></label><label className="block text-sm">Novo nome fictício<input className={field+' block w-full bg-[#1D2924]'} value={after} maxLength={120} disabled={busy} onChange={e=>{clear();setAfter(e.target.value);}}/></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a correção do nome fictício.</label></>}
   <button type="submit" className={field+' w-full'} disabled={!adapter||busy||!ready||action==='correct'&&(!confirmed||!before||!after.trim()||before===after.trim())}>{action==='correct'?'Confirmar correção fictícia':'Consultar resultado fictício'}</button>
  </form>
  {!adapter&&<p className="text-xs">Atendimento indisponível nesta prévia.</p>}
  {data&&<div className="space-y-2 rounded-xl border border-[#34443B] p-3"><strong>Dados fictícios disponíveis</strong>{data.data.profile&&<p className="text-sm">Nome: {data.data.profile.displayName}</p>}{data.data.preferences&&<p className="text-sm">Idioma: {data.data.preferences.locale} · Tema: {data.data.preferences.theme}</p>}<p className="text-xs">Consulta parcial. Nenhuma entrega oficial concluída.</p></div>}
  {confirmation&&<div className="space-y-2 rounded-xl border border-[#34443B] p-3"><strong>Categorias fictícias consultadas</strong>{confirmation.categories.map(c=><p className="text-sm" key={c}>{PRIVACY_EXPORT_CATEGORIES[c]}</p>)}<p className="text-xs">Resultado parcial de homologação.</p></div>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
