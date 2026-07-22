import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  runMigrationReconciliation,
  type MigrationReconciliationReport,
  type MigrationReconciliationSection,
  type ReconciliationMetric,
} from '../../utils/migrationReconciliation';

interface MigrationReconciliationWorkspaceProps {
  legacyStoreId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const formatMetricValue = (
  value: number,
  format: ReconciliationMetric['format']
): string =>
  format === 'money'
    ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : value.toLocaleString('pt-BR');

const statusPresentation = (
  section: MigrationReconciliationSection
): {
  label: string;
  className: string;
  Icon: typeof CheckCircle2;
} => {
  if (section.status === 'matched') {
    return {
      label: 'Conferido',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      Icon: CheckCircle2,
    };
  }
  if (section.status === 'unavailable') {
    return {
      label: 'Indisponível',
      className: 'border-slate-600 bg-slate-800 text-slate-300',
      Icon: XCircle,
    };
  }
  return {
    label: 'Divergência',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    Icon: AlertTriangle,
  };
};

const SectionCard = ({ section }: { section: MigrationReconciliationSection }) => {
  const presentation = statusPresentation(section);
  const { Icon } = presentation;

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 space-y-4 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-black uppercase tracking-wider text-white">
            {section.title}
          </h4>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            {section.coverage}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${presentation.className}`}
        >
          <Icon className="h-3 w-3" />
          {presentation.label}
        </span>
      </div>

      {section.metrics.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {section.metrics.map(metric => (
            <div
              key={metric.label}
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3"
            >
              <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                {metric.label}
              </span>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="block text-slate-600">Legado</span>
                  <strong className="text-slate-200">
                    {formatMetricValue(metric.legacy, metric.format)}
                  </strong>
                </div>
                <div>
                  <span className="block text-slate-600">Canônico</span>
                  <strong className="text-slate-200">
                    {formatMetricValue(metric.canonical, metric.format)}
                  </strong>
                </div>
              </div>
              {!metric.informational && metric.delta !== 0 && (
                <p className="mt-2 text-[9px] font-mono text-amber-300">
                  Diferença: {formatMetricValue(metric.delta, metric.format)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {section.issues.length > 0 && (
        <div className="space-y-2">
          {section.issues.slice(0, 8).map((issue, index) => (
            <div
              key={`${issue.entityId}-${index}`}
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5"
            >
              {issue.entityId && (
                <span className="block truncate text-[9px] font-mono text-amber-400">
                  {issue.entityId}
                </span>
              )}
              <p className="text-[10px] leading-relaxed text-amber-100/80">
                {issue.message}
              </p>
            </div>
          ))}
          {section.issues.length > 8 && (
            <p className="text-[9px] text-slate-500">
              Mais {section.issues.length - 8} divergência(s) encontradas nesta área.
            </p>
          )}
        </div>
      )}
    </article>
  );
};

export const MigrationReconciliationWorkspace = ({
  legacyStoreId,
  notify,
}: MigrationReconciliationWorkspaceProps) => {
  const [report, setReport] = useState<MigrationReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runCheck = useCallback(
    async (announce: boolean): Promise<void> => {
      const user = auth.currentUser;
      if (!user || user.uid !== legacyStoreId) {
        setReport(null);
        setError('Entre novamente com a conta proprietária para conferir a migração.');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const nextReport = await runMigrationReconciliation(user, legacyStoreId);
        setReport(nextReport);
        if (announce) {
          notify(
            nextReport.readyForCanonicalRead
              ? 'Conferência concluída: as quatro áreas estão alinhadas.'
              : 'Conferência concluída: existem pontos para revisar antes da troca de leitura.',
            nextReport.readyForCanonicalRead ? 'success' : 'warning'
          );
        }
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : 'Não foi possível executar a conferência da migração.';
        setReport(null);
        setError(message);
        if (announce) notify(message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [legacyStoreId, notify]
  );

  useEffect(() => {
    void runCheck(false);
  }, [runCheck]);

  return (
    <section className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-4 sm:p-5 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
            <Database className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-cyan-400">
              Migração multi-loja
            </span>
            <h3 className="text-sm font-black uppercase tracking-wider text-white">
              Conferência legado × canônico
            </h3>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-slate-400">
              Esta tela apenas compara os dados. Nenhuma fonte de leitura é alterada automaticamente.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runCheck(true)}
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Conferindo' : 'Executar conferência'}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[10px] text-red-200">
          {error}
        </div>
      )}

      {report && (
        <>
          <div
            className={`rounded-3xl border p-4 ${
              report.readyForCanonicalRead
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-amber-500/30 bg-amber-500/10'
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={`h-5 w-5 ${
                    report.readyForCanonicalRead ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                />
                <div>
                  <strong className="block text-xs font-black uppercase text-white">
                    {report.readyForCanonicalRead
                      ? 'Pronto para preparar leitura canônica'
                      : 'Leitura canônica ainda não recomendada'}
                  </strong>
                  <span className="text-[9px] text-slate-400">
                    Loja: {report.store.name} · conferido em{' '}
                    {new Date(report.checkedAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase">
                <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-300">
                  {report.matchedSections} alinhadas
                </span>
                <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">
                  {report.divergentSections} divergentes
                </span>
                <span className="rounded-full bg-slate-700 px-2 py-1 text-slate-300">
                  {report.unavailableSections} indisponíveis
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {report.sections.map(section => (
              <SectionCard key={section.key} section={section} />
            ))}
          </div>
        </>
      )}

      {!report && !error && loading && (
        <div className="rounded-3xl border border-dashed border-slate-700 py-10 text-center">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-cyan-400" />
          <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Comparando os caminhos de dados
          </p>
        </div>
      )}
    </section>
  );
};
