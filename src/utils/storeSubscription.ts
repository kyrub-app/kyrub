import { auth } from './firebase';
import type { ContractTermMonths, SubscriptionContractOffer } from '../../shared/subscriptionContractOffers';
import type { SubscriptionContractPaymentTerms } from '../../shared/subscriptionContractPaymentTerms';
import type {
  StoreSubscriptionCheckoutResult,
  StoreSubscriptionSnapshot,
} from '../../shared/storeSubscriptionBilling';

export class StoreSubscriptionRequestError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

const json = async <T>(response: Response): Promise<T> => {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('application/json')) {
    throw new Error('O serviço de assinaturas respondeu em um formato inesperado.');
  }
  const payload = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new StoreSubscriptionRequestError(payload.error || 'Não foi possível atualizar a assinatura.', payload.code);
  }
  return payload;
};

const authorization = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para gerenciar a assinatura.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sua conta mudou. Atualize a tela antes de continuar.');
  return `Bearer ${token}`;
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

export const loadCatalogSubscriptionBillingRoute = (storeId: string, productId: string): Promise<{ kind: 'platform-plan' | 'merchant' | 'free-plan' }> =>
  post('catalog.subscription.route', { storeId, productId });

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
}): Promise<{ proposalId: string; paymentExternalReference: string }> =>
  post('merchant.prepaid-renewal.propose', {
    storeId: input.storeId.trim(),
    previousContractId: input.previousContractId.trim(),
  });

/** Buyer acceptance is authenticated and persisted server-side; no payment is created here. */
export const acceptMerchantPrepaidRenewal = async (input: {
  storeId: string;
  proposalId: string;
  acceptedTotalMinor: number;
}): Promise<{ status: 'accepted' | 'already_accepted' }> =>
  post('merchant.prepaid-renewal.accept', {
    storeId: input.storeId.trim(),
    proposalId: input.proposalId.trim(),
    acceptedTotalMinor: input.acceptedTotalMinor,
  });

/** Provider verification and atomic activation; never trust a UI payment status. */
export const reconcileMerchantPrepaidRenewal = async (input: {
  storeId: string;
  proposalId: string;
  paymentId: string;
}): Promise<{ status: 'created' | 'already_recorded' }> =>
  post('merchant.prepaid-renewal.reconcile', {
    storeId: input.storeId.trim(),
    proposalId: input.proposalId.trim(),
    paymentId: input.paymentId.trim(),
  });

/** Owner-only, read-only contract selector. The API verifies the canonical store owner. */
export const listMerchantPrepaidRenewalContracts = async (input: {
  storeId: string;
}): Promise<{ contracts: Array<{
  id: string;
  productId: string;
  customerId: string;
  months: number;
  expiresAt: string;
}> }> => post('merchant.prepaid-renewal.contracts', {
  storeId: input.storeId.trim(),
});

/** Only proposals belonging to the authenticated buyer are returned. */
export const listMyMerchantPrepaidRenewalProposals = async (input: {
  storeId: string;
}): Promise<{ proposals: Array<{
  id: string;
  status: 'awaiting_acceptance' | 'accepted';
  renewalState?: 'awaiting_acceptance' | 'accepted' | 'awaiting_payment' | 'activated' | 'recovery_required' | 'expired';
  contract?: { contractId: string; startsAt: string; expiresAt: string };
  proposal: {
    storeId: string;
    productId: string;
    previousContractId: string;
    months: 3 | 6 | 12;
    currentMonthlyPriceMinor: number;
    discountPercent: number;
    totalDueMinor: number;
  };
}> }> => post('merchant.prepaid-renewal.my-proposals', {
  storeId: input.storeId.trim(),
});

/** Server-authoritative buyer state. Pix display alone never confirms payment. */
export interface MerchantPrepaidRenewalPaymentState {
  state: 'awaiting_payment' | 'payment_confirmed' | 'activated' | 'recovery_required';
  paymentId?: string;
  binding?: 'bound' | 'already_bound';
  pix?: { qrCode: string; qrCodeBase64?: string; expiresAt: string };
  contract?: { contractId: string; startsAt: string; expiresAt: string };
  code?: string;
}

