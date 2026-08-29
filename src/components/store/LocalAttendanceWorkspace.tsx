import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { LocalAttendanceSession } from '../../../shared/localAttendance';
import {
  closeLocalAttendance,
  loadLocalAttendanceSessions,
  openLocalAttendance,
} from '../../utils/localAttendance';

const formatTime = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

export const LocalAttendanceWorkspace = ({
  storeId,
  spaces,
}: {
  storeId: string;
  spaces: string[];
}) => {
  const normalizedSpaces = useMemo(
    () => (spaces.length > 0 ? spaces : ['GERAL']).map(item => item.trim()).filter(Boolean),
    [spaces]
  );
  const [sessions, setSessions] = useState<LocalAttendanceSession[]>([]);
  const [customerLabel, setCustomerLabel] = useState('');
  const [space, setSpace] = useState(normalizedSpaces[0] ?? 'GERAL');
  const [itemCount, setItemCount] = useState(1);
  const [filter, setFilter] = useState('TODOS');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!normalizedSpaces.includes(space)) setSpace(normalizedSpaces[0] ?? 'GERAL');
    if (filter !== 'TODOS' && !normalizedSpaces.includes(filter)) setFilter('TODOS');
  }, [filter, normalizedSpaces, space]);

  const refresh = useCallback(async (silent = false): Promise<void> => {
    if (!storeId) return;
    if (!silent) setLoading(true);
    try {
      setSessions(await loadLocalAttendanceSessions(storeId));
      setErrorMessage('');
    } catch (error) {
      if (!silent) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar os atendimentos.'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const openSessions = useMemo(
    () => sessions.filter(session => session.status === 'open'),
    [sessions]
  );
  const visibleSessions = useMemo(
    () => openSessions.filter(session => filter === 'TODOS' || session.space === filter),
    [filter, openSessions]
  );

  const handleOpen = async (): Promise<void> => {
    if (!customerLabel.trim() || loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const session = await openLocalAttendance({
        storeId,
        customerLabel: customerLabel.trim(),
        space,
        itemCount,
      });
      setSessions(current => [session, ...current]);
      setCustomerLabel('');
      setItemCount(1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível abrir o atendimento.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async (attendanceId: string): Promise<void> => {
    if (busyId) return;
    setBusyId(attendanceId);
    setErrorMessage('');
    try {
      const closed = await closeLocalAttendance({ storeId, attendanceId });
      setSessions(current =>
        current.map(session => session.id === closed.id ? closed : session)
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível encerrar o atendimento.'
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-4" id="canonical-local-attendance-workspace">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-orange-400" />
            <h3 className="text-sm font-black uppercase text-white">Atendimentos locais</h3>
            <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 font-mono text-[8px] font-black uppercase text-orange-300">
              {openSessions.length} ativos
            </span>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Balcão, mesas e outros atendimentos iniciados na loja. Este módulo não confirma pagamento, fiscal ou pedido online.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-500 hover:text-white" aria-label="Atualizar atendimentos">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.35fr)_6rem_auto]">
        <input
          value={customerLabel}
          onChange={event => setCustomerLabel(event.target.value)}
          placeholder="Nome ou identificação local do cliente"
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-orange-500/40"
        />
        <select value={space} onChange={event => setSpace(event.target.value)} className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold uppercase text-white outline-none">
          {normalizedSpaces.map(item => <option key={item} value={item.toLocaleUpperCase('pt-BR')}>{item}</option>)}
        </select>
        <input type="number" min={1} max={999} value={itemCount} onChange={event => setItemCount(Math.max(1, Math.min(999, Number(event.target.value) || 1)))} className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-center text-xs text-white outline-none" aria-label="Quantidade de itens estimada" />
        <button type="button" onClick={() => void handleOpen()} disabled={loading || !customerLabel.trim()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-[9px] font-black uppercase text-white disabled:bg-slate-800 disabled:text-slate-600">
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Abrir
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {['TODOS', ...normalizedSpaces.map(item => item.toLocaleUpperCase('pt-BR'))].map(item => (
          <button type="button" key={item} onClick={() => setFilter(item)} className={`shrink-0 rounded-full px-3 py-1.5 text-[8px] font-black uppercase ${filter === item ? 'bg-orange-500 text-slate-950' : 'border border-slate-800 bg-slate-950 text-slate-500'}`}>
            {item}
          </button>
        ))}
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300" role="alert">{errorMessage}</div>
      )}

      {visibleSessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-9 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-slate-700" />
          <p className="text-[10px] font-bold uppercase text-slate-500">Nenhum atendimento local ativo</p>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visibleSessions.map(session => (
            <article key={session.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-xs text-white">{session.customerLabel}</strong>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[8px] text-slate-600">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{session.space}</span>
                    <span>{session.itemCount} item(ns)</span>
                    <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatTime(session.openedAt)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => void handleClose(session.id)} disabled={busyId === session.id} className="shrink-0 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-[8px] font-black uppercase text-emerald-300 disabled:opacity-50">
                  {busyId === session.id ? 'Encerrando…' : 'Encerrar'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
