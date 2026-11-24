import {useState} from 'react';
import {Copy,Share2} from 'lucide-react';
/** Share only the explicitly published destination. No third-party tracking. */
export function PresentationShare({url,title}:{url:string;title:string}){
 const [notice,setNotice]=useState('');
 const copy=async()=>{
  try{await navigator.clipboard.writeText(url);setNotice('Link copiado.');}
  catch{setNotice('Copie o endereço exibido abaixo.');}
 };
 const share=async()=>{
  try{await navigator.share({title,url});}
  catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))await copy();}
 };
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   {typeof navigator.share==='function'&&<button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#34443B] bg-[#1D2924] px-3 text-sm text-white" onClick={()=>void share()}><Share2 className="h-4 w-4"/>Compartilhar</button>}
   <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#34443B] bg-[#1D2924] px-3 text-sm text-white" onClick={()=>void copy()}><Copy className="h-4 w-4"/>Copiar link</button>
  </div>
  <input aria-label="Endereço público para compartilhar" readOnly value={url} onFocus={event=>event.currentTarget.select()} className="w-full rounded-lg border border-[#34443B] bg-[#121A17] p-2 text-xs text-slate-200"/>
  {notice&&<p role="status" className="text-xs text-slate-300">{notice}</p>}
 </div>;
}
