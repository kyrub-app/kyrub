import { useMemo, useState } from 'react';
import type React from 'react';
import {
  Copy,
  ExternalLink,
  Link2,
  LockKeyhole,
  MessageCircle,
  Share2,
} from 'lucide-react';
import type { Store } from '../../types';
import { buildPublicStorefrontUrl } from '../../utils/appRoutes';
import { StoreResetDangerZone } from './StoreResetDangerZone';

interface StoreSharingPanelProps {
  store: Store | null;
  isPublished: boolean;
  isResetting: boolean;
  onReset: () => Promise<void>;
}

type Feedback = {
  message: string;
  type: 'success' | 'warning';
} | null;

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

export const StoreSharingPanel: React.FC<StoreSharingPanelProps> = ({
  store,
  isPublished,
  isResetting,
  onReset,
}) => {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const storefrontUrl = useMemo(
    () =>
      store?.slug
        ? buildPublicStorefrontUrl(window.location.origin, store.slug)
        : '',
    [store?.slug]
  );
  const operationalUrl = `${window.location.origin.replace(/\/$/, '')}/app`;

  const notify = (message: string, type: 'success' | 'warning'): void => {
    setFeedback({ message, type });
    window.setTimeout(() => setFeedback(null), 3200);
  };

  const handleCopy = async (value: string, label: string): Promise<void> => {
    try {
      await copyText(value);
      notify(`${label} copiado.`, 'success');
    } catch {
      notify(`Não foi possível copiar ${label.toLowerCase()}.`, 'warning');
    }
  };

  const handleShare = async (): Promise<void> => {
    if (!storefrontUrl || !store) return;

    const shareData = {
      title: store.name || 'Vitrine Kyrub',
      text: `Conheça a vitrine ${store.name || `@${store.slug}`} no Kyrub.`,
      url: storefrontUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    await handleCopy(storefrontUrl, 'Link da vitrine');
  };

  const openWhatsApp = (): void => {
    if (!storefrontUrl || !store) return;
    const message = `Conheça a vitrine ${store.name || `@${store.slug}`} no Kyrub: ${storefrontUrl}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <div className="space-y-4">
      <section
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
        id="store-sharing-access-panel"
      >
        <div>
          <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
            <Share2 className="h-4 w-4 text-orange-400" />
            Divulgação e acessos
          </span>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Compartilhe a vitrine com clientes. O endereço operacional é reservado à equipe autenticada.
          </p>
        </div>

        <article className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="flex items-center gap-1.5 text-[9px] font-black uppercase text-orange-300">
                <Link2 className="h-3.5 w-3.5" />
                Link público da vitrine
              </span>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                Clientes usam este endereço para abrir o PDV, montar pedidos e acompanhar a conta.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase ${
                isPublished
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
              }`}
            >
              {isPublished ? 'Publicada' : 'Oculta'}
            </span>
          </div>

          <div className="break-all rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-[10px] text-slate-300">
            {storefrontUrl || 'Informe o nome da loja para gerar o endereço.'}
          </div>

          {!isPublished && storefrontUrl && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] leading-relaxed text-amber-200">
              O link já está reservado, mas a loja precisa ser publicada para aparecer aos clientes.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => void handleCopy(storefrontUrl, 'Link da vitrine')}
              disabled={!storefrontUrl}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-35"
              id="copy-public-storefront-link"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </button>
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={!storefrontUrl}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-35"
              id="share-public-storefront-link"
            >
              <Share2 className="h-3.5 w-3.5" />
              Compartilhar
            </button>
            <button
              type="button"
              onClick={openWhatsApp}
              disabled={!storefrontUrl}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-2 text-[8px] font-black uppercase text-emerald-300 disabled:opacity-35"
              id="share-storefront-whatsapp"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => window.open(storefrontUrl, '_blank', 'noopener,noreferrer')}
              disabled={!storefrontUrl}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-2 text-[8px] font-black uppercase text-slate-950 disabled:opacity-35"
              id="open-public-storefront-link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir
            </button>
          </div>
        </article>

        <article className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <div>
            <span className="flex items-center gap-1.5 text-[9px] font-black uppercase text-teal-300">
              <LockKeyhole className="h-3.5 w-3.5" />
              Acesso operacional
            </span>
            <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
              Proprietário e colaboradores autorizados entram com a própria conta Google. Este não é o link de divulgação para clientes.
            </p>
          </div>
          <div className="break-all rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-[10px] text-slate-300">
            {operationalUrl}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopy(operationalUrl, 'Link operacional')}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300"
              id="copy-operational-app-link"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar acesso
            </button>
            <button
              type="button"
              onClick={() => window.open(operationalUrl, '_blank', 'noopener,noreferrer')}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-teal-500/25 bg-teal-500/10 px-3 text-[8px] font-black uppercase text-teal-300"
              id="open-operational-app-link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir /app
            </button>
          </div>
        </article>

        {feedback && (
          <p
            className={`rounded-xl border px-3 py-2 text-[9px] font-bold ${
              feedback.type === 'success'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </section>

      <StoreResetDangerZone
        store={store}
        isResetting={isResetting}
        onReset={onReset}
      />
    </div>
  );
};
