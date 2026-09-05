import type { CustomerOrderStatus } from './customerOrders';
import { recordOmnichannelE2EEvidence } from './omnichannelE2EEvidence';

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
  if (result.partnerSync !== 'not-applicable') {
    recordOmnichannelE2EEvidence({
      storeId: result.storeId,
      kind: '99food_status_decision',
      source: 'authoritative_execution_result',
      referenceId: `${result.orderId}:${result.status}`,
      outcome: result.partnerSync,
      summary: result.partnerSync === 'authorization-required'
        ? `Pedido ${result.orderId}: status ${result.status} aplicado somente no Kyrub; nenhum provider write foi autorizado.`
        : result.partnerSync === 'sent'
          ? `Pedido ${result.orderId}: status ${result.status} aplicado no Kyrub e enviado à 99Food.`
          : `Pedido ${result.orderId}: status ${result.status} aplicado localmente, mas o provider exige atenção.`,
      details: {
        orderId: result.orderId,
        status: result.status,
        partnerSync: result.partnerSync,
        partnerWarning: result.partnerWarning,
      },
    });
  }
  window.dispatchEvent(
    new CustomEvent<NinetyNineFoodStatusWriteResult>(
      KYRUB_99FOOD_STATUS_WRITE_RESULT_EVENT,
      { detail: result }
    )
  );
};
