import { AlertTriangle, BookOpenCheck, Eye, LockKeyhole, RefreshCw, Send, ShieldCheck, Store } from 'lucide-react';
import {
  OMNICHANNEL_E2E_RUNBOOK_PHASES,
  type OmnichannelE2ERunbookActionKind,
} from '../../utils/omnichannelE2ERunbook';

const actionPresentation = (
  kind: OmnichannelE2ERunbookActionKind
): { label: string; icon: typeof Eye; className: string } => {
  switch (kind) {
    case 'read_only':
      return {
        label: 'Leitura',
        icon: Eye,
        className: 'border-slate-700 bg-slate-950 text-slate-300',
      };
    case 'platform_write':
      return {
        label: 'Write Kyrub',
        icon: Store,
        className: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200',
      };
    case 'owner_authorization':
      return {
        label: 'Autorização owner',
        icon: ShieldCheck,
        className: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
      };
    case 'provider_write':
      return {
        label: 'Write provider',
        icon: Send,
        className: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
      };
    case 'provider_external_action':
      return {
        label: 'Ação externa',
        icon: LockKeyhole,
        className: 'border-violet-500/25 bg-violet-500/10 text-violet-200',
      };
    case 'reconciliation':
      return {
        label: 'Reconciliação',
        icon: RefreshCw,
        className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
      };
  }
};

const scrollToBench = (target: 'mercado_livre' | '99food'): void => {
  const id = target === 'mercado_livre'
    ? 'kyrub-mercado-livre-channel-detail'
    : 'kyrub-99food-channel-detail';
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function OmnichannelE2ERunbookPanel() {
  return (
    <section
      id="kyrub-omnichannel-e2e-runbook"
      className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4"
    >
      <div>
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-indigo-300">
          <BookOpenCheck className="h-3.5 w-3.5" />
          E2E omnichannel · roteiro de prova
        </span>
        <h3 className="mt-1 text-sm font-black text-white">
          Uma sequência única, sem atalhos de autoridade
        </h3>
        <p className="mt-2 max-w-4xl text-[9px] leading-relaxed text-slate-400">
          Este roteiro não executa etapas nem marca sucesso por clique. Cada item descreve a ação permitida, a evidência que precisa existir e a condição que obriga interromper o teste. Writes reais continuam exclusivamente nas bancadas Mercado Livre/99Food e nas telas operacionais já existentes.
        </p>
      </div>

      <div className="mt-4 space-y-4">
        {OMNICHANNEL_E2E_RUNBOOK_PHASES.map(phase => (
          <div
            key={phase.id}
            className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3"
          >
            <div>
              <strong className="text-[10px] font-black uppercase text-slate-200">
                {phase.label}
              </strong>
              <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
                {phase.purpose}
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {phase.steps.map(step => (
                <article
                  key={step.id}
                  id={`kyrub-e2e-runbook-step-${step.id}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[8px] font-black text-slate-600">
                          #{step.order}
                        </span>
                        <strong className="text-[9px] text-white">{step.title}</strong>
                      </div>
                      <p className="mt-2 text-[8px] leading-relaxed text-slate-400">
                        {step.instruction}
                      </p>
                    </div>
                    {step.benchTarget && (
                      <button
                        type="button"
                        onClick={() => scrollToBench(step.benchTarget!)}
                        className="min-h-8 shrink-0 rounded-lg border border-slate-700 px-2.5 text-[7px] font-black uppercase text-slate-300"
                      >
                        Ir para bancada
                      </button>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {step.actionKinds.map(kind => {
                      const presentation = actionPresentation(kind);
                      const Icon = presentation.icon;
                      return (
                        <span
                          key={kind}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[7px] font-black uppercase ${presentation.className}`}
                        >
                          <Icon className="h-3 w-3" />
                          {presentation.label}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.035] p-2.5">
                      <span className="text-[7px] font-black uppercase text-emerald-300">
                        Evidência esperada
                      </span>
                      <ul className="mt-1.5 space-y-1 text-[8px] leading-relaxed text-emerald-100/75">
                        {step.expectedEvidence.map(item => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.035] p-2.5">
                      <span className="inline-flex items-center gap-1 text-[7px] font-black uppercase text-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        Parar se
                      </span>
                      <ul className="mt-1.5 space-y-1 text-[8px] leading-relaxed text-amber-100/75">
                        {step.stopIf.map(item => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-[8px] leading-relaxed text-slate-500">
        O roteiro é deliberadamente passivo: ele não guarda “check” de conclusão, não persiste sessão de teste e não transforma navegação em autoridade. A conclusão de cada etapa depende da evidência autoritativa produzida pelas superfícies existentes.
      </p>
    </section>
  );
}
