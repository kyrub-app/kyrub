import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { LocalAttendanceSession } from '../../../shared/localAttendance';
import type { ServiceLocation } from '../../../shared/serviceLocation';
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

type AttendanceChoice = {
  key: string;
  label: string;
  serviceLocationId?: string;
};

export const LocalAttendanceWorkspace = ({
  storeId,
  serviceLocations,
  legacySpaces,
}: {
  storeId: string;
  serviceLocations: ServiceLocation[];
  legacySpaces: string[];
}) => {
  const choices = useMemo<AttendanceChoice[]>(() => {
    const canonical = serviceLocations
      .filter(location => location.active)
      .map(location => ({
        key: `canonical:${location.id}`,
        label: location.label,
        serviceLocationId: location.id,
      }));
    const canonicalLabels = new Set(
      canonical.map(item => item.label.trim().toLocaleUpperCase('pt-BR'))
    );
    const legacy = Array.from(new Set(
      legacySpaces.map(item => item.trim()).filter(Boolean)
    ))
      .filter(label => !canonicalLabels.has(label.toLocaleUpperCase('pt-BR')))
      .map(label => ({
        key: `legacy:${label.toLocaleUpperCase('pt-BR')}`,
        label,
      }));
    return [...canonical, ...legacy];
  }, [legacySpaces, serviceLocations]);

  const [sessions, setSessions] = useState<LocalAttendanceSession[]>([]);
  const [customerLabel, setCustomerLabel] = useState('');
  const [choiceKey, setChoiceKey] = useState('');
  const [itemCount, setItemCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!choices.some(choice => choice.key === choiceKey)) {
      setChoiceKey(choices[0]?.key ?? '');
    }
  }, [choiceKey, choices]);

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

  const handleOpen = async (): Promise<void> => {
    const choice = choices.find(item => item.key === choiceKey);
    if (!customerLabel.trim() || !choice || loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const session = await openLocalAttendance({
        storeId,
        customerLabel: customerLabel.trim(),
        space: choice.label,
        serviceLocationId: choice.serviceLocationId,
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

      {choices.length === 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] text-amber-200">
          Cadastre um local em Configurações da Loja → Ambientes antes de abrir um novo atendimento local.
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.35fr)]">
        <input
          value={customerLabel}
          onChange={event => setCustomerLabel(event.target.value)}
          placeholder="Nome ou identificação local do cliente"
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-orange-500/40"
        />
        <select value={choiceKey} onChange={event => setChoiceKey(event.target.value)} disabled={choices.length === 0} className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold uppercase text-white outline-none disabled:text-slate-600">
          {choices.length === 0
            ? <option value="">Nenhum local</option>
            : choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-2 md:col-span-2">
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Pessoas</span>
            <input
              type="number"
              min={1}
              max={999}
              value={itemCount}
              onChange={event => setItemCount(Math.max(1, Math.min(999, Number(event.target.value) || 1)))}
              className="w-16 bg-transparent text-right text-xs font-black text-white outline-none"
              aria-label="Quantidade de pessoas"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={loading || !customerLabel.trim() || !choiceKey}
            className="flex min-h-10 items-center justify-center rounded-xl bg-orange-600 text-white transition-colors hover:bg-orange-500 disabled:bg-slate-800 disabled:text-slate-600"
            aria-label="Iniciar atendimento"
            title="Iniciar atendimento"
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300" role="alert">{errorMessage}</div>
      )}

      {openSessions.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {openSessions.map(session => (
            <article key={session.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-xs text-white">{session.customerLabel}</strong>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[8px] text-slate-600">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{session.serviceLocation?.label ?? session.space}</span>
                    <span>{session.itemCount} pessoa(s)</span>
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