/** Creates or resumes the single server-reserved Pix attempt after explicit acceptance. */
export const checkoutMerchantPrepaidRenewal = async (input: {
  storeId: string; proposalId: string;
}): Promise<MerchantPrepaidRenewalPaymentState> => post('merchant.prepaid-renewal.checkout', {
  storeId: input.storeId.trim(), proposalId: input.proposalId.trim(),
});

/** Queries/reconciles the existing attempt; never creates another payment. */
export const loadMerchantPrepaidRenewalPaymentStatus = async (input: {
  storeId: string; proposalId: string;
}): Promise<MerchantPrepaidRenewalPaymentState> => post('merchant.prepaid-renewal.payment-status', {
  storeId: input.storeId.trim(), proposalId: input.proposalId.trim(),
});

export interface InitialPrepaidSubscriptionQuote {
  checkoutId: string;
  quote: SubscriptionContractOffer;
  status?: 'quoted' | 'accepted' | 'bound' | 'in_flight' | 'outcome_unknown' | 'activated';
}

export interface InitialPrepaidSubscriptionPaymentState {
  state: 'awaiting_payment' | 'activated' | 'recovery_required' | 'rejected';
  paymentId?: string;
  pix?: { qrCode: string; expiresAt: string };
  subscriptionId?: string;
  contractId?: string;
  startsAt?: string;
  expiresAt?: string;
  code?: string;
  rewards?: { xp: number; points: number; achievementTitle?: string };
}

/** Freeze commercial terms on the server before explicit buyer acceptance. */
export const quoteInitialPrepaidSubscription = async (input: {
  storeId: string; productId: string; selectedMonths: ContractTermMonths; billingAuthority?: 'platform';
}): Promise<InitialPrepaidSubscriptionQuote> => post(input.billingAuthority === 'platform' ? 'official.prepaid.quote' : 'merchant.prepaid-initial.quote', {
  storeId: input.storeId.trim(), productId: input.productId.trim(), selectedMonths: input.selectedMonths,
});

/** Explicit buyer acceptance of the exact server quote; no payment creation. */
export const acceptInitialPrepaidSubscription = async (input: {
  storeId: string; checkoutId: string; acceptedTotalMinor: number; billingAuthority?: 'platform';
}): Promise<{ status: 'accepted' | 'already_accepted' }> => post(input.billingAuthority === 'platform' ? 'official.prepaid.accept' : 'merchant.prepaid-initial.accept', {
  ...(input.billingAuthority === 'platform' ? {} : { storeId: input.storeId.trim() }), checkoutId: input.checkoutId.trim(), acceptedTotalMinor: input.acceptedTotalMinor,
});

/** One full Pix charge; never calls the recurring subscription checkout. */
export const checkoutInitialPrepaidSubscription = async (input: {
  storeId: string; checkoutId: string; billingAuthority?: 'platform';
}): Promise<InitialPrepaidSubscriptionPaymentState> => post(input.billingAuthority === 'platform' ? 'official.prepaid.checkout' : 'merchant.prepaid-initial.checkout', {
  ...(input.billingAuthority === 'platform' ? {} : { storeId: input.storeId.trim() }), checkoutId: input.checkoutId.trim(),
});

/** Reconciliation only: this operation cannot create a new Pix payment. */
export const loadInitialPrepaidSubscriptionStatus = async (input: {
  storeId: string; checkoutId: string; billingAuthority?: 'platform';
}): Promise<InitialPrepaidSubscriptionPaymentState> => post(input.billingAuthority === 'platform' ? 'official.prepaid.payment-status' : 'merchant.prepaid-initial.payment-status', {
  ...(input.billingAuthority === 'platform' ? {} : { storeId: input.storeId.trim() }), checkoutId: input.checkoutId.trim(),
});
