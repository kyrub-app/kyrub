import {useState} from 'react';
import {Copy} from 'lucide-react';
import {buildCidPixPayload,normalizeCidPix,type CidPixConfig,type CidPixKeyType} from '../../shared/cidPix';

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
 let code:string;try{code=buildCidPixPayload(pix);}catch{return null;}
 return <section className="space-y-2 rounded-xl border border-[#34443B] p-3">
  <h2 className="font-bold text-[#F47825]">Receber via Pix</h2>
  <p className="text-sm text-slate-300">Pagamento direto. Escolha o valor no aplicativo do seu banco e confira o beneficiário antes de confirmar.</p>
  <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#34443B] p-3 text-sm font-semibold" onClick={()=>{if(!navigator.clipboard){setNotice('Abra a opção abaixo e copie o código.');return;}void navigator.clipboard.writeText(code).then(()=>setNotice('Pix copiado. Abra seu banco.')).catch(()=>setNotice('Abra a opção abaixo e copie o código.'));}}><Copy aria-hidden="true" className="h-5 w-5"/>Copiar Pix</button>
  <details><summary className="text-sm underline">Exibir Pix Copia e Cola</summary><textarea aria-label="Código Pix Copia e Cola" readOnly value={code} className={field+' text-xs'} rows={4}/></details>
  {notice&&<p role="status" className="text-xs">{notice}</p>}
 </section>;
}
