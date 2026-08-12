import type { KyrubActionExecutionResult } from '../../shared/kyrubActions.js';
import {
  executeAuthorizedKyrubAction as executeLegacyAuthorizedKyrubAction,
  mapKyrubActionExecutionError,
} from './actionExecutionService.js';
import {
  executeAuthorizedKyrubProductUpdate,
  isKyrubProductUpdateExecutionRequest,
} from './productUpdateExecutionService.js';

export { mapKyrubActionExecutionError };

export const executeAuthorizedKyrubAction = async (
  authorization: string,
  rawRequest: unknown
): Promise<KyrubActionExecutionResult> =>
  isKyrubProductUpdateExecutionRequest(rawRequest)
    ? executeAuthorizedKyrubProductUpdate(authorization, rawRequest)
    : executeLegacyAuthorizedKyrubAction(authorization, rawRequest);
