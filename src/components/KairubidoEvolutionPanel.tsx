import {formatCocarCompact,formatCocarCount} from '../../shared/cocarDisplay';
import {KAIRUBIDO_EQUIPMENT,projectKairubidoEvolution,type KairubidoMilestone,type KairubidoEquipment} from '../../shared/kairubidoEvolution';
/** Explicit preview only. Values are illustrative and must not become a
 * production unlock policy without a separate approved configuration. */
const previewMilestones:readonly KairubidoMilestone[]=KAIRUBIDO_EQUIPMENT.map((equipment,i)=>({equipment,minimumXp:[0,1,3,5,10,20,50][i]}));
const labels:Record<KairubidoEquipment,string>={arco_e_flecha:'Arco e flecha',bracelete:'Bracelete',colar:'Colar',faixa:'Faixa',pena:'Pena',cocar_parcial:'Cocar parcial',cocar:'Cocar'};
export const KAIRUBIDO_EVOLUTION_PREVIEW=import.meta.env?.VITE_KAIRUBIDO_EVOLUTION_PREVIEW==='true';
export function KairubidoEvolutionPanel({xp}:{xp:number|null}){
 if(!KAIRUBIDO_EVOLUTION_PREVIEW)return null;
 const progress=xp!==null&&Number.isSafeInteger(xp)&&xp>=0?projectKairubidoEvolution(xp,previewMilestones):null;
 const has=(item:KairubidoEquipment)=>progress?.unlocked.includes(item)??false;
 return <section aria-label="Minha trilha" className="space-y-3 rounded-2xl border border-emerald-800/30 bg-slate-950 p-3 text-sm text-slate-200">
  <h3 className="text-base font-bold text-emerald-200">Minha trilha</h3>
  <p className="text-xs text-slate-400">Prévia de evolução visual. Limiares ilustrativos, sem concessão de recompensas.</p>
  <div className="flex flex-wrap items-center gap-3">
   <svg viewBox="0 0 120 150" width="96" height="120" className="shrink-0" role="img" aria-label="Avatar esquemático da trilha">
    <circle cx="60" cy="43" r="19" fill="#C29B72"/><path d="M42 39 Q60 12 78 39 L76 26 Q60 13 44 26Z" fill="#44382F"/>
    <path d="M42 68 Q60 58 78 68 L84 113 H36Z" fill="#416B56"/><path d="M45 112 L44 140 M75 112 L76 140 M42 72 L27 100 M78 72 L95 100" stroke="#C29B72" strokeWidth="9" strokeLinecap="round"/>
    {has('arco_e_flecha')&&<g fill="none" stroke="#D4A76A" strokeWidth="2.5"><path d="M19 60 Q0 85 19 110 L19 60 M8 85 H33 M28 81 L33 85 L28 89"/></g>}
    {has('bracelete')&&<path d="M89 91 L97 97" stroke="#E5B468" strokeWidth="5"/>}
    {has('colar')&&<path d="M47 66 Q60 85 73 66" fill="none" stroke="#E5B468" strokeWidth="3"/>}
    {has('faixa')&&<path d="M42 35 H78" stroke="#F27429" strokeWidth="5"/>}
    {has('pena')&&<path d="M75 33 L90 10 L85 34Z" fill="#D4A76A"/>}
    {has('cocar_parcial')&&<path d="M42 32 L34 13 L47 24 L48 7 L57 24 L60 4 L67 24 L76 9 L78 32" fill="#D4A76A" stroke="#8C603E" strokeLinejoin="round"/>}
    {has('cocar')&&<path d="M42 32 L25 19 L32 35 M78 32 L95 19 L88 35" fill="none" stroke="#F27429" strokeWidth="5" strokeLinecap="round"/>}
   </svg>
   <div className="min-w-0 flex-1 space-y-1"><p className="font-bold">{progress?'Kairubido '+formatCocarCompact(progress.xp):'Evolução indisponível'}</p>
    {progress&&<><p>{formatCocarCount(progress.xp)}</p><p>{progress.next?'Próximo: '+labels[progress.next.equipment]+' · '+formatCocarCount(progress.next.remainingXp):'Todos os acessórios da prévia desbloqueados'}</p></>}
   </div>
  </div>
  {progress&&<ul className="grid grid-cols-2 gap-2">{KAIRUBIDO_EQUIPMENT.map(item=><li key={item} className="rounded-lg border border-slate-800 p-2"><span>{labels[item]}</span><span className="block text-xs text-slate-400">{has(item)?'Desbloqueado na prévia':'Bloqueado na prévia'}</span></li>)}</ul>}
  <p className="text-xs text-slate-400">Acessórios representam evolução visual; não certificam habilidades, reputação ou experiência profissional.</p>
 </section>;
}
