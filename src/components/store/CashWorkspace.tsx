import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  addCashMovement,
  calculateExpectedCash,
  closeCashSession,
  getCashDirection,
  getCashLocalQueueAudit,
  movementRequiresReason,
  openCashSession,
  resolveCashStoreContext,
  resolveSelectedCashSession,
  subscribeToCashMovements,
  subscribeToCashSessions,
  syncPendingCashRecords,
  submitCashDeviceInspection,
  type CanonicalCashMovement,
  type CanonicalCashSession,
  type CashDirection,
  type CashMovementType,
  type CashStoreContext,
  type CashLocalQueueAudit,
} from '../../utils/canonicalCash';
import { STORE_ROLE_LABELS } from '../../utils/storeSecurity';

interface CashWorkspaceProps {
  legacyStoreId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const movementLabels: Record<CashMovementType, string> = {
  sale: 'Venda',
  income: 'Entrada',
  expense: 'Saída',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  adjustment: 'Ajuste',
};

const movementCategories: Record<CashMovementType, string> = {
  sale: 'Vendas',
  income: 'Outras entradas',
  expense: 'Despesas',
  supply: 'Suprimento de caixa',
  withdrawal: 'Sangria',
  adjustment: 'Ajuste de conferência',
};

export const CashWorkspace = ({
  legacyStoreId,
  notify,
}: CashWorkspaceProps) => {
  const [context, setContext] = useState<CashStoreContext | null>(null);
  const [sessions, setSessions] = useState<CanonicalCashSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [movements, setMovements] = useState<CanonicalCashMovement[]>([]);
  const [loadedMovementSessionId, setLoadedMovementSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [deviceAudit, setDeviceAudit] = useState<CashLocalQueueAudit | null>(null);
  const [deviceAuditError, setDeviceAuditError] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [movementType, setMovementType] = useState<CashMovementType>('income');
  const [adjustmentDirection, setAdjustmentDirection] = useState<CashDirection>('in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementDescription, setMovementDescription] = useState('');
  const [movementCategory, setMovementCategory] = useState(
    movementCategories.income
  );
  const [movementReason, setMovementReason] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [closeReason, setCloseReason] = useState('');

  const openSessions = useMemo(
    () => sessions.filter(session => session.status === 'open'),
    [sessions]
  );
  const activeSession = useMemo(
    () => resolveSelectedCashSession(openSessions, selectedSessionId),
    [openSessions, selectedSessionId]
  );
  const movementsReady = Boolean(
    activeSession && loadedMovementSessionId === activeSession.id
  );

  useEffect(() => {
    setSelectedSessionId('');
    setMovements([]);
    setLoadedMovementSessionId('');
  }, [legacyStoreId]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !legacyStoreId) {
      setLoading(false);
      setErrorMessage('Faça login novamente para acessar o caixa.');
      return;
    }

    let cancelled = false;
    void resolveCashStoreContext(user, legacyStoreId)
      .then(resolved => {
        if (cancelled) return;
        setContext(resolved);
        setErrorMessage(
          resolved
            ? ''
            : 'Registre esta loja no modo multi-loja antes de usar o caixa canônico.'
        );
      })
      .catch(error => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível identificar a loja deste caixa.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [legacyStoreId]);

  useEffect(() => {
    if (!context) {
      setSessions([]);
      return;
    }

    return subscribeToCashSessions(
      context,
      setSessions,
      error => {
        console.warn('Falha ao carregar sessões de caixa.', error);
        setErrorMessage('Não foi possível carregar as sessões do caixa.');
      }
    );
  }, [context]);

  useEffect(() => {
    setMovements([]);
    setLoadedMovementSessionId('');
    if (!context || !activeSession) return;

    return subscribeToCashMovements(
      context,
      activeSession.id,
      nextMovements => {
        setMovements(nextMovements);
        setLoadedMovementSessionId(activeSession.id);
      },
      error => {
        setLoadedMovementSessionId('');
        console.warn('Falha ao carregar movimentações do caixa.', error);
        notify('Não foi possível carregar as movimentações do caixa.', 'error');
      }
    );
  }, [activeSession?.id, context, notify]);

  useEffect(() => {
    setDeviceAudit(null);
    setDeviceAuditError(false);
    if (!context) return;
    let cancelled = false;
    void getCashLocalQueueAudit(context)
      .then(report => {
        if (cancelled) return;
        setDeviceAudit(report);
        setPendingCount(report.currentActorPending);
      })
      .catch(() => {
        if (cancelled) return;
        setDeviceAuditError(true);
      });
    return () => { cancelled = true; };
  }, [context, sessions.length, movements.length]);

  useEffect(() => {
    setMovementCategory(movementCategories[movementType]);
    if (!movementRequiresReason(movementType)) setMovementReason('');
  }, [movementType]);

  const entries = movements
    .filter(movement => movement.direction === 'in')
    .reduce((sum, movement) => sum + movement.amount, 0);
  const outputs = movements
    .filter(movement => movement.direction === 'out')
    .reduce((sum, movement) => sum + movement.amount, 0);
  const expected = activeSession
    ? calculateExpectedCash(activeSession.openingAmount, movements)
    : 0;

  const refreshPending = async (): Promise<void> => {
    if (!context) return;
    try {
      const report = await getCashLocalQueueAudit(context);
      setDeviceAudit(report);
      setDeviceAuditError(false);
      setPendingCount(report.currentActorPending);
    } catch (error) {
      setDeviceAudit(null);
      setDeviceAuditError(true);
      throw error;
    }
  };

  const handleDeviceInspection = async (): Promise<void> => {
    if (!context || !auth.currentUser || !deviceAudit) return;
    setBusy(true);
    try {
      const token = await auth.currentUser.getIdToken();
      await submitCashDeviceInspection(context, token, crypto.randomUUID());
      await refreshPending();
      notify('Declaração deste aparelho registrada para conferência gerencial; a migração permanece bloqueada.', 'info');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível registrar a declaração.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (): Promise<void> => {
    if (!context) return;
    const value = Number.parseFloat(openingAmount.replace(',', '.'));
    setBusy(true);
    try {
      await openCashSession(context, value);
      setOpeningAmount('');
      await refreshPending();
      notify('Caixa aberto e registrado com identificação do operador.', 'success');
    } catch (error) {
      await refreshPending();
      const message =
        error instanceof Error ? error.message : 'Não foi possível abrir o caixa.';
      notify(message, message.includes('pendente') ? 'warning' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleMovement = async (): Promise<void> => {
    if (!context || !activeSession || !movementsReady) return;
    const value = Number.parseFloat(movementAmount.replace(',', '.'));
    setBusy(true);
    try {
      await addCashMovement(context, {
        sessionId: activeSession.id,
        type: movementType,
        amount: value,
        description: movementDescription,
        category: movementCategory,
        reason: movementReason,
        adjustmentDirection,
      });
      setMovementAmount('');
      setMovementDescription('');
      setMovementReason('');
      await refreshPending();
      notify(`${movementLabels[movementType]} registrada no caixa.`, 'success');
    } catch (error) {
      await refreshPending();
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível registrar a movimentação.';
      notify(message, message.includes('pendente') ? 'warning' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (): Promise<void> => {
    if (!context || !activeSession || !movementsReady) return;
    const value = Number.parseFloat(countedAmount.replace(',', '.'));
    setBusy(true);
    try {
      await closeCashSession(
        context,
        activeSession,
        movements,
        value,
        closeReason
      );
      setCountedAmount('');
      setCloseReason('');
      await refreshPending();
      notify('Caixa fechado com conferência e auditoria financeira.', 'success');
    } catch (error) {
      await refreshPending();
      const message =
        error instanceof Error ? error.message : 'Não foi possível fechar o caixa.';
      notify(message, message.includes('pendente') ? 'warning' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (): Promise<void> => {
    if (!context) return;
    setBusy(true);
    try {
      const stats = await syncPendingCashRecords(context);
      setPendingCount(stats.pending);
      notify(
        stats.pending === 0
          ? `Caixa sincronizado: ${stats.sessionsOpened} abertura(s), ${stats.movements} movimentação(ões) e ${stats.sessionsClosed} fechamento(s).`
          : `Sincronização parcial concluída. Ainda existem ${stats.pending} registro(s) pendente(s).`,
        stats.pending === 0 ? 'success' : 'warning'
      );
    } catch (error) {
      await refreshPending();
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível sincronizar o caixa.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
        Carregando caixa seguro…
      </div>
    );
  }

  if (!context) {
    return (
      <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="text-sm font-black uppercase text-white">Caixa canônico indisponível</h3>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
              {errorMessage}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-slate-100">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-emerald-400" />
            <h3 className="text-sm font-black uppercase text-white">Caixa da loja</h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {context.store.name} · {STORE_ROLE_LABELS[context.role]} · {context.operatorName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${!deviceAudit || pendingCount > 0 || deviceAudit.requiresReview ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
            {!deviceAudit
              ? 'Pendências locais não verificadas'
              : pendingCount > 0
                ? `${pendingCount} operação(ões) sua(s) pendente(s)`
                : 'Sem pendências da sua conta neste aparelho'}
          </span>
          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase text-slate-300 transition hover:border-emerald-500/40 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-300" data-kyrub-cash-local-audit="read-only">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="font-bold text-white">Verificação das pendências deste aparelho</strong>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void refreshPending().catch(() => notify('Não foi possível consultar as pendências locais deste aparelho.', 'error')); }}
              disabled={busy}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
            >
              Conferir novamente
            </button>
            <button
              type="button"
              onClick={handleDeviceInspection}
              disabled={busy || !deviceAudit}
              className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-[10px] font-bold text-cyan-200 disabled:opacity-50"
              data-kyrub-cash-inspection="self-report"
            >
              Registrar declaração deste aparelho
            </button>
          </div>
        </div>
        {deviceAudit ? (
          <p className="mt-2 leading-relaxed">
            Sua conta: <b>{deviceAudit.currentActorPending}</b> pendência(s) ·
            Outros colaboradores neste aparelho: <b>{deviceAudit.otherActorsPending}</b> ·
            Registros para conferência: <b>{deviceAudit.unattributedPending}</b> ·
            Sessões locais abertas: <b>{deviceAudit.localOpenSessions}</b>.
          </p>
        ) : (
          <p className="mt-2 text-amber-300">
            {deviceAuditError ? 'Falha ao ler o armazenamento local.' : 'Conferindo armazenamento local…'}
          </p>
        )}
        <p className="mt-2 text-[11px] text-amber-200/80">
          Somente este navegador foi inspecionado. O envio registra uma declaração do operador, não uma verificação independente. Outros aparelhos e a liberação da migração exigem conferência gerencial.
        </p>
      </div>

      {openSessions.length > 1 && (
        <div className="rounded-3xl border border-cyan-500/30 bg-slate-900 p-5" data-kyrub-cash-session-selector="explicit">
          <label htmlFor="kyrub-cash-active-session" className="block text-xs font-black uppercase text-white">
            Selecione a sessão de Caixa
          </label>
          <p className="mt-2 text-xs text-slate-400">
            Há vários caixas abertos nesta loja. Escolha o turno correto antes de movimentar ou fechar valores.
            O identificador de sessão ainda não representa um terminal físico cadastrado.
          </p>
          <select
            id="kyrub-cash-active-session"
            value={activeSession?.id ?? ''}
            onChange={event => setSelectedSessionId(event.target.value)}
            disabled={busy}
            className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-cyan-500/60 disabled:opacity-50"
          >
            <option value="">Escolha uma sessão aberta...</option>
            {openSessions.map(session => (
              <option key={session.id} value={session.id}>
                {session.operatorName} · Sessão {session.id.slice(-10)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!activeSession ? (
        openSessions.length > 0 ? (
          <div className="rounded-3xl border border-cyan-500/30 bg-slate-900 p-5 text-xs text-slate-300">
            Escolha a sessão de Caixa aberta acima para consultar os movimentos, registrar valores ou fechar o turno.
          </div>
        ) : (
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <Banknote className="mt-0.5 h-5 w-5 text-emerald-400" />
            <div className="flex-1">
              <h4 className="text-xs font-black uppercase text-white">Abrir turno de caixa</h4>
              <p className="mt-1 text-[11px] text-slate-400">
                Informe somente o valor real contado antes do início das operações.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={openingAmount}
                  onChange={event => setOpeningAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="Valor inicial em dinheiro"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
                />
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={busy}
                  className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black uppercase text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  Abrir caixa
                </button>
              </div>
            </div>
          </div>
        </div>
        )
      ) : (
        <>
          {!movementsReady && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
              Carregando os movimentos confirmados desta sessão. As alterações estão bloqueadas até a leitura terminar.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Abertura', activeSession.openingAmount, 'text-white'],
              ['Entradas', entries, 'text-emerald-400'],
              ['Saídas', outputs, 'text-rose-400'],
              ['Esperado', expected, 'text-cyan-400'],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
                <strong className={`mt-1 block text-base font-black ${color}`}>{money(Number(value))}</strong>
              </div>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="mb-4 flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                <h4 className="text-xs font-black uppercase text-white">Nova movimentação</h4>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={movementType}
                  onChange={event => setMovementType(event.target.value as CashMovementType)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
                >
                  <option value="income">Entrada</option>
                  <option value="expense">Saída</option>
                  <option value="supply">Suprimento</option>
                  <option value="withdrawal">Sangria</option>
                  <option value="adjustment">Ajuste</option>
                </select>
                {movementType === 'adjustment' ? (
                  <select
                    value={adjustmentDirection}
                    onChange={event => setAdjustmentDirection(event.target.value as CashDirection)}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
                  >
                    <option value="in">Ajuste de entrada</option>
                    <option value="out">Ajuste de saída</option>
                  </select>
                ) : (
                  <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold uppercase text-slate-500">
                    {getCashDirection(movementType) === 'in' ? 'Entrada de valor' : 'Saída de valor'}
                  </div>
                )}
                <input
                  value={movementAmount}
                  onChange={event => setMovementAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="Valor"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
                />
                <input
                  value={movementCategory}
                  onChange={event => setMovementCategory(event.target.value)}
                  placeholder="Categoria"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
                />
                <input
                  value={movementDescription}
                  onChange={event => setMovementDescription(event.target.value)}
                  placeholder="Descrição"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none sm:col-span-2"
                />
                {movementRequiresReason(movementType) && (
                  <textarea
                    value={movementReason}
                    onChange={event => setMovementReason(event.target.value)}
                    placeholder="Motivo obrigatório"
                    rows={2}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none sm:col-span-2"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={handleMovement}
                disabled={busy || !movementsReady}
                className="mt-4 w-full rounded-xl bg-slate-100 py-2.5 text-xs font-black uppercase text-slate-950 transition hover:bg-white disabled:opacity-50"
              >
                Registrar movimentação
              </button>
            </div>

            <div className="rounded-3xl border border-rose-500/20 bg-slate-900 p-5">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-rose-400" />
                <h4 className="text-xs font-black uppercase text-white">Fechar turno</h4>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Conte o dinheiro físico. Diferenças exigem justificativa e ficam registradas na auditoria.
              </p>
              <input
                value={countedAmount}
                onChange={event => setCountedAmount(event.target.value)}
                inputMode="decimal"
                placeholder="Valor contado"
                className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
              />
              <textarea
                value={closeReason}
                onChange={event => setCloseReason(event.target.value)}
                placeholder="Motivo da diferença, quando houver"
                rows={3}
                className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none"
              />
              <button
                type="button"
                onClick={handleClose}
                disabled={busy || !movementsReady}
                className="mt-3 w-full rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-xs font-black uppercase text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                Conferir e fechar
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-black uppercase text-white">Movimentações do turno</h4>
                <p className="mt-1 text-[10px] text-slate-500">Sessão {activeSession.id}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                <Clock3 className="h-3.5 w-3.5" />
                Caixa aberto
              </span>
            </div>
            {movements.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 py-10 text-center text-xs text-slate-500">
                Nenhuma movimentação registrada neste turno.
              </div>
            ) : (
              <div className="space-y-2">
                {movements.map(movement => (
                  <div key={movement.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {movement.direction === 'in' ? (
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <ArrowDownLeft className="h-4 w-4 shrink-0 text-rose-400" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-white">{movement.description}</p>
                        <p className="truncate text-[10px] text-slate-500">
                          {movementLabels[movement.type]} · {movement.category} · {movement.actorName}
                        </p>
                      </div>
                    </div>
                    <strong className={`shrink-0 text-xs ${movement.direction === 'in' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {movement.direction === 'in' ? '+' : '-'} {money(movement.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {sessions.some(session => session.status === 'closed') && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-cyan-400" />
            <h4 className="text-xs font-black uppercase text-white">Fechamentos recentes</h4>
          </div>
          <div className="space-y-2">
            {sessions
              .filter(session => session.status === 'closed')
              .slice(0, 5)
              .map(session => (
                <div key={session.id} className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[10px] sm:grid-cols-4">
                  <span className="text-slate-400">Operador <b className="block text-white">{session.closedByName || session.operatorName}</b></span>
                  <span className="text-slate-400">Esperado <b className="block text-white">{money(session.expectedAmount)}</b></span>
                  <span className="text-slate-400">Contado <b className="block text-white">{money(session.countedAmount)}</b></span>
                  <span className="text-slate-400">Diferença <b className={`block ${session.difference === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{money(session.difference)}</b></span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
