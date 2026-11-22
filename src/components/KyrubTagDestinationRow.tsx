import {useId,useState,type ReactNode} from 'react';
import {Plus,Minus,type LucideIcon} from 'lucide-react';
export function KyrubTagDestinationRow({label,icon:Icon,children,disabled=false}:{label:string;icon:LucideIcon;children:ReactNode;disabled?:boolean}){
 const [expanded,setExpanded]=useState(false);
 const id=useId();
 return <section className="overflow-hidden rounded-[18px] border border-[#34443B] bg-[#121A17]">
  <button type="button" aria-expanded={expanded} aria-controls={id} disabled={disabled} onClick={()=>setExpanded(v=>!v)} className="flex min-h-[62px] w-full items-center gap-3 px-4 py-3 text-left text-lg font-medium text-[#F5F5F3] disabled:opacity-60">
   <Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-[#F47825]"/><span className="min-w-0 flex-1">{label}</span>
   {expanded?<Minus aria-hidden="true" className="h-5 w-5 shrink-0"/>:<Plus aria-hidden="true" className="h-5 w-5 shrink-0"/>}
  </button>
  <div id={id} hidden={!expanded} className={expanded?'space-y-3 border-t border-[#34443B] px-4 pb-4 pt-3':'hidden'}>{expanded?children:null}</div>
 </section>;
}
