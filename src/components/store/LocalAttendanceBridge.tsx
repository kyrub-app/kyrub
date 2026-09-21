import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowRight, LoaderCircle } from 'lucide-react';
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
const OPENER_HOST_ID = 'canonical-local-attendance-opener-host';
const FILTER_HOST_ID = 'canonical-attendance-location-filter-host';

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

export const LocalAttendanceBridge = () => {
  const [storeId, setStoreId] = useState(auth.currentUser?.uid ?? '');
  const [openerHost, setOpenerHost] = useState<HTMLElement | null>(null);
  const [filterHost, setFilterHost] = useState<HTMLElement | null>(null);
  const [serviceLocations, setServiceLocations] = useState<ServiceLocation[]>([]);
  const [sessions, setSessions] = useState<LocalAttendanceSession[]>([]);
  const [customerLabel, setCustomerLabel] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [peopleCount, setPeopleCount] = useState(1);
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
    const headerBlock = document.getElementById('erp-attendance-opener-row')?.parentElement;
    if (!(headerBlock instanceof HTMLElement)) return;
    const counter = Array.from(headerBlock.querySelectorAll('span')).find(span =>
      /\bativos?\b/i.test(span.textContent ?? '')
    );
    if (counter) counter.textContent = `${openSessions.length} Ativo${openSessions.length === 1 ? '' : 's'}`;
  }, [openSessions.length, openerHost]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
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
      localOpenerHost?.remove();
      localFilterHost?.remove();
      setOpenerHost(null);
      setFilterHost(null);
    };
  }, []);

  const selectFilter = (serviceLocationId: string): void => {
    setLocationFilter(serviceLocationId);
    if (serviceLocationId !== 'all') setSelectedLocationId(serviceLocationId);
  };

  const handleOpen = async (): Promise<void> => {
    const label = customerLabel.trim();
    const location = activeLocations.find(item => item.id === selectedLocationId);
    if (!label || !location || busy) return;
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
        itemCount: peopleCount,
      });
      setSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
      setCustomerLabel('');
      setPeopleCount(1);
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

  const opener = openerHost ? createPortal(
    <div className="space-y-2">
      <div className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.42fr)_7rem_2.75rem]">
        <input
          value={customerLabel}
          onChange={event => setCustomerLabel(event.target.value)}
          placeholder="Mesa, senha, nome ou identificação..."
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs font-semibold text-white outline-none focus:border-orange-500/40"
        />
        <select
          value={selectedLocationId}
          onChange={event => setSelectedLocationId(event.target.value)}
          disabled={activeLocations.length === 0}
          className="min-h-10 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold uppercase text-white outline-none disabled:text-slate-600"
        >
          {activeLocations.length === 0
            ? <option value="">Nenhum local</option>
            : activeLocations.map(location => (
                <option key={location.id} value={location.id}>{location.label}</option>
              ))}
        </select>
        <label className="flex min-h-10 items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3">
          <span className="text-[9px] font-black uppercase text-slate-500">Pessoas</span>
          <input
            type="number"
            min={1}
            max={999}
            value={peopleCount}
            onChange={event => setPeopleCount(Math.max(1, Math.min(999, Number(event.target.value) || 1)))}
            className="w-10 bg-transparent text-right text-xs font-black text-white outline-none"
            aria-label="Quantidade de pessoas"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={busy || !customerLabel.trim() || !selectedLocationId}
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

  return <>{opener}{filters}</>;
};