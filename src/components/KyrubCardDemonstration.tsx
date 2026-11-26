import { useState } from 'react';
import { Pencil, HeartPulse, UserRound, Store, Users, Info } from 'lucide-react';
import { CARD_DRAFT_KEY, EMPTY_CARD_DRAFT, loadCardDraft, saveCardDraft, clearCardDraft, normalizeCardDraft, type CardDraft } from '../utils/cardDemonstrationDraft';

const fields=[
 {key:'name',label:'Nome',placeholder:'Como deseja ser chamado?',max:80},
 {key:'occupation',label:'Título ou atividade',placeholder:'Sua atividade ou apresentação',max:90},
 {key:'about',label:'Informações adicionais',placeholder:'Conte um pouco sobre você',max:320},
 {key:'profile',label:'Perfil no Kyrub',placeholder:'@seu-perfil',max:120},
 {key:'store',label:'Loja no Kyrub',placeholder:'@sua-loja',max:120},
 {key:'community',label:'Comunidade no Kyrub',placeholder:'sua-comunidade',max:120},
] as const;
const button='min-h-11 rounded-xl border border-[#34443B] px-3 py-2 text-sm font-semibold';
export function KyrubCardDemonstration({draftKey=CARD_DRAFT_KEY,onSave,onClear,children,previewOnly=false}: {
 draftKey?:string;onSave?:(draft:CardDraft)=>void;onClear?:()=>void;children?:React.ReactNode;previewOnly?:boolean
}){
 const [saved,setSaved]=useState<CardDraft|null>(()=>{try{return loadCardDraft(sessionStorage,draftKey);}catch{return null;}});
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState<CardDraft>(()=>saved??{...EMPTY_CARD_DRAFT});
 const [sos,setSos]=useState(false);
 const [notice,setNotice]=useState('');
 function save(){
  const clean=normalizeCardDraft(draft);
  if(!clean){setNotice('Confira os identificadores do Kyrub (sem espaços ou endereços externos).');return;}
  try{if(!saveCardDraft(sessionStorage,clean,draftKey)){setNotice('Não foi possível guardar o rascunho neste navegador.');return;}}
  catch{setNotice('Armazenamento local indisponível.');return;}
  setSaved(clean);setDraft(clean);setEditing(false);onSave?.(clean);
  setNotice(previewOnly?'Rascunho salvo nesta aba. Nada foi publicado.':'Rascunho salvo. Confirme a titularidade para publicar nesta tag.');
 }
 function clear(){
  try{if(!clearCardDraft(sessionStorage,draftKey)){setNotice('Não foi possível apagar o rascunho.');return;}}catch{setNotice('Armazenamento local indisponível.');return;}
  setSaved(null);setDraft({...EMPTY_CARD_DRAFT});setEditing(false);onClear?.();setNotice('Rascunho apagado.');
 }
 const rows=[
  {label:'Perfil no Kyrub',value:saved?.profile,example:'Seu perfil no Kyrub',Icon:UserRound},
  {label:'Loja no Kyrub',value:saved?.store,example:'Sua loja no Kyrub',Icon:Store},
  {label:'Comunidade no Kyrub',value:saved?.community,example:'Sua comunidade no Kyrub',Icon:Users},
  {label:'Informações adicionais',value:saved?.about,example:'Conte um pouco mais sobre você',Icon:Info}
 ];
 return <section data-testid="kyrub-card-demo" className="space-y-4 rounded-2xl border border-[#34443B] bg-[#121A17] p-4 text-[#F5F5F3]">
  <header className="flex justify-end"><a href="/" className="inline-flex min-h-11 items-center rounded-xl border border-[#F47825] px-3 text-sm font-bold text-[#F47825]">Kairub-se!</a></header>
  <div className="space-y-2 text-center">
   <img src="/kyrub-logo.svg" alt="Kyrub" className="mx-auto h-24 w-24 object-contain"/>
   <p className="text-sm text-slate-300">{saved?'Prévia privada · não publicada':'Cartão demonstrativo'}</p>
   <h1 className="break-words text-2xl font-bold">{saved?saved.name||'Meu cartão':'Kyrub'}</h1>
   {(!saved||saved.occupation)&&<p className="text-sm text-[#F47825]">{saved?saved.occupation:'Seu cartão de identificação digital'}</p>}
  </div>
  {!saved&&<p className="text-sm leading-6 text-slate-200">Oi! Eu sou o Kyrub, seu novo cartão de identificação digital. Você pode personalizar todas as informações que vê aqui. Toque no lápis abaixo e me deixe com a sua cara!</p>}
  {!editing&&<div className="space-y-3 border-t border-[#34443B] pt-3">
   {rows.filter(row=>!saved||row.value).map(({label,value,example,Icon})=><div key={label} className="flex items-start gap-3"><Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#F47825]"/><div className="min-w-0"><h2 className="text-sm font-bold">{label}</h2><p className="break-words whitespace-pre-wrap text-sm text-slate-300">{value||example}</p></div></div>)}
  </div>}
  {editing?<form className="space-y-3" onSubmit={e=>{e.preventDefault();save();}}>
   <p className="text-sm text-slate-300">Preencha apenas informações que você gostaria de tornar públicas depois. Não informe CPF, senhas, endereço residencial ou dados de saúde. O rascunho fica nesta aba até você apagá-lo ou fechar a sessão do navegador.</p>
   {fields.map(field=><label key={field.key} className="block text-sm">{field.label} (opcional)
    {field.key==='about'?<textarea rows={3} maxLength={field.max} value={draft[field.key]} placeholder={field.placeholder} onChange={e=>setDraft(d=>({...d,[field.key]:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3"/>:<input maxLength={field.max} value={draft[field.key]} placeholder={field.placeholder} onChange={e=>setDraft(d=>({...d,[field.key]:e.target.value}))} className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3"/>}
   </label>)}
   <div className="flex gap-2"><button className="min-h-11 flex-1 rounded-xl bg-[#F47825] px-3 font-bold text-[#121A17]" type="submit">Salvar</button><button className={button} type="button" onClick={()=>{setEditing(false);setDraft(saved??{...EMPTY_CARD_DRAFT});setNotice('');}}>Cancelar</button></div>
  </form>:<div className="grid grid-cols-2 gap-2">
   <button type="button" className={button+' flex items-center justify-center gap-2 text-[#F47825]'} onClick={()=>{setDraft(saved??{...EMPTY_CARD_DRAFT});setEditing(true);setNotice('');}}><Pencil aria-hidden="true" className="h-5 w-5"/>Editar</button>
   <button type="button" className={button+' flex items-center justify-center gap-2 text-rose-300'} aria-expanded={sos} onClick={()=>setSos(v=>!v)}><HeartPulse aria-hidden="true" className="h-5 w-5"/>SOS</button>
  </div>}
  {sos&&<section className="space-y-2 rounded-xl border border-rose-500/50 p-3"><h2 className="font-bold text-rose-200">Emergência no Brasil</h2><p className="text-xs text-slate-300">Números públicos. Ao tocar, você abre o discador; nenhum alerta é enviado automaticamente. Não há contatos particulares neste cartão demonstrativo.</p>{[{name:'Polícia Militar',number:'190'},{name:'SAMU',number:'192'},{name:'Bombeiros',number:'193'}].map(service=><a key={service.number} href={'tel:'+service.number} className="flex min-h-11 items-center justify-between rounded-lg border border-[#34443B] p-2 text-sm"><span>{service.name}</span><strong>{service.number}</strong></a>)}</section>}
  {previewOnly?<p className="text-xs text-slate-300">Demonstração visual. Nenhuma unidade física será ativada nesta página.</p>:!editing&&children}
  {saved&&!editing&&<button type="button" className="text-sm text-slate-300 underline" onClick={clear}>Apagar rascunho</button>}
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
 </section>;
}

export function KyrubCardDemonstrationPage(){
 return <main className="min-h-screen bg-[#121A17] p-4"><div className="mx-auto max-w-md py-4"><KyrubCardDemonstration previewOnly/></div></main>;
}
