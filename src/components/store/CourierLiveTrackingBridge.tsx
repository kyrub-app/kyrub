import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { Crosshair, LocateFixed, MapPin, X } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { CourierGoogleMap } from './CourierGoogleMap';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';
const TRACKING_STORAGE_KEY = 'kyrub_courier_tracking_delivery_id';
const LAST_POSITION_STORAGE_KEY = 'kyrub_courier_last_position';
const MIN_SEND_INTERVAL_MS = 5_000;

interface AssignedDelivery {
  id: string;
  status: 'accepted' | 'delivering';
  from: string;
  to: string;
}

interface CourierPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  clientCapturedAt: number;
}

interface LocationUpdateResult {
  arrivalDetected: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseStoredPosition = (): CourierPosition | null => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LAST_POSITION_STORAGE_KEY) ?? 'null'
    ) as Partial<CourierPosition> | null;
    if (
      !parsed ||
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.accuracy !== 'number'
    ) {
      return null;
    }
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracy: parsed.accuracy,
      heading: typeof parsed.heading === 'number' ? parsed.heading : null,
      speed: typeof parsed.speed === 'number' ? parsed.speed : null,
      clientCapturedAt:
        typeof parsed.clientCapturedAt === 'number'
          ? parsed.clientCapturedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
};

const postLocation = async (
  deliveryId: string,
  position: CourierPosition
): Promise<LocationUpdateResult> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-tracking/${encodeURIComponent(deliveryId)}/location`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(position),
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.ok) {
    const storeArrival =
      payload.storeArrival && typeof payload.storeArrival === 'object'
        ? payload.storeArrival as Record<string, unknown>
        : null;
    return {
      arrivalDetected: storeArrival?.arrivalDetected === true,
    };
  }
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível atualizar sua localização.'
  );
};

const stopRemoteTracking = async (deliveryId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  await fetch(`/api/delivery-tracking/${encodeURIComponent(deliveryId)}/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined);
};

