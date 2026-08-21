import type { User } from 'firebase/auth';
import type { CartItem } from '../types';
import { saveLastCustomerOrderId } from './customerOrders';
import { dispatchMarketplacePixReady } from './marketplacePaymentEvents';

export interface MarketplaceCheckoutIntentResult {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: 'pix';
  expiresAt: string;
  providerReady: boolean;
  provider: string;
  providerPaymentId: string;
  pixQrCode: string;
  pixQrCodeBase64: string;
  pixTicketUrl: string;
  duplicate: boolean;
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
  idempotencyKey?: string;
}

const createIdempotencyKey = (userId: string, storeId: string): string => {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `checkout:${userId}:${storeId}:${randomId}`;
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
      items: input.cart.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        note: input.itemNotes[item.product.id]?.trim() ?? '',
      })),
      method: 'pix',
      idempotencyKey:
        input.idempotencyKey?.trim() ||
        createIdempotencyKey(user.uid, storeId),
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
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
  if (checkout.providerReady) {
    dispatchMarketplacePixReady(checkout);
  }

  return checkout;
};
