import {useState,useRef} from 'react';
import {Copy,Download,QrCode,Share2} from 'lucide-react';
import {QRCodeSVG} from 'qrcode.react';
import {presentationShareUrl} from '../utils/presentationShareUrl';

/** Share only the explicitly published destination. QR encoding is entirely local. */
export function PresentationShare({url,title,showQrByDefault=false}:{url:string;title:string;showQrByDefault?:boolean}){
 const [notice,setNotice]=useState('');
 const [showQr,setShowQr]=useState(showQrByDefault);
 const svgRef=useRef<SVGSVGElement|null>(null);
 const safeUrl=presentationShareUrl(url,window.location.origin);
 const copy=async()=>{
  if(!safeUrl)return;
  try{await navigator.clipboard.writeText(safeUrl);setNotice('Link copiado.');}
  catch{setNotice('Copie o endereço exibido abaixo.');}
 };
 const share=async()=>{
  if(!safeUrl)return;
  try{await navigator.share({title,url:safeUrl});}
  catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))await copy();}
 };
 const download=()=>{
  if(!svgRef.current||!safeUrl)return;
  try{
   const svg=svgRef.current.cloneNode(true) as SVGSVGElement;
   svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
   const blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});
   const objectUrl=URL.createObjectURL(blob);
   const anchor=document.createElement('a');
   anchor.href=objectUrl;anchor.download='kyrub-qr.svg';
   document.body.appendChild(anchor);anchor.click();anchor.remove();
   window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }catch{setNotice('Não foi possível salvar o QR Code. Você pode exibi-lo na tela.');}
 };
 if(!safeUrl)return null;
 const actionClass='inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#34443B] bg-[#1D2924] px-3 text-sm text-white';
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   {typeof navigator.share==='function'&&<button type="button" className={actionClass} onClick={()=>void share()}><Share2 aria-hidden="true" className="h-4 w-4"/>Compartilhar</button>}
   <button type="button" className={actionClass} onClick={()=>void copy()}><Copy aria-hidden="true" className="h-4 w-4"/>Copiar link</button>
   <button type="button" className={actionClass} aria-expanded={showQr} onClick={()=>setShowQr(value=>!value)}><QrCode aria-hidden="true" className="h-4 w-4"/>{showQr?'Ocultar QR Code':'Exibir QR Code'}</button>
  </div>
  {showQr&&<section aria-label="QR Code do endereço público" className="space-y-3 rounded-xl border border-[#34443B] p-3 text-center">
   <p className="font-semibold">Aponte a câmera para acessar</p>
   <div className="mx-auto w-fit max-w-full rounded-lg bg-white">
    <QRCodeSVG ref={svgRef} value={safeUrl} title="QR Code para a apresentação pública" size={288} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" className="h-auto max-w-full"/>
   </div>
   <button type="button" className={actionClass} onClick={download}><Download aria-hidden="true" className="h-4 w-4"/>Salvar QR Code (SVG)</button>
   <p className="text-xs text-slate-300">O código aponta para o endereço público. Alterações na apresentação não exigem um novo QR Code.</p>
  </section>}
  <input aria-label="Endereço público para compartilhar" readOnly value={safeUrl} onFocus={event=>event.currentTarget.select()} className="w-full rounded-lg border border-[#34443B] bg-[#121A17] p-2 text-xs text-slate-200"/>
  {notice&&<p role="status" className="text-xs text-slate-300">{notice}</p>}
 </div>;
}
