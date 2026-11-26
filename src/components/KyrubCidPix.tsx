import {useState} from 'react';
import {Copy,QrCode} from 'lucide-react';
import {buildCidPixPayload,normalizeCidPix,type CidPixConfig,type CidPixKeyType} from '../../shared/cidPix';

import {cidPixQrMatrix} from '../utils/cidPixQr';

export type CidPixDraft={enabled:boolean;keyType:CidPixKeyType;key:string;recipientName:string;recipientCity:string;publicConsent:boolean};
export function initialCidPixDraft(pix?:CidPixConfig|null):CidPixDraft{
 return pix?{enabled:true,...pix}:{enabled:false,keyType:'random',key:'',recipientName:'',recipientCity:'',publicConsent:false};
}
export function validatedCidPixDraft(draft:CidPixDraft):CidPixConfig|null{
 if(!draft.enabled)return null;
 const {enabled,...config}=draft;
 return normalizeCidPix(config);
}
const field='mt-1 min-h-11 w-full rounded-lg border border-[#34443B] bg-[#1D2924] p-3';
export function KyrubCidPixFields({value,onChange,disabled}:{value:CidPixDraft;onChange:(value:CidPixDraft)=>void;disabled:boolean}){
 function change(patch:Partial<CidPixDraft>){onChange({...value,...patch,publicConsent:false});}
 return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-[#34443B] p-3 text-sm">
  <legend className="px-1 font-semibold">Recebimentos via Pix (opcional)</legend>
  <label className="flex gap-2"><input type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/>Disponibilizar recebimentos via Pix</label>
  {value.enabled&&<>
   <p className="text-slate-300">A transferência será feita diretamente pelo banco do pagador. O Kyrub não recebe nem confirma o pagamento. Prefira uma chave aleatória para preservar seus dados pessoais.</p>
   <label className="block">Tipo de chave Pix<select className={field} value={value.keyType} onChange={e=>change({keyType:e.target.value as CidPixKeyType,key:''})}><option value="random">Chave aleatória</option><option value="email">E-mail</option><option value="phone">Celular (+55 e DDD)</option><option value="cpf">CPF</option><option value="cnpj">CNPJ numérico</option></select></label>
   <label className="block">Chave Pix<input className={field} value={value.key} maxLength={77} autoComplete="off" spellCheck={false} required onChange={e=>change({key:e.target.value})}/></label>
   <label className="block">Nome do recebedor<input className={field} value={value.recipientName} maxLength={25} required onChange={e=>change({recipientName:e.target.value})}/></label>
   <label className="block">Cidade do recebedor<input className={field} value={value.recipientCity} maxLength={15} required onChange={e=>change({recipientCity:e.target.value})}/></label>
   <label className="flex gap-2 text-amber-100"><input type="checkbox" required checked={value.publicConsent} onChange={e=>onChange({...value,publicConsent:e.target.checked})}/>Autorizo a publicação desta chave e dos dados do recebedor para qualquer visitante do CID. O Pix Copia e Cola também contém a chave.</label>
  </>}
 </fieldset>;
}
export function KyrubCidPixPublic({pix}:{pix:CidPixConfig}){
 const [notice,setNotice]=useState('');
 const [showQr,setShowQr]=useState(false);
 const [manual,setManual]=useState<'key'|'code'|null>(null);
 let key:string;try{key=normalizeCidPix(pix).key;}catch{return null;}
 let code:string|null=null;try{code=buildCidPixPayload(pix);}catch{/* A valid key remains usable independently of BR Code. */}
 let matrix:ReturnType<typeof cidPixQrMatrix>|null=null;
 if(showQr&&code){try{matrix=cidPixQrMatrix(code);}catch{/* Keep direct copying available. */}}
 async function copy(value:string,kind:'key'|'code'){
  setNotice('');setManual(null);
  try{
   if(!navigator.clipboard)throw Error('CLIPBOARD_UNAVAILABLE');
   await navigator.clipboard.writeText(value);
   setNotice(kind==='key'?'Chave Pix copiada. Cole no aplicativo de pagamento de sua preferência.':'Pix Copia e Cola copiado. Abra seu aplicativo de pagamento.');
  }catch{
   setManual(kind);
   setNotice('Selecione e copie o conteúdo exibido abaixo.');
  }
 }
 const secondary='flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#34443B] p-2 text-sm font-semibold';
 return <section className="space-y-3 rounded-xl border border-[#34443B] p-3">
  <h2 className="font-bold text-[#F47825]">Pix</h2>
  <p className="text-sm text-slate-300">Pagamento direto ao recebedor. Escolha o valor no seu aplicativo de pagamento e confira o beneficiário antes de confirmar.</p>
  <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#F47825] p-3 text-sm font-bold text-[#121A17]" onClick={()=>void copy(key,'key')}><Copy aria-hidden="true" className="h-5 w-5"/>Copiar chave Pix</button>
  {code&&<div className="grid grid-cols-2 gap-2">
   <button type="button" aria-expanded={showQr} className={secondary} onClick={()=>setShowQr(v=>!v)}><QrCode aria-hidden="true" className="h-5 w-5 shrink-0"/>{showQr?'Ocultar QR Code':'Exibir QR Code'}</button>
   <button type="button" className={secondary} onClick={()=>void copy(code,'code')}><Copy aria-hidden="true" className="h-5 w-5 shrink-0"/>Pix Copia e Cola</button>
  </div>}
  {showQr&&(matrix?<svg role="img" aria-label="QR Code Pix para pagamento" viewBox={'0 0 '+matrix.size+' '+matrix.size} className="mx-auto h-auto w-full max-w-[300px] bg-white" shapeRendering="crispEdges"><rect width={matrix.size} height={matrix.size} fill="#fff"/><path d={matrix.path} fill="#000"/></svg>:<p role="status" className="text-sm">QR indisponível. Use a chave Pix ou o Pix Copia e Cola.</p>)}
  {manual&&<textarea aria-label={manual==='key'?'Chave Pix para cópia manual':'Código Pix Copia e Cola'} readOnly value={manual==='key'?key:code??''} className={field+' text-xs'} rows={manual==='key'?2:4} onFocus={e=>e.currentTarget.select()}/>}
  {notice&&<p role="status" className="text-xs">{notice}</p>}
 </section>;
}
