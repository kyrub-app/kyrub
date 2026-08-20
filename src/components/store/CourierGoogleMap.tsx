import { useEffect, useRef, useState } from 'react';

interface CourierPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface CourierGoogleMapProps {
  position: CourierPosition | null;
  origin: string;
  destination: string;
}

type GoogleMapsImportLibrary = (
  library: string
) => Promise<Record<string, unknown>>;

type KyrubMapsWindow = Window & {
  __kyrubGoogleMapsPromise?: Promise<void>;
  [key: string]: unknown;
};

const mapsApiKey = (): string =>
  String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

const googleMapsImportLibrary = (): GoogleMapsImportLibrary | null => {
  const google = (window as unknown as { google?: unknown }).google;
  if (!google || typeof google !== 'object') return null;
  const maps = (google as { maps?: unknown }).maps;
  if (!maps || typeof maps !== 'object') return null;
  const importLibrary = (maps as { importLibrary?: unknown }).importLibrary;
  return typeof importLibrary === 'function'
    ? importLibrary as GoogleMapsImportLibrary
    : null;
};

const loadGoogleMaps = async (): Promise<boolean> => {
  const key = mapsApiKey();
  if (!key) return false;
  if (googleMapsImportLibrary()) return true;

  const kyrubWindow = window as unknown as KyrubMapsWindow;
  if (kyrubWindow.__kyrubGoogleMapsPromise) {
    await kyrubWindow.__kyrubGoogleMapsPromise;
    return Boolean(googleMapsImportLibrary());
  }

  kyrubWindow.__kyrubGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const callbackName = `__kyrubMapsReady_${Date.now()}`;
    kyrubWindow[callbackName] = () => {
      delete kyrubWindow[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.id = 'kyrub-google-maps-js';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${encodeURIComponent(callbackName)}`;
    script.onerror = () => {
      delete kyrubWindow[callbackName];
      reject(new Error('Google Maps não pôde ser carregado.'));
    };
    document.head.appendChild(script);
  });

  try {
    await kyrubWindow.__kyrubGoogleMapsPromise;
    return Boolean(googleMapsImportLibrary());
  } catch {
    kyrubWindow.__kyrubGoogleMapsPromise = undefined;
    return false;
  }
};

const routeUrl = (origin: string, destination: string): string => {
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export function CourierGoogleMap({
  position,
  origin,
  destination,
}: CourierGoogleMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [mapsAvailable, setMapsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!position || !containerRef.current) return;

    void loadGoogleMaps().then(async loaded => {
      if (cancelled) return;
      setMapsAvailable(loaded);
      const importLibrary = googleMapsImportLibrary();
      if (!loaded || !importLibrary || !containerRef.current) return;

      const library = await importLibrary('maps') as {
        Map?: new (element: HTMLElement, options: Record<string, unknown>) => any;
      };
      if (cancelled || !library.Map || !containerRef.current) return;
      const center = { lat: position.latitude, lng: position.longitude };
      if (!mapRef.current) {
        mapRef.current = new library.Map(containerRef.current, {
          center,
          zoom: 16,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });
      } else {
        mapRef.current.setCenter(center);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [position?.latitude, position?.longitude]);

  const externalRoute = origin && destination ? routeUrl(origin, destination) : '';

  return (
    <div className="space-y-2">
      <div className="relative h-40 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
        <div ref={containerRef} className="h-full w-full" />
        {position && mapsAvailable !== true && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950 px-5 text-center">
            <span className="text-[10px] font-black uppercase text-cyan-300">
              GPS ativo
            </span>
            <span className="font-mono text-[9px] leading-relaxed text-slate-500">
              O mapa interno será exibido quando a chave Google Maps estiver configurada para este domínio.
            </span>
          </div>
        )}
        {position && mapsAvailable === true && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-500 shadow-[0_0_0_5px_rgba(6,182,212,0.25)]" />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-[9px] font-mono text-slate-500">
        <span>
          {position ? `Precisão aproximada: ${Math.round(position.accuracy)} m` : 'Aguardando posição GPS'}
        </span>
        {externalRoute && (
          <a
            href={externalRoute}
            target="_blank"
            rel="noreferrer"
            className="font-black uppercase text-cyan-300 hover:text-cyan-200"
          >
            Abrir rota
          </a>
        )}
      </div>
    </div>
  );
}
