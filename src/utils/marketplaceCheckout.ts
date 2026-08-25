import type { User } from 'firebase/auth';
import type { CartItem } from '../types';
import {
  saveLastCustomerOrderId,
  subscribeToCustomerOrder,
} from './customerOrders';

export interface MarketplaceCheckoutIntentResult {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  subtotal: number;
  discountTotal: number;
  couponCode: string;
  amount: number;
  currency: 'BRL';
  method: 'pix';
  expiresAt: string;
  providerReady: boolean;
  provider?: string;
  providerPaymentId?: string;
  pixQrCode?: string;
  pixQrCodeBase64?: string;
  pixTicketUrl?: string;
  duplicate: boolean;
}

export interface MarketplaceCouponQuote {
  promotionId: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  eligibleProductIds: string[];
  eligibleSubtotal: number;
  subtotal: number;
  discountTotal: number;
  total: number;
}

export interface PublicMarketplacePromotion {
  id: string;
  code: string;
  title: string;
  badge: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
}

export interface InitiateMarketplaceCheckoutInput {
  storeId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: 'delivery' | 'pickup';
  deliveryAddress: string;
  customerNote: string;
  cart: CartItem[];
  itemNotes: Record<string, string>;
  couponCode?: string;
  idempotencyKey?: string;
}

interface PendingMarketplacePixSession {
  fingerprint: string;
  checkout: MarketplaceCheckoutIntentResult;
}

let activePixOverlayCleanup: (() => void) | null = null;

const createIdempotencyKey = (userId: string, storeId: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `checkout:${userId}:${storeId}:${randomId}`;
};

const pendingPixStorageKey = (userId: string, storeId: string): string =>
  `kyrub_pending_pix_${userId}_${storeId}`;

const cartRequestItems = (
  cart: CartItem[],
  itemNotes: Record<string, string> = {}
) => cart.map(item => ({
  productId: item.product.id,
  quantity: item.quantity,
  note: itemNotes[item.product.id]?.trim() ?? '',
}));

const checkoutFingerprint = (
  storeId: string,
  input: InitiateMarketplaceCheckoutInput
): string => JSON.stringify({
  storeId,
  buyerName: input.buyerName.trim(),
  buyerEmail: input.buyerEmail.trim().toLowerCase(),
  fulfillmentType: input.fulfillmentType,
  deliveryAddress:
    input.fulfillmentType === 'delivery' ? input.deliveryAddress.trim() : '',
  customerNote: input.customerNote.trim(),
  couponCode: input.couponCode?.trim().toUpperCase() ?? '',
  items: cartRequestItems(input.cart, input.itemNotes),
});

const hasUsablePixInstructions = (
  checkout: MarketplaceCheckoutIntentResult
): boolean => Boolean(
  checkout.providerReady &&
  (checkout.pixQrCode?.trim() || checkout.pixQrCodeBase64?.trim() || checkout.pixTicketUrl?.trim())
);

