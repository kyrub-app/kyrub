import {Pencil,MapPin,MessagesSquare,HeartPulse,Bell,ShieldCheck} from 'lucide-react';

export type CidOwnerSection='edit'|'security'|null;
type Props={section:CidOwnerSection;busy:boolean;onSection:(section:CidOwnerSection)=>void;onPublic:()=>void};
const card='flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-[#34443B] p-3 text-center text-sm font-semibold';
const pending=[
 {label:'Localização Assistida',Icon:MapPin},
 {label:'Ocorrências e chats',Icon:MessagesSquare},
 {label:'Configurar SOS',Icon:HeartPulse},
 {label:'Avisos',Icon:Bell},
] as const;
// Navigation only. No private data access or mutation authorization originates in this component.
export function KyrubCidOwnerCentral({section,busy,onSection,onPublic}:Props){
 return <section aria-label="Central do Titular" className="space-y-3 rounded-xl border border-[#34443B] p-3">
  <header><h2 className="text-base font-bold text-[#F47825]">Central do Titular</h2><p className="text-xs text-slate-300">Gerencie seu CID sem precisar criar uma conta no Kyrub.</p></header>
  <div className="grid grid-cols-2 gap-2">
   <button type="button" disabled={busy} aria-expanded={section==='edit'} className={card} onClick={()=>onSection(section==='edit'?null:'edit')}><Pencil aria-hidden="true" className="h-6 w-6 text-[#F47825]"/>Editar CID</button>
   {pending.map(({label,Icon})=><div key={label} aria-disabled="true" className={card+' opacity-60'}><Icon aria-hidden="true" className="h-6 w-6 text-[#F47825]"/>{label}<span className="text-xs font-normal">Ainda indisponível</span></div>)}
   <button type="button" disabled={busy} aria-expanded={section==='security'} className={card} onClick={()=>onSection(section==='security'?null:'security')}><ShieldCheck aria-hidden="true" className="h-6 w-6 text-[#F47825]"/>Segurança</button>
  </div>
  <p className="text-xs text-slate-300">A autenticação de cada alteração continua obrigatória. Os recursos de ocorrências, avisos e localização ainda não estão disponíveis.</p>
  <button type="button" disabled={busy} className="min-h-11 w-full rounded-xl border border-[#34443B] p-3 text-sm font-semibold" onClick={onPublic}>Visualizar meu CID público</button>
 </section>;
}
