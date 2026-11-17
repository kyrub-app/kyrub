import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Crosshair, KeyRound, LocateFixed, MapPin, X } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import { CourierGoogleMap } from './CourierGoogleMap';
import { isCourierVehicleType, type CourierVehicleType } from '../../../shared/deliveryVehicleCompatibility';
import { buildCourierDeliveryNavigationUrl } from '../../utils/googleMapsDirections';

const DELIVERY_COLLECTION_PATH = 'hub/renda/deliveries';
const TRACKING_STORAGE_KEY = 'kyrub_courier_tracking_delivery_id';
const MIN_SEND_INTERVAL_MS = 5_000;

interface AssignedDelivery {
  id: string;
  status: 'accepted' | 'delivering';
  from: string;
  to: string;
  vehicleType: CourierVehicleType | null;
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

const confirmSecurePickup = async (
  deliveryId: string,
  handoffCode: string
): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/${encodeURIComponent(deliveryId)}/secure-pickup`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ handoffCode }),
    }
  );
  if (response.ok) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível confirmar a coleta segura.'
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
  const [assignedDeliveriesLoaded, setAssignedDeliveriesLoaded] = useState(false);
  const [trackingDeliveryId, setTrackingDeliveryId] = useState(
    () => localStorage.getItem(TRACKING_STORAGE_KEY) ?? ''
  );
  const [position, setPosition] = useState<CourierPosition | null>(null);
  const [trackingError, setTrackingError] = useState('');
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [storeArrivalDetected, setStoreArrivalDetected] = useState(false);
  const [pickupCode, setPickupCode] = useState('');
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [motofreteHold, setMotofreteHold] = useState(false);
  const [holdLoaded, setHoldLoaded] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    let unsubscribeDeliveries = () => undefined;
    let unsubscribeHold = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeDeliveries();
      unsubscribeHold();
      unsubscribeDeliveries = () => undefined;
      unsubscribeHold = () => undefined;
      setMotofreteHold(false);
      setHoldLoaded(false);
      setAssignedDeliveries([]);
      setAssignedDeliveriesLoaded(false);
      setPosition(null);
      if (!user) {
        setAssignedDeliveriesLoaded(true);
        return;
      }

      unsubscribeHold = onSnapshot(
        doc(db, 'courierComplianceHolds', user.uid),
        snapshot => {
          setMotofreteHold(snapshot.exists() && snapshot.data()?.active === true);
          setHoldLoaded(true);
        },
        error => {
          console.warn('Bloqueio de motofrete indisponível.', error);
          setMotofreteHold(true);
          setHoldLoaded(false);
        }
      );
      unsubscribeDeliveries = onSnapshot(
        query(collection(db, DELIVERY_COLLECTION_PATH), where('acceptedBy', '==', user.uid)),
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
              vehicleType: isCourierVehicleType(data.vehicleType) ? data.vehicleType : null,
            } satisfies AssignedDelivery];
          });
          setAssignedDeliveries(next);
          setAssignedDeliveriesLoaded(true);
          setPanelDismissed(false);
        },
        error => {
          console.warn('Entregas atribuídas indisponíveis para rastreio.', error);
          // A failed subscription does not prove the assignment ended.
          setAssignedDeliveriesLoaded(false);
          setAssignedDeliveries([]);
        }
      );
    });
    return () => {
      unsubscribeAuth();
      unsubscribeDeliveries();
      unsubscribeHold();
    };
  }, []);

  useEffect(() => {
    // Remove precise coordinates stored by older releases; do not persist them across users.
    localStorage.removeItem('kyrub_courier_last_position');
  }, []);

  const activeDelivery = useMemo(
    () =>
      assignedDeliveries.find(delivery => delivery.id === trackingDeliveryId) ??
      assignedDeliveries[0] ??
      null,
    [assignedDeliveries, trackingDeliveryId]
  );
  const trackingAuthorized = assignedDeliveriesLoaded && assignedDeliveries.some(
    delivery => delivery.id === trackingDeliveryId
  );

  useEffect(() => {
    setStoreArrivalDetected(false);
    setPickupCode('');
    setPickupError('');
  }, [activeDelivery?.id]);

  useEffect(() => {
    if (
      assignedDeliveriesLoaded &&
      trackingDeliveryId &&
      !trackingAuthorized
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
  }, [assignedDeliveriesLoaded, trackingAuthorized, trackingDeliveryId]);

  useEffect(() => {
    if (!trackingDeliveryId || !trackingAuthorized) return;
    if (!navigator.geolocation) {
      setTrackingError('Este aparelho não disponibiliza geolocalização.');
      return;
    }

    let cancelled = false;
    let lastSentAt = 0;
    let sending = false;
    setPosition(null);
    setTrackingError('');
    watchIdRef.current = navigator.geolocation.watchPosition(
      current => {
        if (cancelled) return;
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

        const now = Date.now();
        if (
          sending ||
          now - lastSentAt < MIN_SEND_INTERVAL_MS
        ) {
          return;
        }
        sending = true;
        lastSentAt = now;
        void postLocation(trackingDeliveryId, next)
          .then(result => {
            if (!cancelled && result.arrivalDetected) {
              setStoreArrivalDetected(true);
            }
          })
          .catch(error => {
            if (cancelled) return;
            setTrackingError(
              error instanceof Error
                ? error.message
                : 'Não foi possível enviar sua localização.'
            );
          })
          .finally(() => {
            sending = false;
          });
      },
      error => {
        if (cancelled) return;
        if (error.code === error.PERMISSION_DENIED) {
          // Do not leave the server publishing the previous position as a live track.
          localStorage.removeItem(TRACKING_STORAGE_KEY);
          setTrackingDeliveryId('');
          setPosition(null);
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          void stopRemoteTracking(trackingDeliveryId);
          setTrackingError('Permissão negada. O compartilhamento foi interrompido; ative-a nas configurações do navegador.');
        } else {
          // Transient GPS loss is handled by the server's location freshness TTL.
          setTrackingError('Sinal GPS indisponível. A posição anterior deixará de aparecer como ativa.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 15_000,
      }
    );

    return () => {
      cancelled = true;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [trackingDeliveryId, trackingAuthorized]);

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

  const handleSecurePickup = async (): Promise<void> => {
    if (!activeDelivery || !/^\d{6}$/.test(pickupCode)
      || (activeDelivery.vehicleType === 'motorcycle' && (!holdLoaded || motofreteHold))) return;
    setPickupBusy(true);
    setPickupError('');
    try {
      await confirmSecurePickup(activeDelivery.id, pickupCode);
      setPickupCode('');
    } catch (error) {
      setPickupError(
        error instanceof Error
          ? error.message
          : 'Não foi possível confirmar a coleta segura.'
      );
    } finally {
      setPickupBusy(false);
    }
  };

  if (!activeDelivery || panelDismissed) return null;

  const trackingActive = trackingDeliveryId === activeDelivery.id;
  let externalNavigationUrl = '';
  try {
    externalNavigationUrl = buildCourierDeliveryNavigationUrl({
      status: activeDelivery.status,
      vehicleType: activeDelivery.vehicleType,
      pickup: activeDelivery.from,
      dropoff: activeDelivery.to,
    });
  } catch {
    // Do not assume a vehicle or fabricate an address for a legacy delivery.
  }
  const complianceBlocked = activeDelivery.vehicleType === 'motorcycle'
    && (!holdLoaded || motofreteHold);
  const awaitingSecurePickup =
    trackingActive &&
    storeArrivalDetected &&
    activeDelivery.status === 'accepted'
    && !complianceBlocked;

  return (
    <aside className="fixed bottom-20 right-3 z-[190] w-[min(92vw,360px)] rounded-3xl border border-cyan-500/25 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur-xl sm:bottom-5 sm:right-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-cyan-300">
            Entregador Kyrub
          </span>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-black">
            <MapPin className="h-4 w-4 text-orange-400" />
            {activeDelivery.status === 'delivering'
              ? 'Em rota para o cliente'
              : trackingActive
                ? 'Rastreio ao vivo'
                : 'Entrega aceita'}
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

      {complianceBlocked && (
        <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-950/60 p-3 text-[10px] text-red-100">
          <p className="font-black">Motofrete sob bloqueio de segurança</p>
          <p className="mt-1 leading-relaxed">
            Não inicie uma nova etapa nem retire o pedido. Se já estiver em rota,
            pare em local seguro e contate o suporte para receber orientação logística.
            O rastreio da entrega pode continuar para preservar a segurança da encomenda.
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-[10px]">
        <p className="truncate text-slate-300"><strong className="text-slate-500">Coleta:</strong> {activeDelivery.from}</p>
        <p className="truncate text-slate-300"><strong className="text-slate-500">Destino:</strong> {activeDelivery.to}</p>
        <p className="text-[9px] text-cyan-300">
          {activeDelivery.vehicleType === 'bicycle' ? 'Rota de bicicleta' : activeDelivery.vehicleType === 'motorcycle' ? 'Rota de moto' : activeDelivery.vehicleType === 'car' ? 'Rota de carro' : 'Veículo não confirmado'}
          {' · '}{activeDelivery.status === 'accepted' ? 'Próximo trecho: coleta' : 'Próximo trecho: cliente'}
        </p>
        {externalNavigationUrl && !trackingActive && !complianceBlocked && (
          <a href={externalNavigationUrl} target="_blank" rel="noopener noreferrer"
             className="mt-2 block rounded-lg border border-cyan-500/30 px-3 py-2 text-center text-[9px] font-black uppercase text-cyan-300">
            {activeDelivery.status === 'accepted' ? 'Navegar até a coleta' : 'Navegar até o cliente'}
          </a>
        )}
      </div>

      {trackingActive ? (
        <div className="mt-3 space-y-3">
          <CourierGoogleMap
            position={position}
            origin={activeDelivery.from}
            destination={activeDelivery.to}
            navigation={{ status: activeDelivery.status, vehicleType: activeDelivery.vehicleType }}
          />
          {storeArrivalDetected && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[9px] text-emerald-200">
              <p className="flex items-center gap-2 font-black">
                <MapPin className="h-3.5 w-3.5" />
                Você chegou à loja
              </p>
              <p className="mt-1 leading-relaxed text-emerald-300/80">
                Chegada detectada por geofence. A rota só começa após a coleta segura.
              </p>
            </div>
          )}

          {awaitingSecurePickup && (
            <div className="space-y-2 rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3">
              <label className="flex items-center gap-2 text-[9px] font-black uppercase text-orange-300">
                <KeyRound className="h-3.5 w-3.5" />
                Código de coleta
              </label>
              <input
                value={pickupCode}
                onChange={event => {
                  setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                  setPickupError('');
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-center font-mono text-xl tracking-[0.3em] text-white outline-none focus:border-orange-400"
                aria-label="Código seguro de coleta"
              />
              <p className="text-[9px] leading-relaxed text-orange-100/70">
                Peça o código à loja somente depois de receber fisicamente o pedido.
              </p>
              {pickupError && (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
                  {pickupError}
                </p>
              )}
              <button
                type="button"
                disabled={pickupBusy || !/^\d{6}$/.test(pickupCode)}
                onClick={() => void handleSecurePickup()}
                className="w-full rounded-xl bg-orange-500 py-3 text-[9px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pickupBusy ? 'Confirmando coleta…' : 'Confirmar coleta e iniciar rota'}
              </button>
            </div>
          )}

          {activeDelivery.status === 'delivering' && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[9px] font-bold text-cyan-200">
              Coleta confirmada. Rota para o cliente iniciada.
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
          {trackingError && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-[9px] text-red-200">
              {trackingError}
            </p>
          )}
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
