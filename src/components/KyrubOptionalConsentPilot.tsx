import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import type {OptionalConsentAdapter,OptionalConsentView,OptionalConsentPurpose} from '../../shared/privacyOptionalConsent';
export function KyrubOptionalConsentPilot({adapter}:{adapter?:OptionalConsentAdapter}){
 const [items,setItems]=useState<OptionalConsentView[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [choice,setChoice]=useState<{purpose:OptionalConsentPurpose;decision:'grant'|'withdraw'}|null>(null),lock=useRef(false);
 async function load(){
  if(!adapter||lock.current)return;lock.current=true;setBusy(true);setNotice('');setChoice(null);setLoaded(false);setItems([]);
  try{const list=await adapter.list();if(list.some(x=>x.simulation!==true))throw Error('UNCONFIRMED');setItems(list);setLoaded(true);}
  catch{setNotice('Não foi possível consultar suas escolhas.');}finally{lock.current=false;setBusy(false);}
 }
 async function save(){
  if(!adapter||lock.current||!choice)return;
  const item=items.find(x=>x.purpose===choice.purpose);
  if(!item||choice.decision==='grant'&&item.effective||choice.decision==='withdraw'&&!item.canWithdraw)return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   const next=await adapter.change({purpose:item.purpose,expectedRevision:item.revision,version:item.version,decision:choice.decision,confirmed:true});
   if(next.simulation!==true||next.purpose!==item.purpose||next.revision!==item.revision+1||next.effective!==(choice.decision==='grant'))throw Error('UNCONFIRMED');
   setItems(xs=>xs.map(x=>x.purpose===next.purpose?next:x));setNotice(choice.decision==='grant'?'Escolha registrada na simulação.':'Consentimento revogado na simulação.');setChoice(null);
  }catch{setLoaded(false);setItems([]);setChoice(null);setNotice('Não foi possível confirmar a alteração. Atualize suas escolhas.');}finally{lock.current=false;setBusy(false);}
 }
 const btn='min-h-11 rounded-xl border border-[#34443B] px-3 py-2 text-sm disabled:opacity-50';
 return <section aria-label="Consentimentos opcionais" className="mx-auto max-w-lg space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]">
  <div className="flex gap-2 items-center"><ShieldCheck className="h-6 w-6 text-[#F47825]"/><h2 className="text-base font-bold">Meus consentimentos</h2></div>
  <p className="text-xs text-amber-200">Homologação isolada. Nenhum tratamento opcional real é ativado.</p>
  <p className="text-sm">Escolhas facultativas, separadas dos Termos de Uso e da Política de Privacidade. Você pode recusar ou revogar sem perder os serviços que não dependem delas.</p>
  <button type="button" className={btn} onClick={()=>void load()} disabled={busy||!adapter}>{loaded?'Atualizar escolhas':'Consultar escolhas'}</button>
  {!adapter&&<p className="text-xs">Indisponível nesta prévia.</p>}
  {loaded&&items.map(item=><div key={item.purpose} className="space-y-2 rounded-xl border border-[#34443B] p-3"><strong className="text-sm">{item.label}</strong><p className="text-xs">{item.description}</p><p className="text-sm">{item.effective?'Concedido':item.state==='withdrawn'?'Revogado':'Não concedido para a versão atual'}</p><div className="flex flex-wrap gap-2">{!item.effective&&<button type="button" className={btn} disabled={busy} onClick={()=>setChoice({purpose:item.purpose,decision:'grant'})}>Autorizar</button>}{item.canWithdraw&&<button type="button" className={btn} disabled={busy} onClick={()=>setChoice({purpose:item.purpose,decision:'withdraw'})}>Revogar</button>}</div>{choice?.purpose===item.purpose&&<div className="space-y-2"><p className="text-sm">Confirmar {choice.decision==='grant'?'autorização':'revogação'} desta finalidade?</p><button type="button" className={btn} disabled={busy} onClick={()=>void save()}>Confirmar</button><button type="button" className={btn} disabled={busy} onClick={()=>setChoice(null)}>Cancelar</button></div>}</div>)}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
