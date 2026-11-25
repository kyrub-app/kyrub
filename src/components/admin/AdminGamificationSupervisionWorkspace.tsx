import { useState } from 'react';
import AdminGamificationPilotEconomicPanel from './AdminGamificationPilotEconomicPanel';
import AdminGamificationPilotReadPanel from './AdminGamificationPilotReadPanel';
import type { PilotSession } from '../../utils/gamificationAdminPilotClient';
import { Cherry, Sprout, ShieldCheck, ShieldAlert } from 'lucide-react';

const areas = [
  {id:'pitangas', label:'Pitangas', icon:Cherry, title:'Circulação de Pitangas',
   metrics:['Pitangas emitidas','Pitangas utilizadas','Saldo em circulação'],
   description:'A emissão, a utilização e o saldo precisam de conciliação com o livro de registros. Não são valores em reais.'},
  {id:'semeadura', label:'Semeadura', icon:Sprout, title:'Jornada Pitangueira',
   metrics:['Sementes aceitas','Pitangueiras','Publicações que atingiram um bosque'],
   description:'A semeadura pertence ao autor. As comunidades não acumulam recompensas próprias.'},
  {id:'suspeitas', label:'Suspeitas de fraude', icon:ShieldAlert, title:'Suspeitas de fraude',
   metrics:['Indícios técnicos a analisar','Análises em andamento','Análises concluídas'],
   description:'Indícios de manipulação artificial ou inconsistências técnicas para análise humana. Popularidade, reciprocidade e uso da cota diária não são provas de fraude.'},
  {id:'revisao', label:'Revisões econômicas', icon:ShieldCheck, title:'Revisões econômicas',
   metrics:['Casos em revisão','Casos liberados','Decisões registradas'],
   description:'Uma inconsistência não comprova fraude. A revisão humana exige autorização, evidências e registro da decisão.'},
] as const;

/** Local scaffold. The optional injected session enables an isolated read-only
 * panel; no direct SDK, financial mutation or fabricated counters. */
export default function AdminGamificationSupervisionWorkspace({pilotSession,isCurrent,caseWrites=false,referralWrites=false}:{pilotSession?:PilotSession;isCurrent?:()=>boolean;caseWrites?:boolean;referralWrites?:boolean}={}) {
  const [selected,setSelected]=useState<typeof areas[number]['id']>('pitangas');
  const area=areas.find(item=>item.id===selected) ?? areas[0];
  const connected=Boolean(pilotSession&&isCurrent);
  return (
    <section aria-labelledby="admin-gamification-supervision-title" className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 id="admin-gamification-supervision-title" className="text-base font-bold text-white">Supervisão da gamificação</h2>
      <p className="mt-2 text-sm text-slate-400" role="status">{connected?'Protótipo local · consulta experimental de homologação. Nenhum dado real consultado.':'Protótipo local · integração administrativa indisponível. Nenhum dado real consultado.'}</p>
      <div role="group" aria-label="Áreas da supervisão" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {areas.map(item=><button key={item.id} type="button" aria-pressed={selected===item.id}
          onClick={()=>setSelected(item.id)}
          className={'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold '+(selected===item.id?'border-emerald-500/50 bg-emerald-500/10 text-emerald-300':'border-slate-700 bg-slate-900 text-slate-300')}>
          <item.icon aria-hidden="true" className="h-4 w-4 shrink-0"/>{item.label}
        </button>)}
      </div>
      <div className="mt-4" aria-live="polite">
        <h3 className="text-base font-semibold text-white">{area.title}</h3>
        <p className="mt-2 text-sm text-slate-400">{area.description}</p>
        {(!connected)&&<dl className="mt-3 grid gap-2 sm:grid-cols-3">
          {area.metrics.map(label=><div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <dt className="text-sm text-slate-300">{label}</dt>
            <dd className="mt-2 text-sm font-medium text-slate-400">Indisponível</dd>
          </div>)}
        </dl>}
        {pilotSession&&isCurrent&&selected!=='revisao'&&<AdminGamificationPilotReadPanel key={pilotSession.uid+':'+(selected==='suspeitas'?'suspeitas':'snapshot')} session={pilotSession} isCurrent={isCurrent} area={selected} caseWrites={caseWrites}/>}
        {pilotSession&&isCurrent&&selected==='revisao'&&<AdminGamificationPilotEconomicPanel key={pilotSession.uid} session={pilotSession} isCurrent={isCurrent} referralWrites={referralWrites}/>}
        {selected==='suspeitas'&&<p className="mt-3 text-sm text-slate-400">Não há detector de fraude conectado. Nenhum indício gera punição ou bloqueio automático. {!connected?' A lista de casos ainda está indisponível.':''}</p>}
        {selected==='revisao'&&<p className="mt-3 text-sm text-slate-400">Ações de bloquear, liberar ou alterar saldos não estão disponíveis neste protótipo.</p>}
      </div>
    </section>
  );
}
