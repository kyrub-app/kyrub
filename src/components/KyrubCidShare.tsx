import {useState} from 'react';
import {Share2} from 'lucide-react';
import {tagUrl} from '../../shared/kyrubTagContract';

export function KyrubCidShare({tagId,className}:{tagId:string;className:string}){
 const [notice,setNotice]=useState('');
 const url=tagUrl(tagId);
 async function share(){
  if(!url)return;
  setNotice('');
  if(typeof navigator.share==='function'){
   try{await navigator.share({title:'CID · Kyrub',url});return;}
   catch(error){if(error instanceof Error&&error.name==='AbortError')return;}
  }
  try{await navigator.clipboard.writeText(url);setNotice('Endereço do CID copiado.');}
  catch{setNotice(url);}
 }
 return <div className="min-w-0 space-y-1"><button type="button" disabled={!url} className={className+' w-full flex items-center justify-center gap-2'} onClick={()=>void share()}><Share2 aria-hidden="true" className="h-5 w-5 shrink-0"/>Compartilhar</button>{notice&&<p role="status" className="break-all text-xs text-slate-300">{notice}</p>}</div>;
}
