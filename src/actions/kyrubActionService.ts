import type { User } from 'firebase/auth';
import type {
  KyrubActionExecutionResult,
  KyrubActionProposal,
  KyrubAiUpdateStoreProfileProposal,
} from '../../shared/kyrubActions';
import { completeKyrubiaProductAndAdvance } from '../ai/operationalWorkflowStore';
import { recordCurrentUserActivityEvent } from '../observability/kyrubActivityBrowser';
import { invalidateKyrubErpContext } from './erpReadActionService';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const executionErrorMessage = (
  body: Record<string, unknown>,
  fallback: string
): string => typeof body.error === 'string' && body.error.trim()
  ? body.error.trim()
  : fallback;

const unstructuredExecutionErrorMessage = (response: Response): string => {
  if (response.status === 404) {
    return 'O endpoint do executor seguro não foi encontrado neste ambiente (HTTP 404).';
  }
  if (response.status >= 500) {
    return `O executor seguro falhou antes de devolver um diagnóstico estruturado (HTTP ${response.status}).`;
  }
  return `O executor seguro respondeu sem um diagnóstico estruturado (HTTP ${response.status}).`;
};

const validReceipt = (
  body: Record<string, unknown>,
  proposal: KyrubActionProposal
): boolean =>
  typeof body.actionId === 'string' &&
  body.type === proposal.type &&
  (body.status === 'success' || body.status === 'already_applied') &&
  typeof body.entityId === 'string' &&
  typeof body.origin === 'string' &&
  typeof body.idempotencyKey === 'string';

const activityEntityType = (
  proposal: KyrubActionProposal
): string | undefined => {
  if (
    proposal.type === 'create_product' ||
    proposal.type === 'update_product'
  ) return 'product';
  if (proposal.type === 'create_note') return 'note';
  if (
    proposal.type === 'start_store_activation' ||
    proposal.type === 'update_store_profile'
  ) {
    return 'store';
  }
  return undefined;
};

const recordConfirmedKyrubiaActionAttempt = (
  proposal: KyrubActionProposal,
  confirmed: boolean
): void => {
  if (!confirmed) return;
  recordCurrentUserActivityEvent({
    type: 'interaction.action_attempted',
    domain: 'kyrubia',
    source: 'client_observation',
    screenId: 'home:kyrub',
    actionId: proposal.type,
    entityType: activityEntityType(proposal),
  });
};

const receiptReferenceMetadata = (
  result: KyrubActionExecutionResult
): Record<string, string> | undefined => {
  const executionId = result.executionEnvelope?.executionId?.trim();
  const proposalId = result.actionId?.trim();
  return executionId && proposalId
    ? {
        execution_id: executionId,
        proposal_id: proposalId,
      }
    : undefined;
};

const recordConfirmedKyrubiaActionResult = (
  proposal: KyrubActionProposal,
  result: KyrubActionExecutionResult,
  confirmed: boolean
): void => {
  if (!confirmed) return;
  recordCurrentUserActivityEvent({
    type: 'result.action_succeeded',
    domain: 'kyrubia',
    source: 'authoritative_write_ack',
    screenId: 'home:kyrub',
    actionId: proposal.type,
    entityType: activityEntityType(proposal),
    entityId: result.entityId,
    metadata: receiptReferenceMetadata(result),
  });
};

const conversationIdFromProductIdempotencyKey = (
  proposal: KyrubActionProposal
): string | null => {
  if (proposal.type !== 'create_product') return null;
  const key = proposal.idempotencyKey;
  const prefix = 'kyrubia:create_product:';
  if (typeof key !== 'string' || !key.startsWith(prefix)) return null;
  const withoutPrefix = key.slice(prefix.length);
  const proposalSeparator = withoutPrefix.lastIndexOf(':');
  if (proposalSeparator <= 0) return null;
  const conversationId = withoutPrefix.slice(0, proposalSeparator).trim();
  return conversationId || null;
};

const advanceProductSequenceAfterExecution = (
  user: User,
  proposal: KyrubActionProposal
): void => {
  if (typeof localStorage === 'undefined') return;
  const conversationId = conversationIdFromProductIdempotencyKey(proposal);
  if (!conversationId) return;
  completeKyrubiaProductAndAdvance(
    localStorage,
    user.uid,
    conversationId
  );
};

export const executeKyrubAction = async (
  user: User,
  proposal: KyrubActionProposal,
  confirmed: boolean
): Promise<KyrubActionExecutionResult> => {
  recordConfirmedKyrubiaActionAttempt(proposal, confirmed);

  let token = '';
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new Error(
      'Não foi possível validar sua sessão. Entre novamente antes de executar esta ação.'
    );
  }

  let response: Response;
  try {
    response = await fetch(SAFE_ACTION_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ confirmed, proposal }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(
      'Não foi possível conectar ao executor seguro do Kyrub. Tente novamente.'
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      executionErrorMessage(
        body,
        unstructuredExecutionErrorMessage(response)
      )
    );
  }

  if (!validReceipt(body, proposal)) {
    throw new Error(
      `O executor seguro respondeu sem um recibo de execução válido (HTTP ${response.status}).`
    );
  }

  const result = body as unknown as KyrubActionExecutionResult;
  recordConfirmedKyrubiaActionResult(proposal, result, confirmed);

  if (
    proposal.type === 'create_product' ||
    proposal.type === 'update_product' ||
    proposal.type === 'update_store_profile'
  ) {
    invalidateKyrubErpContext(user.uid);
  }
  if (proposal.type === 'create_product') {
    advanceProductSequenceAfterExecution(user, proposal);
  }

  return result;
};

export const executePreauthorizedStoreProfileAction = async (
  user: User,
  proposal: KyrubAiUpdateStoreProfileProposal
): Promise<KyrubActionExecutionResult> => {
  if (proposal.requiresConfirmation) {
    throw new Error('Esta atualização da loja exige confirmação humana.');
  }
  return executeKyrubAction(user, proposal, false);
};
