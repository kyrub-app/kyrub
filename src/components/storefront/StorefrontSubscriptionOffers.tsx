import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  Repeat2,
  X,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import type { Product } from '../../types';
import { auth } from '../../utils/firebase';
import { createMerchantSubscriptionCheckout } from '../../utils/storeSubscription';

interface StorefrontSubscriptionOffersProps {
  storeId: string;
  storeName: string;
  products: Product[];
  accentColor?: string;
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const intervalUnitLabel = (unit: 'day' | 'week' | 'month' | 'year', count: number): string => {
  const labels = {
    day: count === 1 ? 'dia' : 'dias',
    week: count === 1 ? 'semana' : 'semanas',
    month: count === 1 ? 'mês' : 'meses',
    year: count === 1 ? 'ano' : 'anos',
  } as const;
  return `${count} ${labels[unit]}`;
};

const benefitLabel = (product: Product): string => {
  const terms = product.saleModality?.mode === 'subscription'
    ? product.saleModality.subscription
    : null;
  if (!terms) return '';
  if (terms.benefit.kind === 'access') return 'Acesso durante cada ciclo pago';
  if (terms.benefit.kind === 'usage_credits') {
    return `${terms.benefit.unitsPerCycle} uso(s) por ciclo pago`;
  }
  return `${terms.benefit.unitsPerCycle} unidade(s) por ciclo pago`;
};

const canonicalProductId = (product: Product): string =>
  product.sourceProductId?.trim() || product.id.split('::', 1)[0]?.trim() || product.id.trim();

export function StorefrontSubscriptionOffers({
  storeId,
  storeName,
  products,
  accentColor = '#f97316',
}: StorefrontSubscriptionOffersProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [selected, setSelected] = useState<Product | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const subscriptions = useMemo(
    () => products.filter(product => product.saleModality?.mode === 'subscription'),
    [products]
  );

  if (subscriptions.length === 0) return null;

  const close = (): void => {
    if (checkoutBusy || authBusy) return;
    setSelected(null);
    setError('');
    setMessage('');
  };

  const login = async (): Promise<void> => {
    if (authBusy) return;
    setAuthBusy(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      setMessage('Conta identificada. Confira a assinatura e continue para o Mercado Pago.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível concluir o login com Google.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const startCheckout = async (): Promise<void> => {
    if (!selected || !user || checkoutBusy) return;
    setCheckoutBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await createMerchantSubscriptionCheckout({
        storeId,
        productId: canonicalProductId(selected),
      });
      if (!result.checkoutUrl) {
        if (result.subscription.state === 'active') {
          setMessage('Esta assinatura já está ativa para sua conta.');
          setCheckoutBusy(false);
          return;
        }
        throw new Error('O Mercado Pago não retornou uma página de contratação.');
      }
      window.location.assign(result.checkoutUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível iniciar esta assinatura.'
      );
      setCheckoutBusy(false);
    }
  };

  return (
    <section
      className="rounded-3xl border border-violet-500/20 bg-slate-950/75 p-4 shadow-xl sm:p-5"
      aria-label={`Assinaturas de ${storeName}`}
      data-kyrub-storefront-subscriptions="merchant-recurring"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
          <Repeat2 className="h-5 w-5" />
        </div>
        <div>
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">
            Assinaturas
          </span>
          <h3 className="mt-1 text-sm font-black text-white">Planos e ofertas recorrentes</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            A cobrança recorrente é feita pela conta de pagamento desta loja. Assinaturas não entram no carrinho de compra única.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subscriptions.map(product => {
          const terms = product.saleModality?.mode === 'subscription'
            ? product.saleModality.subscription
            : null;
          if (!terms) return null;
          return (
            <article
              key={product.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75"
              data-kyrub-subscription-offer={product.id}
            >
              {product.image && (
                <img
                  src={product.image}
                  alt={product.name}
                  className="aspect-[16/9] w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="flex flex-1 flex-col p-3">
                <strong className="text-xs font-black text-white">{product.name}</strong>
                <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                  {product.description || 'Oferta recorrente desta loja.'}
                </p>
                <div className="mt-3 space-y-1 text-[8px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3 text-violet-300" />
                    Renovação a cada {intervalUnitLabel(terms.billingInterval.unit, terms.billingInterval.count)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-300" />
                    {benefitLabel(product)}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-800 pt-3">
                  <div>
                    <span className="block font-mono text-[7px] uppercase text-slate-600">Valor recorrente</span>
                    <strong className="font-mono text-sm text-white">{money.format(product.price)}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(product);
                      setError('');
                      setMessage('');
                    }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-[9px] font-black uppercase text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    Assinar <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {selected && selected.saleModality?.mode === 'subscription' && (
        <div
          className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-md sm:items-center sm:p-4"
          role="presentation"
          onClick={close}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="storefront-subscription-checkout-title"
            onClick={event => event.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">Assinatura recorrente</span>
                <h3 id="storefront-subscription-checkout-title" className="mt-1 text-lg font-black text-white">{selected.name}</h3>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={checkoutBusy || authBusy}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar contratação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <strong className="text-xl font-black text-white">{money.format(selected.price)}</strong>
              <span className="ml-1 text-[10px] text-slate-500">/ a cada {intervalUnitLabel(selected.saleModality.subscription.billingInterval.unit, selected.saleModality.subscription.billingInterval.count)}</span>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{benefitLabel(selected)}</p>
            </div>

            <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
              O valor e a periodicidade mostrados aqui são informativos. Antes de criar a cobrança, o servidor relê o produto canônico e a conta Mercado Pago da própria loja.
            </p>

            {error && (
              <div role="alert" className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">{error}</div>
            )}
            {message && (
              <div role="status" className="mt-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-200">{message}</div>
            )}

            {!user ? (
              <button
                type="button"
                onClick={() => void login()}
                disabled={authBusy}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {authBusy ? 'Entrando…' : 'Continuar com Google'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startCheckout()}
                disabled={checkoutBusy}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 text-sm font-black text-white disabled:opacity-60"
                data-kyrub-merchant-subscription-checkout="server-authoritative"
              >
                {checkoutBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {checkoutBusy ? 'Preparando Mercado Pago…' : 'Continuar para Mercado Pago'}
              </button>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
