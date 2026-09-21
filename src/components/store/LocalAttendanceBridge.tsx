import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowRight, LoaderCircle, MapPin } from 'lucide-react';
import type { LocalAttendanceSession } from '../../../shared/localAttendance';
import type { ServiceLocation } from '../../../shared/serviceLocation';
import { auth } from '../../utils/firebase';
import {
  loadLocalAttendanceSessions,
  openLocalAttendance,
} from '../../utils/localAttendance';
import { loadServiceLocations } from '../../utils/serviceLocations';

export const KYRUB_ATTENDANCE_LOCATION_FILTER_CHANGED =
  'kyrub-attendance-location-filter-changed';
export const KYRUB_LOCAL_ATTENDANCE_SESSIONS_CHANGED =
  'kyrub-local-attendance-sessions-changed';

const BOARD_HOST_ID = 'kyrub-customer-table-board-host';
const SUMMARY_HOST_ID = 'canonical-local-attendance-summary-host';
const OPENER_HOST_ID = 'canonical-local-attendance-opener-host';
const FILTER_HOST_ID = 'canonical-attendance-location-filter-host';

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const parsePeopleInput = (value: string): number | null => {
  const normalized = value.trim();
  if (!/^\d{1,3}$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 999) return null;
  return parsed;
};

export const LocalAttendanceBridge = () => {
  const [storeId, setStoreId] = useState(auth.currentUser?.uid ?? '');
  const [summaryHost, setSummaryHost] = useState<HTMLElement | null>(null);
  const [openerHost, setOpenerHost] = useState<HTMLElement | null>(null);
  const [filterHost, setFilterHost] = useState<HTMLElement | null>(null);
  const [serviceLocations, setServiceLocations] = useState<ServiceLocation[]>([]);
  const [sessions, setSessions] = useState<LocalAttendanceSession[]>([]);
  const [customerLabel, setCustomerLabel] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [peopleInput, setPeopleInput] = useState('1');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, user => setStoreId(user?.uid ?? '')), []);

  const activeLocations = useMemo(
    () => serviceLocations.filter(location => location.active),
    [serviceLocations]
  );
  const openSessions = useMemo(
    () => sessions.filter(session => session.status === 'open'),
    [sessions]
  );

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    if (!storeId) {
      setServiceLocations([]);
      setSessions([]);
      return;
    }
    if (!quiet) setBusy(true);
    try {
      const [locations, nextSessions] = await Promise.all([
        loadServiceLocations(storeId, { activeOnly: true }),
        loadLocalAttendanceSessions(storeId),
      ]);
      setServiceLocations(locations);
      setSessions(nextSessions);
      setErrorMessage('');
    } catch (error) {
      if (!quiet) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar os locais de atendimento.'
        );
      }
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [storeId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10000);
    const handleLocationsChanged = () => void refresh(true);
    const handleSessionsChanged = () => void refresh(true);
    window.addEventListener('kyrub-service-locations-changed', handleLocationsChanged);
    window.addEventListener(
      KYRUB_LOCAL_ATTENDANCE_SESSIONS_CHANGED,
      handleSessionsChanged
    );
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('kyrub-service-locations-changed', handleLocationsChanged);
      window.removeEventListener(
        KYRUB_LOCAL_ATTENDANCE_SESSIONS_CHANGED,
        handleSessionsChanged
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (!activeLocations.some(location => location.id === selectedLocationId)) {
      setSelectedLocationId(activeLocations[0]?.id ?? '');
    }
    if (
      locationFilter !== 'all' &&
      !activeLocations.some(location => location.id === locationFilter)
    ) {
      setLocationFilter('all');
    }
  }, [activeLocations, locationFilter, selectedLocationId]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(KYRUB_ATTENDANCE_LOCATION_FILTER_CHANGED, {
        detail: { serviceLocationId: locationFilter },
      })
    );
  }, [locationFilter]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let localSummaryHost: HTMLDivElement | null = null;
    let localOpenerHost: HTMLDivElement | null = null;
    let localFilterHost: HTMLDivElement | null = null;
    const hiddenNodes = new Map<HTMLElement, string>();

    const hide = (node: HTMLElement): void => {
      if (!hiddenNodes.has(node)) hiddenNodes.set(node, node.style.display);
      if (node.style.display !== 'none') node.style.display = 'none';
    };

    const restore = (): void => {
      hiddenNodes.forEach((display, node) => {
        if (node.isConnected) node.style.display = display;
      });
      hiddenNodes.clear();
    };

    const hideLegacyActiveCounters = (
      headerBlock: HTMLElement,
      opener: HTMLElement
    ): void => {
      const matching = Array.from(
        headerBlock.querySelectorAll<HTMLElement>('span, div')
      ).filter(node => /^\s*\d+\s+ativos?\s*$/i.test(node.textContent ?? ''));

      for (const node of matching) {
        let target = node;
        while (target.parentElement && target.parentElement !== headerBlock) {
          target = target.parentElement;
        }
        if (target !== opener && !target.contains(opener)) {
          hide(target);
        } else {
          hide(node);
        }
      }
    };

    const synchronize = (): void => {
      if (cancelled) return;
      const container = document.getElementById('erp-clientes-tab');
      const opener = document.getElementById('erp-attendance-opener-row');
      if (!(container instanceof HTMLElement) || !(opener instanceof HTMLElement)) {
        timer = window.setTimeout(synchronize, 60);
        return;
      }
      const headerBlock = opener.parentElement;
      if (!(headerBlock instanceof HTMLElement) || headerBlock.parentElement !== container) {
        timer = window.setTimeout(synchronize, 60);
        return;
      }

      hideLegacyActiveCounters(headerBlock, opener);

      if (!localSummaryHost?.isConnected) {
        localSummaryHost?.remove();
        localSummaryHost = document.createElement('div');
        localSummaryHost.id = SUMMARY_HOST_ID;
        localSummaryHost.className = 'w-full';
        headerBlock.insertBefore(localSummaryHost, opener);
        setSummaryHost(localSummaryHost);
      }

      for (const child of Array.from(opener.children)) {
        if (!(child instanceof HTMLElement) || child.id === OPENER_HOST_ID) continue;
        hide(child);
      }

      if (!localOpenerHost?.isConnected) {
        localOpenerHost?.remove();
        localOpenerHost = document.createElement('div');
        localOpenerHost.id = OPENER_HOST_ID;
        localOpenerHost.className = 'w-full';
        opener.appendChild(localOpenerHost);
        setOpenerHost(localOpenerHost);
      }

      const directChildren = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      const headerIndex = directChildren.indexOf(headerBlock);
      const legacyFilter = directChildren.find((child, index) =>
        index > headerIndex &&
        !child.id &&
        child.querySelectorAll('button').length > 0
      ) ?? null;

      if (legacyFilter) hide(legacyFilter);

      if (!localFilterHost?.isConnected) {
        localFilterHost?.remove();
        localFilterHost = document.createElement('div');
        localFilterHost.id = FILTER_HOST_ID;
        localFilterHost.className = 'min-w-0';
        if (legacyFilter) {
          container.insertBefore(localFilterHost, legacyFilter);
        } else {
          container.insertBefore(localFilterHost, headerBlock.nextSibling);
        }
        setFilterHost(localFilterHost);
      }

      const board = document.getElementById('customer-service-location-board');
      const inlineBoardSummary = board?.firstElementChild;
      if (inlineBoardSummary instanceof HTMLElement) hide(inlineBoardSummary);

      const refreshedChildren = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      const filterIndex = refreshedChildren.indexOf(localFilterHost);
      refreshedChildren.forEach((child, index) => {
        if (
          child === headerBlock ||
          child === localFilterHost ||
          child.id === BOARD_HOST_ID ||
          child.id === FILTER_HOST_ID
        ) {
          return;
        }
        if (child.id === 'empty-clients') {
          hide(child);
          return;
        }
        if (
          index > filterIndex &&
          !child.id &&
          !child.querySelector('[id$="-host"]')
        ) {
          hide(child);
        }
      });
    };

    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(synchronize, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(synchronize, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      restore();
      localSummaryHost?.remove();
      localOpenerHost?.remove();
      localFilterHost?.remove();
      setSummaryHost(null);
      setOpenerHost(null);
      setFilterHost(null);
    };
  }, []);

  const selectFilter = (serviceLocationId: string): void => {
    setLocationFilter(serviceLocationId);
    if (serviceLocationId !== 'all') setSelectedLocationId(serviceLocationId);
  };

  const handlePeopleBlur = (): void => {
    const parsed = parsePeopleInput(peopleInput);
    setPeopleInput(parsed === null ? '1' : String(parsed));
  };

  const handleOpen = async (): Promise<void> => {
    const label = customerLabel.trim();
    const location = activeLocations.find(item => item.id === selectedLocationId);
    const parsedPeopleCount = parsePeopleInput(peopleInput);
    if (busy) return;
    if (!label) {
      setErrorMessage('Informe a mesa, senha, nome ou identificação do atendimento.');
      return;
    }
    if (!location) {
      setErrorMessage('Selecione um local de atendimento.');
      return;
    }
    if (parsedPeopleCount === null) {
      setErrorMessage('Informe uma quantidade de pessoas entre 1 e 999.');
      return;
    }
    const duplicated = openSessions.some(
      session => normalize(session.customerLabel) === normalize(label)
    );
    if (duplicated) {
      setErrorMessage(
        `Já existe um atendimento ativo com a identificação “${label}”. Encerre-o ou use outra identificação.`
      );
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      const session = await openLocalAttendance({
        storeId,
        customerLabel: label,
        serviceLocationId: location.id,
        space: location.label,
        itemCount: parsedPeopleCount,
      });
      setSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
      setCustomerLabel('');
      setPeopleInput('1');
      setLocationFilter(location.id);
      window.dispatchEvent(
        new CustomEvent(KYRUB_LOCAL_ATTENDANCE_SESSIONS_CHANGED, {
          detail: { storeId, attendanceId: session.id },
        })
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível iniciar o atendimento.'
      );
    } finally {
      setBusy(false);
    }
  };

  const summary = summaryHost ? createPortal(
    <div className="flex items-start justify-between gap-3 pb-3" id="canonical-local-attendance-summary">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-300">
          <MapPin className="h-4 w-4 shrink-0 text-orange-400" />
          Locais em atendimento
        </h3>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
          Cada atendimento aberto vira um card operacional com pedidos, alertas, valores e acesso ao PDV.
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-[9px] font-bold text-slate-500">
        {openSessions.length} ativo{openSessions.length === 1 ? '' : 's'}
      </span>
    </div>,
    summaryHost
  ) : null;

  const opener = openerHost ? createPortal(
    <div className="space-y-2">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_3.25rem] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.42fr)_7rem_2.75rem]">
        <input
          value={customerLabel}
          onChange={event => {
            setCustomerLabel(event.target.value);
            if (errorMessage) setErrorMessage('');
          }}
          placeholder="Mesa, senha, nome ou identificação..."
          className="col-span-2 min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs font-semibold text-white outline-none focus:border-orange-500/40 sm:col-span-1"
        />
        <select
          value={selectedLocationId}
          onChange={event => {
            setSelectedLocationId(event.target.value);
            if (errorMessage) setErrorMessage('');
          }}
          disabled={activeLocations.length === 0}
          className="col-span-2 min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold uppercase text-white outline-none disabled:text-slate-600 sm:col-span-1"
        >
          {activeLocations.length === 0
            ? <option value="">Nenhum local</option>
            : activeLocations.map(location => (
                <option key={location.id} value={location.id}>{location.label}</option>
              ))}
        </select>
        <label className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3">
          <span className="text-[9px] font-black uppercase text-slate-500">Pessoas</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={peopleInput}
            onChange={event => {
              setPeopleInput(event.target.value.replace(/\D/g, '').slice(0, 3));
              if (errorMessage) setErrorMessage('');
            }}
            onBlur={handlePeopleBlur}
            className="w-10 bg-transparent text-right text-xs font-black text-white outline-none"
            aria-label="Quantidade de pessoas"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={busy || !selectedLocationId}
          className="flex min-h-10 items-center justify-center rounded-xl bg-orange-500 text-slate-950 disabled:bg-slate-800 disabled:text-slate-600"
          aria-label="Iniciar atendimento"
          title="Iniciar atendimento"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
        </button>
      </div>
      {errorMessage && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-200" role="alert">
          {errorMessage}
        </p>
      )}
    </div>,
    openerHost
  ) : null;

  const filters = filterHost ? createPortal(
    <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 scrollbar-none" id="canonical-attendance-location-filter">
      <button
        type="button"
        onClick={() => selectFilter('all')}
        className={`rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
          locationFilter === 'all'
            ? 'bg-orange-500 text-slate-950'
            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
        }`}
      >
        Todos
      </button>
      {activeLocations.map(location => (
        <button
          key={location.id}
          type="button"
          onClick={() => selectFilter(location.id)}
          className={`rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
            locationFilter === location.id
              ? 'bg-orange-500 text-slate-950'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          {location.label}
        </button>
      ))}
    </div>,
    filterHost
  ) : null;

  return <>{summary}{opener}{filters}</>;
};