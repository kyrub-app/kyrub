import type { User } from 'firebase/auth';
import { subscribeToCustomerOrder } from './customerOrders';

export interface ApprovedMarketplacePixResult {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'BRL';
  providerReady: boolean;
  provider: string;
  providerPaymentId: string;
  pixQrCode: string;
  pixQrCodeBase64: string;
  pixTicketUrl: string;
  expiresAt: string;
}

let activeApprovedPixCleanup: (() => void) | null = null;

const responsePayload = async (response: Response): Promise<Record<string, unknown>> =>
  response.json().catch(() => ({})) as Promise<Record<string, unknown>>;

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

const presentApprovedMarketplacePix = (
  storeId: string,
  checkout: ApprovedMarketplacePixResult
): void => {
  if (typeof document === 'undefined') return;

  activeApprovedPixCleanup?.();
  document.getElementById('kyrub-approved-marketplace-pix-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kyrub-approved-marketplace-pix-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'kyrub-approved-marketplace-pix-title');
  overlay.className =
    'fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm';

  const card = document.createElement('section');
  card.className =
    'my-auto w-full max-w-md rounded-3xl border border-emerald-500/30 bg-slate-900 p-5 shadow-2xl';

  const badge = document.createElement('p');
  badge.className = 'text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300';
  badge.textContent = 'Pedido aceito pela loja';
  card.appendChild(badge);

  const title = document.createElement('h2');
  title.id = 'kyrub-approved-marketplace-pix-title';
  title.className = 'mt-1 text-lg font-black text-white';
  title.textContent = 'Agora você pode pagar por Pix';
  card.appendChild(title);

  const amount = document.createElement('p');
  amount.className = 'mt-3 text-xl font-black text-cyan-300';
  amount.textContent = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(checkout.amount);
  card.appendChild(amount);

  const authority = document.createElement('p');
  authority.className = 'mt-2 text-xs leading-relaxed text-slate-400';
  authority.textContent =
    'A loja confirmou que consegue atender este pedido. A produção só deve avançar após a confirmação do pagamento.';
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
    const code = document.createElement('textarea');
    code.readOnly = true;
    code.value = pixCode;
    code.rows = 4;
    code.className =
      'mt-5 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-[10px] text-slate-300';
    card.appendChild(code);

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

  const expiration = new Date(checkout.expiresAt);
  const expires = document.createElement('p');
  expires.className = 'mt-2 text-center text-[10px] text-slate-500';
  expires.textContent = Number.isNaN(expiration.getTime())
    ? 'Validade do Pix informada pelo provedor.'
    : `Pix válido até ${expiration.toLocaleString('pt-BR')}.`;
  card.appendChild(expires);

  const close = document.createElement('button');
  close.type = 'button';
  close.className =
    'mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-[10px] font-black uppercase text-slate-300';
  close.textContent = 'Fechar e acompanhar pedido';
  card.appendChild(close);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const unsubscribe = subscribeToCustomerOrder(
    storeId,
    checkout.orderId,
    order => {
      if (!order || order.paymentStatus !== 'paid') return;
      status.className =
        'mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-200';
      status.textContent = 'Pagamento confirmado. A loja já pode seguir com o preparo.';
    },
    () => undefined
  );

  let removed = false;
  const removeOverlay = (): void => {
    if (removed) return;
    removed = true;
    unsubscribe();
    overlay.remove();
    if (activeApprovedPixCleanup === removeOverlay) activeApprovedPixCleanup = null;
  };
  activeApprovedPixCleanup = removeOverlay;
  close.addEventListener('click', removeOverlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) removeOverlay();
  });
};

export const resumeMarketplaceApprovedPayment = async (
  user: Pick<User, 'getIdToken'>,
  input: { storeId: string; orderId: string }
): Promise<ApprovedMarketplacePixResult> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/payments/intents', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      storeId: input.storeId.trim(),
      resumeOrderId: input.orderId.trim(),
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível liberar o Pix deste pedido.'
    );
  }
  const checkout = payload as unknown as ApprovedMarketplacePixResult;
  if (
    !checkout.providerReady ||
    !(checkout.pixQrCode?.trim() || checkout.pixQrCodeBase64?.trim() || checkout.pixTicketUrl?.trim())
  ) {
    throw new Error('O pedido foi aceito, mas o Pix da loja não está disponível agora.');
  }
  presentApprovedMarketplacePix(input.storeId.trim(), checkout);
  return checkout;
};
