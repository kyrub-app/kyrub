import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Sparkles,
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
import {
  loadStorefrontCart,
  reconcilePublishedStorefrontCart,
  saveStorefrontCart,
  saveStorefrontOriginContext,
} from '../utils/storefrontOriginContext';
import { StorefrontPanel as LegacyStorefrontPanel } from './LegacyStorefrontPanel';
import { StorefrontPanel } from './StorefrontPanel';
import { PublicStorefrontHero } from './PublicStorefrontHero';
import { PublicStorefrontQuickPanel, type StorefrontQuickSection } from './PublicStorefrontQuickPanel';
import { StoreCustomerChatBridge } from './store/StoreCustomerChatBridge';
import { openStoreCustomerChat } from '../utils/storeCustomerChatEvents';
import { B2CCartDrawer } from './modals/B2CCartDrawer';
import { MomentsModal } from './modals/MomentsModal';
import { publishStoreReview } from '../utils/storeReviews';
import { BuyerDeliveryTrackingBridge } from './store/BuyerDeliveryTrackingBridge';
import { BuyerCreditInterestCard } from './store/BuyerCreditInterestCard';
import { InitialPrepaidSubscriptionCheckout } from './InitialPrepaidSubscriptionCheckout';
import { listMarketplacePromotions, type PublicMarketplacePromotion } from '../utils/marketplaceCheckout';
import { OFFICIAL_PLAN_BUSINESS_PRODUCT_ID, OFFICIAL_STORE_CANONICAL_ID, isOfficialPlanProductId } from '../../shared/officialPlanCanonicalDisplay';

interface PublicStorefrontAppProps {
  slug: string;
}

type PublicStorefrontResponse = {
  officialPlanStoreId?: string;
  store: {
    id: string;
    name: string;
    slug: string;
    description: string;
    logo: string;
    banner: string;
    primaryColor: string;
    reservationsEnabled: boolean;
    address: string;
    keywords: string[];
    status: 'open' | 'delayed' | 'closed';
  };
  offers: Product[];
};

// Reuse the shared canonical identity; the server verifies it again before payment.

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const KDS_ACTIVE_STATUSES = new Set<CustomerOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
]);

const responseStoreToStore = (
  value: PublicStorefrontResponse['store']
): Store => ({
  ...value,
  plan: 'free',
  ownerEmail: '',
  contact: '',
  offerImages: [],
  isNew: false,
});

