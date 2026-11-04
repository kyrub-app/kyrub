import { auth } from './firebase';
import type { ContractTermMonths, SubscriptionContractOffer } from '../../shared/subscriptionContractOffers';
import type { SubscriptionContractPaymentTerms } from '../../shared/subscriptionContractPaymentTerms';
import type {
  StoreSubscriptionCheckoutResult,
  StoreSubscriptionSnapshot,
} from '../../shared/storeSubscriptionBilling';

const json = async <T>(response: Response): Promise<T> => {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('application/json')) {
    throw new Error('O serviço de assinaturas respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível atualizar a assinatura.');
  }
  return payload;
};

const authorization = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para gerenciar a assinatura.');
  return `Bearer ${await user.getIdToken()}`;
};

const post = async <T>(operation: string, body: Record<string, unknown>): Promise<T> =>
  json(await fetch(`/api/plan-control?op=${encodeURIComponent(operation)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: await authorization(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }));

/** Unified canonical product checkout: the server chooses platform or merchant billing. */
export const createCatalogSubscriptionCheckout = async (input: {
  storeId: string;
  productId: string;
}): Promise<{ checkoutUrl: string }> =>
  post('catalog.subscription.checkout', {
    storeId: input.storeId.trim(),
    productId: input.productId.trim(),
  });

export const createMerchantSubscriptionCheckout = async (input: {
  storeId: string;
  productId: string;
}): Promise<StoreSubscriptionCheckoutResult> =>
  post('merchant.subscription.checkout', {
    storeId: input.storeId.trim(),
    productId: input.productId.trim(),
  });

export const loadMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.state', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });

export const reconcileMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.reconcile', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });

export const cancelMerchantSubscription = async (input: {
  storeId: string;
  subscriptionId: string;
}): Promise<StoreSubscriptionSnapshot> =>
  post('merchant.subscription.cancel', {
    storeId: input.storeId.trim(),
    subscriptionId: input.subscriptionId.trim(),
  });

/** Read-only server-authoritative quote. Does not create a provider checkout. */
export const quoteMerchantSubscriptionContract = async (input: {
  storeId: string;
  productId: string;
  selectedMonths: ContractTermMonths;
  paymentTerms: SubscriptionContractPaymentTerms;
}): Promise<{ quote: SubscriptionContractOffer; paymentTerms: SubscriptionContractPaymentTerms }> =>
  post('merchant.subscription.quote', {
    storeId: input.storeId.trim(),
    productId: input.productId.trim(),
    selectedMonths: input.selectedMonths,
    paymentTerms: input.paymentTerms,
  });


/** Prepaid renewal: owner proposes using the authoritative contract and current catalog. */
export const proposeMerchantPrepaidRenewal = async (input: {
  storeId: string;
  previousContractId: string;
}): Promise<{ proposalId: string; [key: string]: unknown }> =>
  post('merchant.prepaid-renewal.propose', {
    storeId: input.storeId.trim(),
    previousContractId: input.previousContractId.trim(),
  });

/** Buyer acceptance is authenticated and persisted server-side; no payment is created here. */
export const acceptMerchantPrepaidRenewal = async (input: {
  storeId: string;
  proposalId: string;
  acceptedTotalMinor: number;
}): Promise<{ status: string }> =>
  post('merchant.prepaid-renewal.accept', {
    storeId: input.storeId.trim(),
    proposalId: input.proposalId.trim(),
    acceptedTotalMinor: input.acceptedTotalMinor,
  });

/** Read-only provider verification and atomic activation; never trust a UI payment status. */
export const reconcileMerchantPrepaidRenewal = async (input: {
  storeId: string;
  proposalId: string;
  paymentId: string;
}): Promise<{ status: string; [key: string]: unknown }> =>
  post('merchant.prepaid-renewal.reconcile', {
    storeId: input.storeId.trim(),
    proposalId: input.proposalId.trim(),
    paymentId: input.paymentId.trim(),
  });