export function CourierLiveTrackingBridge() {
  const [assignedDeliveries, setAssignedDeliveries] = useState<AssignedDelivery[]>([]);
  const [trackingDeliveryId, setTrackingDeliveryId] = useState(
    () => localStorage.getItem(TRACKING_STORAGE_KEY) ?? ''
  );
  const [position, setPosition] = useState<CourierPosition | null>(parseStoredPosition);
  const [trackingError, setTrackingError] = useState('');
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [storeArrivalDetected, setStoreArrivalDetected] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);
  const sendingRef = useRef(false);

  useEffect(() => {
    let unsubscribeDeliveries = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeDeliveries();
      unsubscribeDeliveries = () => undefined;
      setAssignedDeliveries([]);
      if (!user) return;

      unsubscribeDeliveries = onSnapshot(
        collection(db, DELIVERY_COLLECTION_PATH),
        snapshot => {
          const next = snapshot.docs.flatMap(document => {
            const data = document.data() as Record<string, unknown>;
            const status = clean(data.status);
            if (
              clean(data.acceptedBy) !== user.uid ||
              !['accepted', 'delivering'].includes(status)
            ) {
              return [];
            }
            return [{
              id: clean(data.id) || document.id,
              status: status as AssignedDelivery['status'],
              from: clean(data.from),
              to: clean(data.to),
            } satisfies AssignedDelivery];
          });
          setAssignedDeliveries(next);
          setPanelDismissed(false);
        },
        error => {
          console.warn('Entregas atribuídas indisponíveis para rastreio.', error);
        }
      );
    });
    return () => {
      unsubscribeAuth();
      unsubscribeDeliveries();
    };
  }, []);

  const activeDelivery = useMemo(
    () =>
      assignedDeliveries.find(delivery => delivery.id === trackingDeliveryId) ??
      assignedDeliveries[0] ??
      null,
    [assignedDeliveries, trackingDeliveryId]
  );

  useEffect(() => {
    setStoreArrivalDetected(false);
  }, [activeDelivery?.id]);

  useEffect(() => {
    if (
      trackingDeliveryId &&
      !assignedDeliveries.some(delivery => delivery.id === trackingDeliveryId)
    ) {
      const completedTrackingId = trackingDeliveryId;
      localStorage.removeItem(TRACKING_STORAGE_KEY);
      setTrackingDeliveryId('');
      setStoreArrivalDetected(false);
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      void stopRemoteTracking(completedTrackingId);
    }
  }, [assignedDeliveries, trackingDeliveryId]);

  useEffect(() => {
    if (!trackingDeliveryId) return;
    if (!navigator.geolocation) {
      setTrackingError('Este aparelho não disponibiliza geolocalização.');
      return;
    }

    setTrackingError('');
    watchIdRef.current = navigator.geolocation.watchPosition(
      current => {
        const next: CourierPosition = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          accuracy: current.coords.accuracy,
          heading:
            typeof current.coords.heading === 'number'
              ? current.coords.heading
              : null,
          speed:
            typeof current.coords.speed === 'number'
              ? current.coords.speed
              : null,
          clientCapturedAt: current.timestamp,
        };
        setPosition(next);
        localStorage.setItem(LAST_POSITION_STORAGE_KEY, JSON.stringify(next));

        const now = Date.now();
        if (
          sendingRef.current ||
          now - lastSentAtRef.current < MIN_SEND_INTERVAL_MS
        ) {
          return;
        }
        sendingRef.current = true;
        lastSentAtRef.current = now;
        void postLocation(trackingDeliveryId, next)
          .then(result => {
            if (result.arrivalDetected) {
              setStoreArrivalDetected(true);
            }
          })
          .catch(error => {
            setTrackingError(
              error instanceof Error
                ? error.message
                : 'Não foi possível enviar sua localização.'
            );
          })
          .finally(() => {
            sendingRef.current = false;
          });
      },
      error => {
        setTrackingError(
          error.code === error.PERMISSION_DENIED
            ? 'Permissão de localização negada. Ative-a nas configurações do navegador.'
            : 'Não foi possível obter sua localização atual.'
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 15_000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [trackingDeliveryId]);

  const enableTracking = (): void => {
    if (!activeDelivery) return;
    localStorage.setItem(TRACKING_STORAGE_KEY, activeDelivery.id);
    setTrackingDeliveryId(activeDelivery.id);
    setPanelDismissed(false);
    setTrackingError('');
  };

  const disableTracking = (): void => {
    const deliveryId = trackingDeliveryId;
    localStorage.removeItem(TRACKING_STORAGE_KEY);
    setTrackingDeliveryId('');
    setStoreArrivalDetected(false);
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (deliveryId) void stopRemoteTracking(deliveryId);
  };

  if (!activeDelivery || panelDismissed) return null;

  const trackingActive = trackingDeliveryId === activeDelivery.id;

  return (
    <aside className="fixed bottom-20 right-3 z-[190] w-[min(92vw,360px)] rounded-3xl border border-cyan-500/25 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur-xl sm:bottom-5 sm:right-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Entregador Kyrub
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-black">
            <MapPin className="h-4 w-4 text-orange-400" />
            {trackingActive ? 'Rastreio ao vivo' : 'Entrega aceita'}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setPanelDismissed(true)}
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"
          aria-label="Minimizar rastreio"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-1 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[10px]">
        <p className="truncate text-slate-300"><strong className="text-slate-500">Coleta:</strong> {activeDelivery.from}</p>
        <p className="truncate text-slate-300"><strong className="text-slate-500">Destino:</strong> {activeDelivery.to}</p>
      </div>

      {trackingActive ? (
        <div className="mt-3 space-y-3">
          <CourierGoogleMap
            position={position}
            origin={activeDelivery.from}
            destination={activeDelivery.to}
          />
          {storeArrivalDetected && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[9px] text-emerald-200">
              <p className="flex items-center gap-2 font-black">
                <MapPin className="h-3.5 w-3.5" />
                Você chegou à loja
              </p>
              <p className="mt-1 leading-relaxed text-emerald-300/80">
                Chegada detectada por geofence. A retirada continua dependendo da confirmação segura.
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[9px] font-bold text-emerald-300">
            <Crosshair className="h-3.5 w-3.5" />
            Localização compartilhada somente durante esta entrega.
          </div>
          {trackingError && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] leading-relaxed text-red-300">
              {trackingError}
            </p>
          )}
          <button
            type="button"
            onClick={disableTracking}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-[9px] font-black uppercase text-slate-300"
          >
            Parar rastreio
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] leading-relaxed text-slate-400">
            Ative o GPS para compartilhar sua posição durante a corrida. O navegador solicitará sua permissão.
          </p>
          <button
            type="button"
            onClick={enableTracking}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-[10px] font-black uppercase text-slate-950"
          >
            <LocateFixed className="h-4 w-4" />
            Ativar localização
          </button>
        </div>
      )}
    </aside>
  );
}
