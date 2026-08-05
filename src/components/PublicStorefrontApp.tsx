import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Flame,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Store as StoreIcon,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import type { CartItem, Product, Store } from '../types';
import {
  subscribeToStoreCustomerOrders,
  type CustomerOrderStatus,
} from '../utils/customerOrders';
import { auth } from '../utils/firebase';
import { subscribeToPublishedStorefrontBySlug } from '../utils/publicStorefront';
import { OPEN_PUBLIC_STOREFRONT_INFO_EVENT } from '../utils/storefrontEvents';
import { StorefrontPanel } from './StorefrontPanel';
import { B2CCartDrawer } from './modals/B2CCartDrawer';

interface PublicStorefrontAppProps {
  slug: string;
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const KDS_ACTIVE_STATUSES = new Set<CustomerOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
]);

const resolveMovementMetadata = (
  store: Store,
  activeKdsOrderCount: number
): { label: string; colorClassName: string } => {
  if (store.status === 'closed') {
    return {
      label: 'Loja fechada',
      colorClassName: 'text-slate-400',
    };
  }

  if (activeKdsOrderCount > 20) {
    return {
      label: `Movimento muito alto: ${activeKdsOrderCount} pedidos ativos`,
      colorClassName: 'text-orange-500',
    };
  }

  if (activeKdsOrderCount > 10) {
    return {
      label: `Movimento alto: ${activeKdsOrderCount} pedidos ativos`,
      colorClassName: 'text-amber-400',
    };
  }

  return {
    label: `Loja aberta: ${activeKdsOrderCount} pedidos ativos`,
    colorClassName: 'text-emerald-400',
  };
};

