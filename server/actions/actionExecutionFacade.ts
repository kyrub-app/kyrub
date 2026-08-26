import type { KyrubActionExecutionResult } from '../../shared/kyrubActions.js';
import {
  executeAuthorizedKyrubAction as executeLegacyAuthorizedKyrubAction,
  mapKyrubActionExecutionError,
} from './actionExecutionService.js';
import {
  executeAuthorizedKyrubOrderStatus,
  isKyrubOrderStatusExecutionRequest,
} from './orderStatusExecutionService.js';
import {
  executeAuthorizedKyrubProductPublication,
  isKyrubProductPublicationExecutionRequest,
} from './productPublicationExecutionService.js';
import {
  executeAuthorizedKyrubProductUpdate,
  isKyrubProductUpdateExecutionRequest,
} from './productUpdateExecutionService.js';
import {
  executeAuthorizedKyrubStoreOperation,
  isKyrubStoreOperationExecutionRequest,
} from './storeOperationExecutionService.js';
import {
  executeAuthorizedKyrubStoreProfileUpdate,
  isKyrubStoreProfileExecutionRequest,
} from './storeProfileCanonicalSyncService.js';
import {
  executeAuthorizedKyrubTaskCreation,
  isKyrubTaskCreationExecutionRequest,
} from './taskCreationExecutionService.js';

export { mapKyrubActionExecutionError };

const isStorePromotionRequest = (rawRequest: unknown): boolean => {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return false;
  }
  const proposal = (rawRequest as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'create_store_promotion'
  );
};

export const executeAuthorizedKyrubAction = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> => {
  if (isKyrubTaskCreationExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubTaskCreation(authorization, rawRequest);
  }
  if (isKyrubStoreOperationExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubStoreOperation(authorization, rawRequest) as Promise<KyrubActionExecutionResult>;
  }
  if (isStorePromotionRequest(rawRequest)) {
    const promotion = await import('./storePromotionExecutionService.js');
    if (!promotion.isKyrubStorePromotionExecutionRequest(rawRequest)) {
      return executeLegacyAuthorizedKyrubAction(authorization, rawRequest);
    }
    return promotion.executeAuthorizedKyrubStorePromotion(
      authorization,
      rawRequest
    ) as Promise<KyrubActionExecutionResult>;
  }
  if (isKyrubStoreProfileExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubStoreProfileUpdate(authorization, rawRequest);
  }
  if (isKyrubProductUpdateExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubProductUpdate(authorization, rawRequest);
  }
  if (isKyrubProductPublicationExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubProductPublication(authorization, rawRequest);
  }
  if (isKyrubOrderStatusExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubOrderStatus(authorization, rawRequest);
  }
  return executeLegacyAuthorizedKyrubAction(authorization, rawRequest);
};