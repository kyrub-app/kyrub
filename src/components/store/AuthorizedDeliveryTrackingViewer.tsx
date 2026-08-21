import { useEffect, useState } from 'react';
import { Crosshair, LoaderCircle, MapPin } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { CourierGoogleMap } from './CourierGoogleMap';

const REFRESH_INTERVAL_MS = 5_000;

interface TrackingPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface AuthorizedDeliveryTrackingViewerProps {
  deliveryId: string;
  origin: string;
  destination: string;
  compact?: boolean;
}

interface TrackingResponse {
  active?: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  updatedAt?: string;
  error?: string;
}

const fetchAuthorizedPosition = async (
  deliveryId: string
): Promise<{ position: TrackingPosition | null; active: boolean; updatedAt: string }> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-tracking/${encodeURIComponent(deliveryId)}/location`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const payload = await response.json().catch(() => ({})) as TrackingResponse;
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível consultar o rastreio.');
  }
  const active = payload.active === true;
  const position =
    active &&
    typeof payload.latitude === 'number' &&
    typeof payload.longitude === 'number' &&
    typeof payload.accuracy === 'number'
      ? {
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy,
        }
      : null;
  return { position, active, updatedAt: payload.updatedAt ?? '' };
};

export function AuthorizedDeliveryTrackingViewer({
  deliveryId,
  origin,
  destination,
  compact = false,
}: AuthorizedDeliveryTrackingViewerProps) {
  const [position, setPosition] = useState<TrackingPosition | null>(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const refresh = async (): Promise<void> => {
      try {
        const next = await fetchAuthorizedPosition(deliveryId);
        if (cancelled) return;
        setPosition(next.position);
        setActive(next.active);
        setUpdatedAt(next.updatedAt);
        setErrorMessage('');
      } catch (error) {
        if (cancelled) return;
        setPosition(null);
        setActive(false);
        setErrorMessage(
          error instanceof Error ? error.message : 'Rastreio indisponível.'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = window.setTimeout(() => void refresh(), REFRESH_INTERVAL_MS);
        }
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deliveryId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-slate-500">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Consultando rastreio autorizado...
      </div>
    );
  }

  if (errorMessage) {
    return (
      <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] leading-relaxed text-red-300">
        {errorMessage}
      </p>
    );
  }

  if (!active || !position) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-slate-500">
        <MapPin className="h-3.5 w-3.5" />
        O entregador ainda não iniciou o compartilhamento de localização.
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <CourierGoogleMap
        position={position}
        origin={origin}
        destination={destination}
      />
      <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-[9px] text-emerald-300">
        <span className="flex items-center gap-2 font-bold">
          <Crosshair className="h-3.5 w-3.5" />
          Entregador em deslocamento
        </span>
        {updatedAt && (
          <span className="font-mono text-[8px] text-emerald-400/70">
            {new Date(updatedAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