export function PublicStorefrontApp({ slug }: PublicStorefrontAppProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [loadCompleted, setLoadCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [activeKdsOrderCount, setActiveKdsOrderCount] = useState(0);

  useEffect(
    () =>
      onAuthStateChanged(auth, currentUser => {
        setUser(currentUser);
        setAuthLoading(false);
        if (currentUser) {
          setBuyerName(currentUser.displayName ?? '');
          setBuyerEmail(currentUser.email ?? '');
        }
      }),
    []
  );

  useEffect(() => {
    setStore(null);
    setLoadCompleted(false);
    setErrorMessage('');

    if (!user) return;

    setStoreLoading(true);
    return subscribeToPublishedStorefrontBySlug(
      slug,
      publishedStore => {
        setStore(publishedStore);
        setLoadCompleted(true);
        setStoreLoading(false);
      },
      error => {
        console.warn('Não foi possível localizar a vitrine pelo slug.', error);
        setErrorMessage(
          'A consulta da vitrine está temporariamente indisponível.'
        );
        setLoadCompleted(true);
        setStoreLoading(false);
      }
    );
  }, [slug, user?.uid]);

  useEffect(() => {
    setActiveKdsOrderCount(0);
    if (!store?.id) return;

    return subscribeToStoreCustomerOrders(
      store.id,
      orders =>
        setActiveKdsOrderCount(
          orders.filter(order => KDS_ACTIVE_STATUSES.has(order.status)).length
        ),
      error => {
        console.warn(
          'Não foi possível carregar o movimento atual da vitrine.',
          error
        );
        setActiveKdsOrderCount(0);
      }
    );
  }, [store?.id]);

  const handleGoogleLogin = async (): Promise<void> => {
    setErrorMessage('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Public storefront Google login failed.', error);
      setErrorMessage('Não foi possível concluir o login com Google.');
    }
  };

  const handleAddToCart = (product: Product): void => {
    setCart(current => {
      const existing = current.find(item => item.product.id === product.id);
      if (existing) {
        return current.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: string, quantity: number): void => {
    setCart(current =>
      quantity <= 0
        ? current.filter(item => item.product.id !== productId)
        : current.map(item =>
            item.product.id === productId ? { ...item, quantity } : item
          )
    );
  };

  const openStoreInfo = (): void => {
    window.dispatchEvent(new Event(OPEN_PUBLIC_STOREFRONT_INFO_EVENT));
  };

  const closeStorefront = (): void => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign('/');
  };

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <LoaderCircle className="h-7 w-7 animate-spin text-orange-400" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-white">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500 text-slate-950">
            <StoreIcon className="h-6 w-6" />
          </div>
          <span className="mt-6 block font-mono text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">
            Vitrine pública Kyrub
          </span>
          <h1 className="mt-2 text-3xl font-black tracking-tight">@{slug}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Entre com sua conta Google para consultar esta vitrine, montar o
            pedido e acompanhar a conta com segurança.
          </p>

          <button
            type="button"
            onClick={() => void handleGoogleLogin()}
            className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-slate-950 hover:bg-slate-100"
            id="public-storefront-google-login"
          >
            <LogIn className="h-5 w-5" />
            Entrar e abrir a vitrine
          </button>

          {errorMessage && (
            <p className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {errorMessage}
            </p>
          )}

          <div className="mt-5 flex items-start gap-2 text-[10px] leading-5 text-slate-500">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
            <span>
              O endereço é público; pedidos, histórico e conta permanecem
              vinculados ao usuário autenticado.
            </span>
          </div>

          <a
            href="/"
            className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao Kyrub
          </a>
        </section>
      </main>
    );
  }

  if (storeLoading || !loadCompleted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-300">
        <LoaderCircle className="h-7 w-7 animate-spin text-orange-400" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Abrindo @{slug}
        </span>
      </main>
    );
  }

  if (!store) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-white">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 text-center shadow-2xl">
          <StoreIcon className="mx-auto h-10 w-10 text-slate-600" />
          <h1 className="mt-4 text-xl font-black">Vitrine indisponível</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {errorMessage ||
              `A vitrine @${slug} não existe ou ainda não está publicada.`}
          </p>
          <a
            href="/"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-4 text-xs font-black text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao Kyrub
          </a>
        </section>
      </main>
    );
  }

  const movementMetadata = resolveMovementMetadata(
    store,
    activeKdsOrderCount
  );

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      id="public-storefront-shell"
    >
      <style>{`
        #public-storefront-shell #storefront-banner > div > div:last-child > div:first-child {
          display: none;
        }
        #public-storefront-shell #storefront-banner > div > div:last-child {
          padding: 1rem;
        }
        #public-storefront-shell #storefront-banner > div > div:last-child > div[aria-label] {
          margin-top: 0;
          justify-content: center;
        }
        #public-storefront-shell #storefront-pdv-products-grid article h4 + p.font-mono {
          display: none;
        }
      `}</style>

      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-stretch gap-3">
            <button
              type="button"
              onClick={openStoreInfo}
              className="relative shrink-0 self-start rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-orange-400"
              aria-label={`Abrir informações públicas de ${store.name}`}
              id="public-storefront-header-info-trigger"
            >
              {store.logo ? (
                <img
                  src={store.logo}
                  alt={`Logo de ${store.name}`}
                  className="h-20 w-20 rounded-2xl border border-white/10 bg-slate-900 object-cover sm:h-24 sm:w-24"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-500 text-slate-950 sm:h-24 sm:w-24">
                  <StoreIcon className="h-7 w-7" />
                </span>
              )}
              <span
                id="public-storefront-header-info-badge"
                className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-slate-950 bg-white text-[11px] font-black leading-none text-slate-950 shadow-lg"
                aria-hidden="true"
              >
                i
              </span>
            </button>

            <div className="flex min-h-20 min-w-0 flex-1 flex-col sm:min-h-24">
              <span className="block truncate font-mono text-[8px] font-black uppercase tracking-widest text-orange-400 sm:text-[9px]">
                kyrub.com/@{store.slug}
              </span>

              <div className="mt-1 flex min-w-0 items-center gap-2">
                <strong className="line-clamp-1 min-w-0 text-lg font-black leading-tight text-white sm:text-xl">
                  {store.name || 'Loja sem nome'}
                </strong>
                <span
                  className={`flex shrink-0 items-center ${movementMetadata.colorClassName}`}
                  title={movementMetadata.label}
                >
                  <Flame
                    className="h-5 w-5 fill-current"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{movementMetadata.label}</span>
                </span>
              </div>

              <p className="mt-auto line-clamp-3 pt-1 text-[10px] leading-4 text-slate-400 sm:text-xs sm:leading-5">
                {store.description ||
                  'Esta loja ainda não adicionou uma descrição pública.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeStorefront}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:border-orange-500/40 hover:text-white"
            aria-label="Voltar"
            id="public-storefront-close"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl p-3 pb-10 sm:p-5">
        <StorefrontPanel
          activeConsumerStore={store}
          products={[]}
          cart={cart}
          setIsCartOpen={setIsCartOpen}
          handleAddToCart={handleAddToCart}
          stores={[store]}
          setActiveConsumerStore={() => undefined}
        />
      </main>

      <B2CCartDrawer
        isOpen={isCartOpen}
        visitingStore={store}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        updateCartQty={updateCartQty}
        checkoutCart={event => event.preventDefault()}
        buyerName={buyerName}
        setBuyerName={setBuyerName}
        buyerEmail={buyerEmail}
        setBuyerEmail={setBuyerEmail}
        buyerAddress={buyerAddress}
        setBuyerAddress={setBuyerAddress}
      />
    </div>
  );
}