const resolveMovementMetadata = (
  store: Store,
  activeKdsOrderCount: number,
  authenticated: boolean,
  isOfficialPlansVitrine = false
): { label: string; colorClassName: string } => {
  if (isOfficialPlansVitrine) return { label: 'Vitrine oficial de planos', colorClassName: 'text-cyan-400' };
  if (store.status === 'closed') {
    return {
      label: 'Loja fechada',
      colorClassName: 'text-slate-400',
    };
  }

  if (!authenticated) {
    return {
      label: 'Loja publicada no Kyrub',
      colorClassName: 'text-emerald-400',
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
  const sharedCouponCode = typeof window === 'undefined' ? ''
    : (new URLSearchParams(window.location.search).get('coupon') ?? '').trim().toUpperCase().slice(0, 48);
  const [couponPromotion, setCouponPromotion] = useState<PublicMarketplacePromotion | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [selectedOfficialPlanId, setSelectedOfficialPlanId] = useState('');
  useEffect(() => {
    if (!selectedOfficialPlanId) return;
    const section = document.getElementById('official-plan-contract-section');
    if (typeof section?.scrollIntoView === 'function') {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedOfficialPlanId]);
  const [selectedPlanMonths, setSelectedPlanMonths] = useState<1 | 3 | 6 | 12>(1);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(true);
  const [store, setStore] = useState<Store | null>(null);
  const [officialPlanStoreId, setOfficialPlanStoreId] = useState('');
  const [publicProducts, setPublicProducts] = useState<Product[]>([]);
  const [loadCompleted, setLoadCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [cart, setCart] = useState<CartItem[]>(() => loadStorefrontCart(slug));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [storeReviewsOpen, setStoreReviewsOpen] = useState(false);
  const [selectedQuickSection, setSelectedQuickSection] = useState<StorefrontQuickSection | null>(null);
  const [shareFeedback, setShareFeedback] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [activeKdsOrderCount, setActiveKdsOrderCount] = useState(0);
  const [loginPending, setLoginPending] = useState(false);

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
    let cancelled = false;
    const controller = new AbortController();

    setStore(null);
    setSelectedQuickSection(null);
    setShareFeedback('');
    setOfficialPlanStoreId('');
    setPublicProducts([]);
    setLoadCompleted(false);
    setStoreLoading(true);
    setErrorMessage('');

    void fetch(
      `/api/marketplace-discovery/public/${encodeURIComponent(slug)}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }
    )
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as Partial<PublicStorefrontResponse> & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || 'Não foi possível abrir esta vitrine.');
        }
        if (!payload.store || !Array.isArray(payload.offers)) {
          throw new Error('A vitrine publicada retornou dados incompletos.');
        }
        if (cancelled) return;
        setStore(responseStoreToStore(payload.store));
        setOfficialPlanStoreId(payload.officialPlanStoreId === OFFICIAL_STORE_CANONICAL_ID
          ? OFFICIAL_STORE_CANONICAL_ID : '');
        setPublicProducts(payload.offers);
        // Resume only still-published offers, with current server-owned
        // commercial terms. Withdrawn products cannot linger in a saved cart.
        setCart(previous => reconcilePublishedStorefrontCart(previous, payload.offers));
      })
      .catch(error => {
        if (cancelled || controller.signal.aborted) return;
        console.warn('Não foi possível localizar a vitrine pública.', error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'A consulta da vitrine está temporariamente indisponível.'
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoadCompleted(true);
        setStoreLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    if (!store?.id || (officialPlanStoreId !== OFFICIAL_STORE_CANONICAL_ID &&
        store.id !== OFFICIAL_STORE_CANONICAL_ID) || !sharedCouponCode) {
      setCouponPromotion(null);
      setCouponLoading(false);
      return;
    }
    // Public discovery is only a UI hint; the official billing API validates
    // the ERP coupon and the exact product/price again on the server.
    setCouponPromotion(null);
    setCouponLoading(true);
    void listMarketplacePromotions(OFFICIAL_STORE_CANONICAL_ID).then(promotions => {
      if (!cancelled) setCouponPromotion(promotions.find(promotion => promotion.code === sharedCouponCode) ?? null);
    }).catch(() => {
      if (!cancelled) setCouponPromotion(null);
    }).finally(() => {
      if (!cancelled) setCouponLoading(false);
    });
    return () => { cancelled = true; };
  }, [store?.id, officialPlanStoreId, sharedCouponCode]);

  useEffect(() => {
    if (officialPlanStoreId !== OFFICIAL_STORE_CANONICAL_ID &&
        store?.id !== OFFICIAL_STORE_CANONICAL_ID) return;
    // Previously saved retail carts must not carry official plan contracts
    // into the generic marketplace checkout after this routing change.
    setCart(previous => {
      const retailOnly = previous.filter(item => !isOfficialPlanProductId(item.product.id));
      return retailOnly.length === previous.length ? previous : retailOnly;
    });
  }, [store?.id, officialPlanStoreId]);

  useEffect(() => {
    saveStorefrontCart(slug, cart);
  }, [cart, slug]);

  useEffect(() => {
    setActiveKdsOrderCount(0);
    if (!user || !store?.id) return;

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
  }, [store?.id, user?.uid]);

  const handleGoogleLogin = async (): Promise<void> => {
    if (loginPending) return;
    setErrorMessage('');
    setLoginPending(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Public storefront Google login failed.', error);
      setErrorMessage('Não foi possível concluir o login com Google.');
    } finally {
      setLoginPending(false);
    }
  };

  const handleAddToCart = (product: Product): void => {
    if ((officialPlanStoreId === OFFICIAL_STORE_CANONICAL_ID ||
      store?.id === OFFICIAL_STORE_CANONICAL_ID) && isOfficialPlanProductId(product.id)) {
      // Official plans are contracts, not ordinary B2C cart items.
      setSelectedOfficialPlanId(product.id);
      return;
    }
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

  const shareStorefront = async (): Promise<void> => {
    if (!store) return;
    const publicUrl = 'https://www.kyrub.com/@' + encodeURIComponent(store.slug);
    setShareFeedback('');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({title:store.name,text:'Conheça esta loja no Kyrub',url:publicUrl});
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError')
          setShareFeedback('Não foi possível compartilhar. Link: ' + publicUrl);
      }
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw Error('COPY_UNAVAILABLE');
      await navigator.clipboard.writeText(publicUrl);
      setShareFeedback('Link da loja copiado!');
    } catch {
      setShareFeedback('Copie o link da loja: ' + publicUrl);
    }
  };
  const openKyrub = (): void => {
    if (!store) return;
    saveStorefrontOriginContext({
      slug: store.slug,
      storeId: store.id,
      storeName: store.name,
    });
    saveStorefrontCart(store.slug, cart);
    window.location.assign('/?app=1');
  };

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
            href="/?app=1"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-500 px-4 text-xs font-black text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Acessar meu Kyrub
          </a>
        </section>
      </main>
    );
  }

  const isOfficialStore = officialPlanStoreId === OFFICIAL_STORE_CANONICAL_ID ||
    store.id === OFFICIAL_STORE_CANONICAL_ID;
  const movementMetadata = resolveMovementMetadata(
    store,
    activeKdsOrderCount,
    Boolean(user),
    isOfficialStore
  );
  const officialPlanProducts = isOfficialStore
    ? publicProducts.filter(product => isOfficialPlanProductId(product.id) && product.saleModality?.mode === 'subscription')
    : [];
  const eligibleCouponPlans = sharedCouponCode && couponPromotion
    ? officialPlanProducts.filter(product => couponPromotion.productIds.includes(product.id))
    : [];
  // Private coupons are omitted from public discovery on purpose.
  // Let the buyer request a canonical Business quote with the URL code:
  // the server proves their eligibility before showing any payable Pix.
  const privateCouponNeedsServerCheck = Boolean(
    isOfficialStore && sharedCouponCode && !couponLoading && !couponPromotion
  );
  const privateBusinessCandidate = privateCouponNeedsServerCheck
    ? officialPlanProducts.filter(product => product.id === OFFICIAL_PLAN_BUSINESS_PRODUCT_ID)
    : [];
  const availablePlanProducts = sharedCouponCode
    ? (couponPromotion ? eligibleCouponPlans : privateBusinessCandidate)
    : officialPlanProducts;
  const selectedOfficialPlan = availablePlanProducts.find(product => product.id === selectedOfficialPlanId) ??
    (sharedCouponCode ? availablePlanProducts[0] ?? null : null);
  const couponForOfficialPlan = isOfficialStore &&
    (eligibleCouponPlans.length > 0 || privateBusinessCandidate.length > 0);
  const couponForRetail = Boolean(sharedCouponCode) &&
    (!isOfficialStore || (couponPromotion !== null && !couponForOfficialPlan));

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      id="public-storefront-shell"
      data-auth-state={authLoading ? 'loading' : user ? 'authenticated' : 'guest'}
    >
      <style>{`
        #public-storefront-shell #storefront-pdv-products-grid article h4 + p.font-mono {
          display: none;
        }
      `}</style>

      <header className="mx-auto w-full max-w-5xl px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        <button
          type="button"
          onClick={openKyrub}
          id="public-storefront-open-kyrub"
          className="mb-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-orange-500/25 bg-orange-500/[0.08] px-4 text-left text-orange-300 transition hover:border-orange-400/50 hover:bg-orange-500/[0.13]"
          aria-label="Acessar meu Kyrub e explorar oportunidades"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <strong className="block text-xs font-black uppercase tracking-[0.12em]">
                Acessar meu Kyrub
              </strong>
              <span className="block truncate text-[9px] text-orange-200/70">
                Entregas, freelas, sua loja e outras oportunidades
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      </header>

      <div className="mx-auto w-full max-w-5xl px-3 sm:px-5">
        <PublicStorefrontHero
          store={store}
          selectedSection={selectedQuickSection}
          actionsDisabled={authLoading || loginPending}
          onSelectSection={section => {
            setShareFeedback('');
            setSelectedQuickSection(current => current === section ? null : section);
          }}
          onChat={() => {
            if (!user) { void handleGoogleLogin(); return; }
            openStoreCustomerChat({ perspective: 'customer', storeId: store.id, storeName: store.name });
          }}
          onShare={() => void shareStorefront()}
        />
        <span className="sr-only">{movementMetadata.label}</span>
        <PublicStorefrontQuickPanel
          store={store}
          selected={selectedQuickSection}
          onClose={() => setSelectedQuickSection(null)}
          onChat={() => {
            if (!user) { void handleGoogleLogin(); return; }
            openStoreCustomerChat({ perspective: 'customer', storeId: store.id, storeName: store.name });
          }}
          onReviews={() => { if (user) setStoreReviewsOpen(true); else void handleGoogleLogin(); }}
          actionsDisabled={authLoading || loginPending}
        />
        {shareFeedback && <p role="status" className="mx-1 mt-2 rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-xs text-orange-100">{shareFeedback}</p>}
      </div>
      <StoreCustomerChatBridge />

      {user && <BuyerDeliveryTrackingBridge storeId={store.id} buyerId={user.uid} />}
      {user && <BuyerCreditInterestCard storeId={store.id} buyerId={user.uid} />}

      {isOfficialStore && sharedCouponCode && couponLoading && (
        <p role="status" className="mx-auto mt-3 max-w-5xl rounded-xl border border-slate-700 p-3 text-xs text-slate-300">
          Conferindo o cupom da Praça…
        </p>
      )}
      {isOfficialStore && sharedCouponCode && !couponLoading && !couponPromotion && (
        <p role="alert" className="mx-auto mt-3 max-w-5xl rounded-xl border border-amber-500/30 p-3 text-xs text-amber-200">
          Cupom {sharedCouponCode} não listado publicamente. Se for um cupom exclusivo, a elegibilidade será verificada com a conta autenticada antes de qualquer cobrança. Um código inválido nunca será ignorado para cobrar o valor integral.
        </p>
      )}
      {couponForRetail && (
        <div className="mx-auto mt-3 flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-100">
          <span>Cupom da Praça: <strong className="font-mono">{sharedCouponCode}</strong>. Adicione um produto participante ao carrinho e valide o desconto no checkout.</span>
          {cart.length > 0 && (
            <button type="button" onClick={() => setIsCartOpen(true)} className="rounded-full bg-white px-4 py-2 font-black text-slate-950">
              Ir para o carrinho
            </button>
          )}
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl p-3 pb-10 sm:p-5">
        {isOfficialStore && officialPlanProducts.length > 0 && (selectedOfficialPlan || sharedCouponCode) && (
          <section id="official-plan-contract-section" data-official-plan-route="canonical-prepaid"
            className="mb-5 rounded-3xl border border-cyan-500/30 bg-slate-900 p-4 sm:p-5">
            <span className="font-mono text-[10px] font-black uppercase tracking-widest text-cyan-300">
              Planos da Kyrub Oficial
            </span>
            <h2 className="mt-1 text-lg font-black text-white">Revisar contratação do plano {selectedOfficialPlan?.name ?? 'oficial'}</h2>
            <p className="mt-2 text-xs leading-5 text-slate-300">
              Planos são contratados pelo checkout oficial, com aceite de contrato e Pix único. Não entram no carrinho de produtos e serviços.
            </p>
            {couponForOfficialPlan && (
              <p className="mt-3 text-xs font-semibold text-emerald-300">
                Cupom da Praça {sharedCouponCode} informado. {privateCouponNeedsServerCheck
                  ? 'Por ser privado ou não encontrado na lista pública, o servidor validará o código para Business antes de qualquer cobrança.'
                  : 'O valor e a elegibilidade serão confirmados pelo servidor antes do aceite.'}
              </p>
            )}
            {sharedCouponCode && !couponLoading && !couponForOfficialPlan && (
              <p role="status" className="mt-3 text-xs text-amber-300">
                Esse cupom não corresponde a uma oferta de plano disponível nesta vitrine. Não será ignorado para cobrar o preço integral.
              </p>
            )}
            {availablePlanProducts.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-300">
                  Duração do contrato
                  <select value={selectedPlanMonths} aria-label="Selecionar período de contratação"
                    onChange={event => setSelectedPlanMonths(Number(event.target.value) as 1 | 3 | 6 | 12)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 p-2 text-white">
                    <option value={1}>1 mês</option>
                    <option value={3}>3 meses</option>
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses</option>
                  </select>
                </label>
              </div>
            )}
            {selectedOfficialPlan && (
              user ? (
                <InitialPrepaidSubscriptionCheckout
                  key={JSON.stringify([store.id, selectedOfficialPlan.id, selectedPlanMonths, sharedCouponCode, user.uid])}
                  storeId={OFFICIAL_STORE_CANONICAL_ID}
                  productId={selectedOfficialPlan.id}
                  selectedMonths={selectedPlanMonths}
                  billingAuthority="platform"
                  promotionCode={couponForOfficialPlan ? sharedCouponCode : undefined}
                />
              ) : (
                <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
                  <p className="text-xs text-slate-300">Entre com sua conta Kyrub para consultar e aceitar o contrato oficial.</p>
                  <button type="button" onClick={() => void handleGoogleLogin()} disabled={loginPending}
                    className="mt-3 min-h-11 rounded-xl bg-white px-4 text-xs font-bold text-slate-950 disabled:opacity-60">
                    {loginPending ? 'Entrando…' : 'Continuar com Google'}
                  </button>
                </div>
              )
            )}
          </section>
        )}
        {user ? (
          <StorefrontPanel
            catalogSource="published-api"
            activeConsumerStore={store}
            products={publicProducts}
            cart={cart}
            setIsCartOpen={setIsCartOpen}
            handleAddToCart={handleAddToCart}
            stores={[store]}
            setActiveConsumerStore={() => undefined}
            hideHero
          />
        ) : (
          <>
            <div
              id="public-storefront-guest-notice"
              className="mb-4 flex items-start gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-[10px] leading-5 text-slate-400"
            >
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
              <span>
                Você pode conhecer a loja e montar seu pedido sem login. O Google só será solicitado quando uma ação precisar ficar vinculada à sua conta Kyrub.
              </span>
            </div>
            <LegacyStorefrontPanel
              activeConsumerStore={store}
              products={publicProducts}
              cart={cart}
              setIsCartOpen={setIsCartOpen}
              handleAddToCart={handleAddToCart}
              stores={[store]}
              setActiveConsumerStore={() => undefined}
              hideHero
              activeKdsOrderCount={0}
              salesByProductId={{}}
            />
          </>
        )}
      </main>

      {user ? (
        <B2CCartDrawer
          isOpen={isCartOpen}
          visitingStore={store}
          onClose={() => setIsCartOpen(false)}
          cart={cart}
          updateCartQty={updateCartQty}
          buyerName={buyerName}
          setBuyerName={setBuyerName}
          buyerEmail={buyerEmail}
          setBuyerEmail={setBuyerEmail}
          buyerAddress={buyerAddress}
          setBuyerAddress={setBuyerAddress}
        />
      ) : isCartOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:items-center"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setIsCartOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-checkout-auth-title"
            className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
          >
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
              Seu pedido está preservado
            </span>
            <h2 id="guest-checkout-auth-title" className="mt-2 text-xl font-black text-white">
              Entre para continuar
            </h2>
            <p className="mt-2 text-xs leading-6 text-slate-400">
              O login identifica quem está enviando o pedido. Depois disso, a mesma conta fica válida no Kyrub e nas compras do marketplace.
            </p>
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              disabled={loginPending}
              id="public-storefront-checkout-google-login"
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-slate-950 disabled:opacity-60"
            >
              {loginPending ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : (
                <LogIn className="h-5 w-5" />
              )}
              {loginPending ? 'Entrando…' : 'Continuar com Google'}
            </button>
            <button
              type="button"
              onClick={() => setIsCartOpen(false)}
              className="mt-2 min-h-11 w-full rounded-2xl border border-slate-800 px-4 text-xs font-bold text-slate-400 hover:text-white"
            >
              Continuar explorando a loja
            </button>
            {errorMessage && (
              <p className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {errorMessage}
              </p>
            )}
          </section>
        </div>
      ) : null}

      <MomentsModal
        isOpen={storeReviewsOpen && Boolean(user)}
        selectedStoreForMoments={store}
        onClose={() => setStoreReviewsOpen(false)}
        momentos={[]}
        onPublishMoment={async data => {
          if (!store || !user) throw new Error('Entre no Kyrub e escolha uma loja publicada para avaliar.');
          await publishStoreReview(store, data);
        }}
      />
    </div>
  );
}
