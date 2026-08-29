import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award } from 'lucide-react';

interface ProductStorePointsFieldBridgeProps {
  isOpen: boolean;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function ProductStorePointsFieldBridge({
  isOpen,
  value,
  disabled = false,
  onChange,
}: ProductStorePointsFieldBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const createdHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      createdHostRef.current?.remove();
      createdHostRef.current = null;
      setHost(null);
      return;
    }

    let cancelled = false;

    const synchronize = (): void => {
      if (cancelled) return;
      const showcase = document.getElementById('product-showcase-tab');
      if (!(showcase instanceof HTMLElement)) {
        if (createdHostRef.current) {
          createdHostRef.current.remove();
          createdHostRef.current = null;
          setHost(null);
        }
        return;
      }

      if (!createdHostRef.current?.isConnected) {
        const nextHost = document.createElement('div');
        nextHost.id = 'product-store-points-field-host';
        const priceGrid = showcase.querySelector('.grid');
        if (priceGrid?.parentElement === showcase) {
          priceGrid.insertAdjacentElement('afterend', nextHost);
        } else {
          showcase.appendChild(nextHost);
        }
        createdHostRef.current = nextHost;
        setHost(nextHost);
      }
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      createdHostRef.current?.remove();
      createdHostRef.current = null;
      setHost(null);
    };
  }, [isOpen]);

  if (!host) return null;

  return createPortal(
    <section
      className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"
      id="product-store-points-field"
    >
      <div className="flex items-start gap-3">
        <Award className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <label
            htmlFor="product-store-points-per-unit"
            className="block text-[10px] font-black uppercase tracking-wide text-amber-200"
          >
            Pontos da loja por unidade
          </label>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Quantos pontos o cliente recebe por cada unidade comprada. O valor é congelado no pedido quando o pagamento é criado.
          </p>
          <input
            id="product-store-points-per-unit"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={value}
            disabled={disabled}
            onChange={event => {
              const parsed = Number(event.target.value);
              if (Number.isSafeInteger(parsed) && parsed >= 0) onChange(parsed);
            }}
            className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm font-black text-amber-200 outline-none focus:border-amber-400 disabled:opacity-45"
          />
          <span className="mt-2 block text-[9px] text-slate-500">
            0 = este item não gera Pontos da Loja.
          </span>
        </div>
      </div>
    </section>,
    host
  );
}
