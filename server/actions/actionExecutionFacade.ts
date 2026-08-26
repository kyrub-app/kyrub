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
  executeAuthorizedKyrubStorePromotion,
  isKyrubStorePromotionExecutionRequest,
} from './storePromotionExecutionService.js';
import {
  executeAuthorizedKyrubStoreProfileUpdate,
  isKyrubStoreProfileExecutionRequest,
} from './storeProfileCanonicalSyncService.js';
import {
  executeAuthorizedKyrubTaskCreation,
  isKyrubTaskCreationExecutionRequest,
} from './taskCreationExecutionService.js';

export { mapKyrubActionExecutionError };

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
  if (isKyrubStorePromotionExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubStorePromotion(authorization, rawRequest) as Promise<KyrubActionExecutionResult>;
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
