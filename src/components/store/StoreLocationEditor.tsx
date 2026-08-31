import { useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import {
  STORE_GEOFENCE_MAX_METERS,
  STORE_GEOFENCE_MIN_METERS,
  type StoreLocationDraft,
} from '../../utils/storeLocation';

interface StoreLocationEditorProps {
  value: StoreLocationDraft;
  onChange: (value: StoreLocationDraft) => void;
  disabled?: boolean;
}

export const StoreLocationEditor = ({
  value,
  onChange,
  disabled = false,
}: StoreLocationEditorProps) => {
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  const update = (field: keyof StoreLocationDraft, nextValue: string): void => {
    onChange({ ...value, [field]: nextValue });
  };

  const useDeviceLocation = (): void => {
    if (!navigator.geolocation) {
      setLocationMessage('Este dispositivo não oferece geolocalização pelo navegador.');
      return;
    }

    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      position => {
        onChange({
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
          geofenceRadiusMeters: value.geofenceRadiusMeters,
        });
        setLocationMessage(
          `Localização capturada${Number.isFinite(position.coords.accuracy) ? ` · precisão aproximada ${Math.round(position.coords.accuracy)} m` : ''}. Revise o ponto antes de salvar.`
        );
        setLocating(false);
      },
      error => {
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? 'Permissão de localização não concedida. Você pode informar as coordenadas manualmente.'
            : 'Não foi possível obter a localização agora. Tente novamente ou informe as coordenadas manualmente.'
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <section
      id="store-location-settings"
      className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-cyan-300">
            <MapPin className="h-4 w-4" />
            Localização GPS da loja
          </span>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Este ponto é a referência canônica para distância, chegada de entregadores e validação futura de presença de colaboradores.
          </p>
        </div>
        <button
          type="button"
          onClick={useDeviceLocation}
          disabled={disabled || locating}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-cyan-500/25 bg-slate-950 px-3 text-[9px] font-black uppercase text-cyan-200 disabled:opacity-50"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          {locating ? 'Localizando...' : 'Usar este dispositivo'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[9px] font-black uppercase text-slate-500">Latitude</span>
          <input
            type="text"
            inputMode="decimal"
            data-store-profile-field="latitude"
            value={value.latitude}
            onChange={event => update('latitude', event.target.value)}
            disabled={disabled}
            placeholder="Ex.: -23.550520"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[9px] font-black uppercase text-slate-500">Longitude</span>
          <input
            type="text"
            inputMode="decimal"
            data-store-profile-field="longitude"
            value={value.longitude}
            onChange={event => update('longitude', event.target.value)}
            disabled={disabled}
            placeholder="Ex.: -46.633308"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[9px] font-black uppercase text-slate-500">Raio de presença · metros</span>
        <input
          type="number"
          min={STORE_GEOFENCE_MIN_METERS}
          max={STORE_GEOFENCE_MAX_METERS}
          step="1"
          data-store-profile-field="geofence-radius"
          value={value.geofenceRadiusMeters}
          onChange={event => update('geofenceRadiusMeters', event.target.value)}
          disabled={disabled}
          placeholder={`${STORE_GEOFENCE_MIN_METERS} a ${STORE_GEOFENCE_MAX_METERS}`}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
        />
        <span className="block text-[9px] leading-relaxed text-slate-600">
          O ponto do colaborador e a confirmação de chegada só poderão usar este raio quando os respectivos fluxos autoritativos forem ativados.
        </span>
      </label>

      {locationMessage && (
        <p className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[9px] leading-relaxed text-slate-400" aria-live="polite">
          {locationMessage}
        </p>
      )}
    </section>
  );
};
