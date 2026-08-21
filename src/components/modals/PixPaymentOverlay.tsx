import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, QrCode, X } from 'lucide-react';
import {
  MARKETPLACE_PIX_READY_EVENT,
  type MarketplacePixReadyDetail,
} from '../../utils/marketplacePaymentEvents';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatExpiry = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export function PixPaymentOverlay() {
  const [checkout, setCheckout] = useState<MarketplacePixReadyDetail | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onPixReady = (event: Event): void => {
      const customEvent = event as CustomEvent<MarketplacePixReadyDetail>;
      setCheckout(customEvent.detail);
      setCopied(false);
    };
    window.addEventListener(MARKETPLACE_PIX_READY_EVENT, onPixReady);
    return () =>
      window.removeEventListener(MARKETPLACE_PIX_READY_EVENT, onPixReady);
  }, []);

  if (!checkout) return null;

  const copyPix = async (): Promise<void> => {
    if (!checkout.pixQrCode) return;
    try {
      await navigator.clipboard.writeText(checkout.pixQrCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Pagamento Pix"
      id="marketplace-pix-overlay"
    >
      <section className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 text-white shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
              <QrCode className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300">
                Pix Mercado Pago
              </span>
              <h2 className="mt-1 text-xl font-black">Pague para enviar o pedido</h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                O pedido só entra na loja depois que o Mercado Pago confirmar o pagamento.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCheckout(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
            aria-label="Fechar pagamento Pix"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <span className="text-xs text-slate-500">Valor</span>
          <strong className="font-mono text-xl text-white">
            {currencyFormatter.format(checkout.amount)}
          </strong>
        </div>

        {checkout.pixQrCodeBase64 && (
          <div className="mt-4 rounded-3xl bg-white p-4">
            <img
              src={`data:image/png;base64,${checkout.pixQrCodeBase64}`}
              alt="QR Code Pix"
              className="mx-auto aspect-square w-full max-w-[280px] object-contain"
            />
          </div>
        )}

        {checkout.pixQrCode && (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="block font-mono text-[8px] font-black uppercase tracking-widest text-slate-500">
              Pix Copia e Cola
            </span>
            <p className="mt-2 max-h-20 overflow-hidden break-all font-mono text-[9px] leading-4 text-slate-300">
              {checkout.pixQrCode}
            </p>
            <button
              type="button"
              onClick={() => void copyPix()}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-xs font-black uppercase text-slate-950"
              id="marketplace-pix-copy"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Código copiado' : 'Copiar código Pix'}
            </button>
          </div>
        )}

        {checkout.pixTicketUrl && (
          <a
            href={checkout.pixTicketUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 text-xs font-black uppercase text-white hover:bg-slate-700"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir pagamento no Mercado Pago
          </a>
        )}

        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] leading-5 text-amber-200/80">
          Não feche como “pago” manualmente. A confirmação é automática pelo webhook assinado do provedor.
          {formatExpiry(checkout.expiresAt) && (
            <> Este Pix vence às {formatExpiry(checkout.expiresAt)}.</>
          )}
        </div>
      </section>
    </div>
  );
}