const readPendingPixSession = (
  userId: string,
  storeId: string,
  fingerprint: string
): MarketplaceCheckoutIntentResult | null => {
  if (typeof window === 'undefined') return null;
  const key = pendingPixStorageKey(userId, storeId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMarketplacePixSession;
    const expiresAt = new Date(parsed.checkout?.expiresAt ?? '').getTime();
    if (
      parsed.fingerprint !== fingerprint ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      !hasUsablePixInstructions(parsed.checkout)
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.checkout;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
};

const persistPendingPixSession = (
  userId: string,
  storeId: string,
  fingerprint: string,
  checkout: MarketplaceCheckoutIntentResult
): void => {
  if (typeof window === 'undefined' || !hasUsablePixInstructions(checkout)) return;
  sessionStorage.setItem(
    pendingPixStorageKey(userId, storeId),
    JSON.stringify({ fingerprint, checkout } satisfies PendingMarketplacePixSession)
  );
};

const clearPendingPixSession = (userId: string, storeId: string): void => {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(pendingPixStorageKey(userId, storeId));
};

const safeExternalUrl = (value: string | undefined): string => {
  const candidate = value?.trim() ?? '';
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
};

const pixImageSource = (value: string | undefined): string => {
  const candidate = value?.trim() ?? '';
  if (!candidate) return '';
  if (candidate.startsWith('data:image/png;base64,')) return candidate;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(candidate)) return '';
  return `data:image/png;base64,${candidate}`;
};

const presentMarketplacePixCheckout = (
  userId: string,
  storeId: string,
  checkout: MarketplaceCheckoutIntentResult
): void => {
  if (typeof document === 'undefined') return;

  activePixOverlayCleanup?.();
  document.getElementById('kyrub-marketplace-pix-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kyrub-marketplace-pix-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'kyrub-marketplace-pix-title');
  overlay.className =
    'fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm';

  const card = document.createElement('section');
  card.className =
    'my-auto w-full max-w-md rounded-3xl border border-cyan-500/30 bg-slate-900 p-5 shadow-2xl';

  const title = document.createElement('h2');
  title.id = 'kyrub-marketplace-pix-title';
  title.className = 'text-lg font-black text-white';
  title.textContent = 'Pagamento Pix pendente';
  card.appendChild(title);

  if (checkout.discountTotal > 0 && checkout.couponCode) {
    const discount = document.createElement('p');
    discount.className =
      'mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200';
    discount.textContent = `Cupom ${checkout.couponCode}: -${new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(checkout.discountTotal)}`;
    card.appendChild(discount);
  }

  const amount = document.createElement('p');
  amount.className = 'mt-2 text-sm font-black text-cyan-300';
  amount.textContent = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(checkout.amount);
  card.appendChild(amount);

  const authority = document.createElement('p');
  authority.className = 'mt-2 text-xs leading-relaxed text-slate-400';
  authority.textContent =
    'O pedido continua pendente. Somente a confirmação assinada do Mercado Pago libera o pedido para a loja.';
  card.appendChild(authority);

  const qrImage = pixImageSource(checkout.pixQrCodeBase64);
  if (qrImage) {
    const image = document.createElement('img');
    image.src = qrImage;
    image.alt = 'QR Code Pix';
    image.className = 'mx-auto mt-5 h-56 w-56 rounded-2xl bg-white p-3 object-contain';
    card.appendChild(image);
  }

  const pixCode = checkout.pixQrCode?.trim() ?? '';
  if (pixCode) {
    const codeLabel = document.createElement('label');
    codeLabel.className = 'mt-5 block text-[10px] font-black uppercase tracking-wide text-slate-400';
    codeLabel.textContent = 'Pix copia e cola';

    const code = document.createElement('textarea');
    code.readOnly = true;
    code.value = pixCode;
    code.rows = 4;
    code.className =
      'mt-2 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-[10px] text-slate-300';
    codeLabel.appendChild(code);
    card.appendChild(codeLabel);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className =
      'mt-2 w-full rounded-xl bg-cyan-500 px-4 py-3 text-xs font-black uppercase text-slate-950';
    copy.textContent = 'Copiar código Pix';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pixCode);
        copy.textContent = 'Código Pix copiado';
      } catch {
        code.focus();
        code.select();
        copy.textContent = 'Selecione e copie o código acima';
      }
    });
    card.appendChild(copy);
  }

  const ticketUrl = safeExternalUrl(checkout.pixTicketUrl);
  if (ticketUrl) {
    const fallback = document.createElement('a');
    fallback.href = ticketUrl;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.className =
      'mt-3 block w-full rounded-xl border border-slate-700 px-4 py-3 text-center text-[10px] font-black uppercase text-slate-300';
    fallback.textContent = 'Abrir Pix no Mercado Pago';
    card.appendChild(fallback);
  }

  const status = document.createElement('p');
  status.className =
    'mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs font-bold text-amber-200';
  status.textContent = 'Aguardando confirmação do pagamento…';
  card.appendChild(status);

  const expires = document.createElement('p');
  expires.className = 'mt-2 text-center text-[10px] text-slate-500';
  const expiration = new Date(checkout.expiresAt);
  expires.textContent = Number.isNaN(expiration.getTime())
    ? 'Validade do Pix informada pelo provedor.'
    : `Pix válido até ${expiration.toLocaleString('pt-BR')}.`;
  card.appendChild(expires);

  const close = document.createElement('button');
  close.type = 'button';
  close.className =
    'mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-[10px] font-black uppercase text-slate-300';
  close.textContent = 'Fechar e continuar no Kyrub';
  card.appendChild(close);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const unsubscribe = subscribeToCustomerOrder(
    storeId,
    checkout.orderId,
    order => {
      if (!order) return;
      clearPendingPixSession(userId, storeId);
      status.className =
        'mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-200';
      status.textContent =
        'Pagamento confirmado pelo backend. Pedido liberado para a loja.';
      close.textContent = 'Fechar e acompanhar pedido';
    },
    () => undefined
  );

  let removed = false;
  const removeOverlay = (): void => {
    if (removed) return;
    removed = true;
    unsubscribe();
    overlay.remove();
    if (activePixOverlayCleanup === removeOverlay) {
      activePixOverlayCleanup = null;
    }
  };
  activePixOverlayCleanup = removeOverlay;

  close.addEventListener('click', removeOverlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) removeOverlay();
  });
};

