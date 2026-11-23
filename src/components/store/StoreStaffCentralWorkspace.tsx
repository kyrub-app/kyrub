import { useState } from 'react';
import { BookOpenCheck, CalendarDays, ListChecks, Megaphone } from 'lucide-react';
import { StoreStaffNoticeManager } from './StoreStaffNoticeManager';
import { StoreStaffPopManager } from './StoreStaffPopManager';
import { StoreStaffTasksManager } from './StoreStaffTasksManager';
import { StoreStaffShiftManager } from './StoreStaffShiftManager';

// Direct modal destination: all four areas use server-authorized modules, not dropdowns.
const STAFF_CENTRAL_AREAS = [
  {
    id: 'avisos',
    title: 'Avisos e comunicados',
    description: 'Publicação de recados para toda a equipe ou setores específicos, com confirmação de leitura.',
    icon: Megaphone,
  },
  {
    id: 'pops',
    title: 'Manuais POP',
    description: 'Procedimentos operacionais padronizados, materiais de referência e controle de versões.',
    icon: BookOpenCheck,
  },
  {
    id: 'checklists',
    title: 'Tarefas e checklists',
    description: 'Rotinas atribuídas a responsáveis, com prazos e registro de conclusão.',
    icon: ListChecks,
  },
  {
    id: 'escalas',
    title: 'Escalas de trabalho',
    description: 'Organização de turnos, setores, folgas e cobertura da equipe.',
    icon: CalendarDays,
  },
] as const;

export function StoreStaffCentralWorkspace({ storeId }: { storeId: string }) {
  const [selectedArea, setSelectedArea] = useState<'avisos' | 'pops' | 'checklists' | 'escalas' | null>(null);
  if (selectedArea === 'avisos') {
    return <StoreStaffNoticeManager storeId={storeId} onBack={() => setSelectedArea(null)} />;
  }
  if (selectedArea === 'pops') {
    return <StoreStaffPopManager storeId={storeId} onBack={() => setSelectedArea(null)} />;
  }
  if (selectedArea === 'checklists') {
    return <StoreStaffTasksManager storeId={storeId} onBack={() => setSelectedArea(null)} />;
  }
  if (selectedArea === 'escalas') {
    return <StoreStaffShiftManager storeId={storeId} onBack={() => setSelectedArea(null)} />;
  }
  return (
    <section
      aria-label="Áreas da Central do Staff"
      data-kyrub-staff-central="four-cards"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {STAFF_CENTRAL_AREAS.map(({ id, title, description, icon: Icon }) => (
        <article
          key={id}
          data-kyrub-staff-central-card={id}
          className="flex min-h-44 flex-col rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4 text-slate-100"
          aria-labelledby={`staff-central-heading-${id}`}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-300">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <h3 id={`staff-central-heading-${id}`} className="text-sm font-black leading-snug">
              {title}
            </h3>
          </div>
          <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-400">{description}</p>
          <button
            type="button"
            onClick={() => setSelectedArea(id)}
            className="mt-4 self-start rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-orange-300 hover:bg-orange-500/20"
          >
            {id === 'avisos' ? 'Gerenciar avisos' : id === 'pops' ? 'Gerenciar manuais' : id === 'checklists' ? 'Gerenciar tarefas' : 'Gerenciar escalas'}
          </button>
        </article>
      ))}
    </section>
  );
}
