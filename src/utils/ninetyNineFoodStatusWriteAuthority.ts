import type { CustomerOrderStatus } from './customerOrders';

export const KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_REQUESTED_EVENT =
  'kyrub:99food-status-write-authority-requested';
export const KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_CHANGED_EVENT =
  'kyrub:99food-status-write-authority-changed';
export const KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT =
  'kyrub:99food-status-write-result';

export type NinetyNineFoodStatusWriteChoice =
  | 'cancel'
  | 'kyrub_only'
  | 'kyrub_and_99food';

export interface NinetyNineFoodStatusWriteAuthorityRequest {
  storeId: string;
  orderId: string;
  status: CustomerOrderStatus;
}

export interface NinetyNineFoodStatusWriteResult {
  storeId: string;
  orderId: string;
  status: CustomerOrderStatus;
  partnerSync:
    | 'not-applicable'
    | 'authorization-required'
    | 'sent'
    | 'attention';
  partnerWarning: string;
}

interface PendingAuthorityRequest {
  request: NinetyNineFoodStatusWriteAuthorityRequest;
  resolve: (choice: NinetyNineFoodStatusWriteChoice) => void;
}

let pendingAuthority: PendingAuthorityRequest | null = null;

const clean = (value: string): string => value.trim().slice(0, 240);

const normalizeRequest = (
  input: NinetyNineFoodStatusWriteAuthorityRequest
): NinetyNineFoodStatusWriteAuthorityRequest | null => {
  const storeId = clean(input.storeId);
  const orderId = clean(input.orderId);
  const status = input.status;
  if (!storeId || !orderId || !status) return null;
  return { storeId, orderId, status };
};

const notifyChanged = (): void => {
  window.dispatchEvent(
    new Event(KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_CHANGED_EVENT)
  );
};

export const requestNinetyNineFoodStatusWriteAuthority = (
  input: NinetyNineFoodStatusWriteAuthorityRequest
): Promise<NinetyNineFoodStatusWriteChoice> => {
  const request = normalizeRequest(input);
  if (!request) return Promise.resolve('cancel');

  if (pendingAuthority) {
    pendingAuthority.resolve('cancel');
  }

  return new Promise(resolve => {
    pendingAuthority = { request, resolve };
    notifyChanged();
    window.dispatchEvent(
      new CustomEvent<NinetyNineFoodStatusWriteAuthorityRequest>(
        KYRUB_99FOOD_STATUS_WRITE_AUTHORITY_REQUESTED_EVENT,
        { detail: request }
      )
    );
  });
};

export const readNinetyNineFoodStatusWriteAuthority = (
  storeId: string
): NinetyNineFoodStatusWriteAuthorityRequest | null => {
  const normalizedStoreId = clean(storeId);
  if (
    !normalizedStoreId ||
    pendingAuthority?.request.storeId !== normalizedStoreId
  ) {
    return null;
  }
  return pendingAuthority.request;
};

export const resolveNinetyNineFoodStatusWriteAuthority = (
  request: NinetyNineFoodStatusWriteAuthorityRequest,
  choice: NinetyNineFoodStatusWriteChoice
): boolean => {
  const normalized = normalizeRequest(request);
  if (
    !normalized ||
    !pendingAuthority ||
    pendingAuthority.request.storeId !== normalized.storeId ||
    pendingAuthority.request.orderId !== normalized.orderId ||
    pendingAuthority.request.status !== normalized.status
  ) {
    return false;
  }

  const resolver = pendingAuthority.resolve;
  pendingAuthority = null;
  notifyChanged();
  resolver(choice);
  return true;
};

export const publishNinetyNineFoodStatusWriteResult = (
  result: NinetyNineFoodStatusWriteResult
): void => {
  window.dispatchEvent(
    new CustomEvent<NinetyNineFoodStatusWriteResult>(
      KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT,
      { detail: result }
    )
  );
};
