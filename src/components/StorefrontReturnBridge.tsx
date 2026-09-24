import { useEffect, useState } from 'react';
import { ArrowLeft, Store } from 'lucide-react';
import {
  loadStorefrontOriginContext,
  type StorefrontOriginContext,
} from '../utils/storefrontOriginContext';

export function StorefrontReturnBridge() {
  const [origin, setOrigin] = useState<StorefrontOriginContext | null>(() =>
    loadStorefrontOriginContext()
  );

  useEffect(() => {
    const refresh = (): void => setOrigin(loadStorefrontOriginContext());
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  if (!origin) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[76px] z-[145] px-3 sm:bottom-5 sm:left-auto sm:right-5 sm:w-auto sm:px-0"
      id="storefront-return-bridge"
    >
      <a
        href={origin.path}
        className="pointer-events-auto mx-auto flex min-h-12 w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-orange-400/35 bg-slate-950/95 px-4 text-orange-200 shadow-2xl shadow-black/40 backdrop-blur-md sm:w-[22rem]"
        aria-label={`Voltar para ${origin.storeName}`}
        id="storefront-return-bridge-link"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <strong className="block truncate text-xs font-black">
              Voltar para {origin.storeName}
            </strong>
            <span className="block truncate text-[9px] text-orange-200/65">
              Retomar loja e pedido de origem
            </span>
          </span>
        </span>
        <Store className="h-4 w-4 shrink-0" />
      </a>
    </div>
  );
}
