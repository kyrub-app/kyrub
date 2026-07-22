import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  RotateCcw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import type { CanonicalReadConfig } from '../../utils/canonicalReadCutover';
import type { MigrationReconciliationReport } from '../../utils/migrationReconciliation';
import {
  DEFAULT_MIGRATION_COMPLETION_GATE,
  confirmMigrationCompletionCandidate,
  getMigrationCompletionPrerequisiteError,
  getMigrationCompletionReadiness,
  revokeMigrationCompletionCandidate,
  subscribeToMigrationCompletionGate,
  updateMigrationCompletionCheck,
  updateMigrationCompletionNotes,
  type MigrationCompletionCheckKey,
  type MigrationCompletionGateState,
} from '../../utils/migrationCompletionGate';

interface MigrationCompletionGateProps {
  legacyStoreId: string;
  report: MigrationReconciliationReport;
  readConfig: CanonicalReadConfig;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const CHECK_ITEMS: Array<{
  key: MigrationCompletionCheckKey;
  label: string;
  description: string;
}> = [
  {
    key: 'products_flow',
    label: 'Produtos e serviços',
    description:
      'Vitrine, preços, estoque, serviços e fallback foram conferidos no uso real.',
  },
  {
    key: 'orders_flow',
    label: 'Pedidos completos',
    description:
      'Cliente, KDS, mesas e mudanças de status foram testados com leitura canônica.',
  },
  {
    key: 'payments_flow',
    label: 'Pagamentos',
    description:
      'Pagamento parcial, integral, métodos e fechamento de conta foram conferidos.',
  },
  {
    key: 'cash_flow',
    label: 'Caixa offline-first',
    description:
      'Abertura, lançamentos, sincronização, fechamento e histórico foram testados.',
  },
  {
    key: 'fallback_flow',
    label: 'Retorno seguro ao legado',
    description:
      'A volta temporária ao legado foi verificada sem perda ou duplicação de dados.',
  },
  {
    key: 'reconciliation_after_tests',
    label: 'Conferência final',
    description:
      'A reconciliação foi executada novamente após os testes e permaneceu alinhada.',
  },
];

export const MigrationCompletionGate = ({
  legacyStoreId,
  report,
  readConfig,
  notify,
}: MigrationCompletionGateProps) => {
  const [gate, setGate] = useState<MigrationCompletionGateState>({
    ...DEFAULT_MIGRATION_COMPLETION_GATE,
    checklist: { ...DEFAULT_MIGRATION_COMPLETION_GATE.checklist },
  });
  const [notesDraft, setNotesDraft] = useState('');
  const [busyAction, setBusyAction] = useState('');

  useEffect(
    () =>
      subscribeToMigrationCompletionGate(
        legacyStoreId,
        nextGate => {
          setGate(nextGate);
          setNotesDraft(nextGate.notes);
        },
        error => console.warn('Gate de conclusão indisponível.', error)
      ),
    [legacyStoreId]
  );

  const readiness = useMemo(
    () => getMigrationCompletionReadiness(report, readConfig, gate),
    [report, readConfig, gate]
  );

  const requireOwner = () => {
    const user = auth.currentUser;
    if (!user || user.uid !== legacyStoreId) {
      notify('Entre novamente com a conta proprietária.', 'error');
      return null;
    }
    return user;
  };

  const handleCheck = async (
    key: MigrationCompletionCheckKey,
    checked: boolean
  ): Promise<void> => {
    const user = requireOwner();
    if (!user) return;

    if (checked) {
      const prerequisiteError = getMigrationCompletionPrerequisiteError(
        key,
        report,
        readConfig
      );
      if (prerequisiteError) {
        notify(prerequisiteError, 'warning');
        return;
      }
    }

    setBusyAction(key);
    try {
      await updateMigrationCompletionCheck(
        user,
        report,
        readConfig,
        gate,
        key,
        checked
      );
      notify(
        checked
          ? 'Teste real confirmado no checklist.'
          : 'Confirmação removida do checklist.',
        checked ? 'success' : 'info'
      );
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível atualizar o checklist.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveNotes = async (): Promise<void> => {
    const user = requireOwner();
    if (!user) return;

    setBusyAction('notes');
    try {
      await updateMigrationCompletionNotes(user, report, gate, notesDraft);
      notify('Observação da validação salva.', 'success');
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível salvar a observação.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleConfirm = async (): Promise<void> => {
    const user = requireOwner();
    if (!user) return;

    setBusyAction('confirm');
    try {
      await confirmMigrationCompletionCandidate(user, report, readConfig, gate);
      notify(
        'Loja registrada como candidata ao encerramento do legado. Nenhum caminho foi bloqueado.',
        'success'
      );
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível registrar a validação final.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleRevoke = async (): Promise<void> => {
    const user = requireOwner();
    if (!user) return;

    setBusyAction('revoke');
    try {
      await revokeMigrationCompletionCandidate(user, report, gate);
      notify('Validação final revogada. O legado continua disponível.', 'info');
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível revogar a validação.',
        'error'
      );
    } finally {
      setBusyAction('');
    }
  };

  return (
    <article className="space-y-4 rounded-3xl border border-violet-500/20 bg-violet-500/5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-violet-300">
              Gate de encerramento
            </span>
            <h4 className="text-sm font-black uppercase tracking-wider text-white">
              Validação do fluxo real
            </h4>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-slate-400">
              Confirme os testes somente após executá-los no aplicativo. Este gate registra
              prontidão operacional, mas não desativa gravações nem bloqueia o caminho legado.
            </p>
          </div>
        </div>

        <span
          className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider ${
            readiness.confirmed
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : readiness.ready
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-200'
                : 'border-slate-700 bg-slate-900 text-slate-400'
          }`}
        >
          {readiness.confirmed ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" />
          )}
          {readiness.confirmed
            ? 'Candidata registrada'
            : readiness.ready
              ? 'Pronta para confirmação'
              : 'Validação pendente'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {CHECK_ITEMS.map(item => {
          const checked = gate.checklist[item.key];
          const prerequisiteError = checked
            ? ''
            : getMigrationCompletionPrerequisiteError(
                item.key,
                report,
                readConfig
              );
          const busy = busyAction === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => void handleCheck(item.key, !checked)}
              disabled={Boolean(busyAction) || Boolean(prerequisiteError)}
              className={`flex min-h-24 items-start gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                checked
                  ? 'border-emerald-500/25 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-950/70 hover:border-violet-500/30'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  checked
                    ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                    : 'border-slate-600 text-slate-600'
                }`}
              >
                {checked ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
              </span>
              <span className="min-w-0">
                <strong className="block text-[10px] font-black uppercase tracking-wider text-white">
                  {busy ? 'Salvando' : item.label}
                </strong>
                <span className="mt-1 block text-[9px] leading-relaxed text-slate-400">
                  {prerequisiteError || item.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
        <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400">
          Observações do teste
        </label>
        <textarea
          value={notesDraft}
          onChange={event => setNotesDraft(event.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Registre aparelhos, cenários, divergências corrigidas ou adaptações necessárias."
          className="mt-2 w-full resize-y rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] leading-relaxed text-slate-200 outline-none transition focus:border-violet-500/50"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[9px] text-slate-600">
            {notesDraft.length}/1000
          </span>
          <button
            type="button"
            onClick={() => void handleSaveNotes()}
            disabled={Boolean(busyAction) || notesDraft.trim() === gate.notes}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {busyAction === 'notes' ? 'Salvando' : 'Salvar observação'}
          </button>
        </div>
      </div>

      {!readiness.ready && readiness.blockers.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
          <strong className="text-[9px] font-black uppercase tracking-wider text-amber-300">
            Pendências para a validação final
          </strong>
          <div className="mt-2 space-y-1.5">
            {readiness.blockers.map(blocker => (
              <p key={blocker} className="text-[9px] leading-relaxed text-amber-100/75">
                • {blocker}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-[9px] leading-relaxed text-slate-500">
          A confirmação não altera <code>/artifacts</code>, não muda o status da loja para
          canônico e pode ser revogada antes do corte definitivo.
        </p>

        {readiness.confirmed ? (
          <button
            type="button"
            onClick={() => void handleRevoke()}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {busyAction === 'revoke' ? 'Revogando' : 'Revogar validação'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={Boolean(busyAction) || !readiness.ready}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-[9px] font-black uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {busyAction === 'confirm'
              ? 'Registrando'
              : 'Registrar candidata ao corte'}
          </button>
        )}
      </div>
    </article>
  );
};
