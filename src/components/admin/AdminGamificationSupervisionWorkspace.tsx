import { useState } from 'react';
import { Cherry, Sprout, ShieldCheck } from 'lucide-react';

const areas = [
  {id:'pitangas', label:'Pitangas', icon:Cherry, title:'Circulação de Pitangas',
   metrics:['Pitangas emitidas','Pitangas utilizadas','Saldo em circulação'],
   description:'A emissão, a utilização e o saldo precisam de conciliação com o livro de registros. Não são valores em reais.'},
  {id:'semeadura', label:'Semeadura', icon:Sprout, title:'Jornada Pitangueira',
   metrics:['Sementes aceitas','Pitangueiras','Publicações que atingiram um bosque'],
   description:'A semeadura pertence ao autor. As comunidades não acumulam recompensas próprias.'},
  {id:'revisao', label:'Revisões', icon:ShieldCheck, title:'Revisões econômicas',
   metrics:['Casos em revisão','Casos liberados','Inconsistências técnicas'],
   description:'Uma inconsistência não comprova fraude. A revisão humana exige autorização, evidências e registro da decisão.'},
] as const;

/** Local design scaffold: deliberately has no Firebase, fetch, financial
 * mutation, fixture identities or fabricated counters. Not an admin API. */
export default function AdminGamificationSupervisionWorkspace() {
  const [selected,setSelected]=useState<typeof areas[number]['id']>('pitangas');
  const area=areas.find(item=>item.id===selected) ?? areas[0];
  return (
    <section aria-labelledby="admin-gamification-supervision-title" className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 id="admin-gamification-supervision-title" className="text-base font-bold text-white">Supervisão da gamificação</h2>
      <p className="mt-2 text-sm text-slate-400" role="status">Protótipo local · integração administrativa indisponível. Nenhum dado real consultado.</p>
      <div role="group" aria-label="Áreas da supervisão" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {areas.map(item=><button key={item.id} type="button" aria-pressed={selected===item.id}
          onClick={()=>setSelected(item.id)}
          className={'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold '+(selected===item.id?'border-emerald-500/50 bg-emerald-500/10 text-emerald-300':'border-slate-700 bg-slate-900 text-slate-300')}>
          <item.icon aria-hidden="true" className="h-4 w-4 shrink-0"/>{item.label}
        </button>)}
      </div>
      <div className="mt-4" aria-live="polite">
        <h3 className="text-base font-semibold text-white">{area.title}</h3>
        <p className="mt-2 text-sm text-slate-400">{area.description}</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
          {area.metrics.map(label=><div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <dt className="text-sm text-slate-300">{label}</dt>
            <dd className="mt-2 text-sm font-medium text-slate-400">Indisponível</dd>
          </div>)}
        </dl>
        {selected==='revisao'&&<p className="mt-3 text-sm text-slate-400">Ações de bloquear, liberar ou alterar saldos não estão disponíveis neste protótipo.</p>}
      </div>
    </section>
  );
}