const responsePayload = async (response: Response): Promise<Record<string, unknown>> =>
  response.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export const listMarketplacePromotions = async (
  storeId: string
): Promise<PublicMarketplacePromotion[]> => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) return [];
  const response = await fetch(
    `/api/payments/promotions?storeId=${encodeURIComponent(normalizedStoreId)}`
  );
  const payload = await responsePayload(response);
  if (!response.ok) return [];
  return Array.isArray(payload.promotions)
    ? payload.promotions as unknown as PublicMarketplacePromotion[]
    : [];
};

export const quoteMarketplaceCoupon = async (
  user: Pick<User, 'getIdToken'>,
  input: {
    storeId: string;
    couponCode: string;
    cart: CartItem[];
  }
): Promise<MarketplaceCouponQuote> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/payments/coupons/quote', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      storeId: input.storeId.trim(),
      couponCode: input.couponCode.trim(),
      items: cartRequestItems(input.cart),
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'Não foi possível validar o cupom.'
    );
  }
  return payload as unknown as MarketplaceCouponQuote;
};

export const initiateMarketplaceCheckout = async (
  user: Pick<User, 'uid' | 'getIdToken'>,
  input: InitiateMarketplaceCheckoutInput
): Promise<MarketplaceCheckoutIntentResult> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('A loja não foi identificada.');
  if (!input.buyerName.trim()) throw new Error('Informe seu nome.');
  if (!input.buyerEmail.trim()) throw new Error('Informe seu e-mail.');
  if (input.cart.length === 0) throw new Error('Seu carrinho está vazio.');
  if (input.fulfillmentType === 'delivery' && !input.deliveryAddress.trim()) {
    throw new Error('Informe o endereço de entrega.');
  }

  const fingerprint = checkoutFingerprint(storeId, input);
  const pendingCheckout = readPendingPixSession(user.uid, storeId, fingerprint);
  if (pendingCheckout) {
    presentMarketplacePixCheckout(user.uid, storeId, pendingCheckout);
    return pendingCheckout;
  }

  const token = await user.getIdToken();
  const response = await fetch('/api/payments/intents', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      storeId,
      buyerName: input.buyerName.trim(),
      buyerEmail: input.buyerEmail.trim(),
      fulfillmentType: input.fulfillmentType,
      deliveryAddress:
        input.fulfillmentType === 'delivery' ? input.deliveryAddress.trim() : '',
      customerNote: input.customerNote.trim(),
      couponCode: input.couponCode?.trim() ?? '',
      items: cartRequestItems(input.cart, input.itemNotes),
      method: 'pix',
      idempotencyKey:
        input.idempotencyKey?.trim() || createIdempotencyKey(user.uid, storeId),
    }),
  });

  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível iniciar o pagamento.'
    );
  }

  const checkout = payload as unknown as MarketplaceCheckoutIntentResult;
  if (typeof window !== 'undefined' && checkout.orderId) {
    saveLastCustomerOrderId(localStorage, user.uid, storeId, checkout.orderId);
  }

  if (hasUsablePixInstructions(checkout)) {
    persistPendingPixSession(user.uid, storeId, fingerprint, checkout);
    presentMarketplacePixCheckout(user.uid, storeId, checkout);
  }

  return checkout;
};