import type { KyrubActionExecutionResult } from '../../shared/kyrubActions.js';
import {
  executeAuthorizedKyrubAction as executeLegacyAuthorizedKyrubAction,
  mapKyrubActionExecutionError,
} from './actionExecutionService.js';
import {
  executeAuthorizedKyrubProductUpdate,
  isKyrubProductUpdateExecutionRequest,
} from './productUpdateExecutionService.js';
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
  if (isKyrubProductUpdateExecutionRequest(rawRequest)) {
    return executeAuthorizedKyrubProductUpdate(authorization, rawRequest);
  }
  return executeLegacyAuthorizedKyrubAction(authorization, rawRequest);
};
