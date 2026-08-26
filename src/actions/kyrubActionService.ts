import type { User } from 'firebase/auth';
import type {
  KyrubActionExecutionResult,
  KyrubActionProposal,
  KyrubAiPrepareProductDraftProposal,
  KyrubAiUpdateStoreProfileProposal,
} from '../../shared/kyrubActions';
import { completeKyrubiaProductAndAdvance } from '../ai/operationalWorkflowStore';
import { recordUserActivityEvent } from '../observability/kyrubActivityBrowser';
import { invalidateKyrubErpContext } from './erpReadActionService';
import { KYRUB_CATALOG_PRODUCT_CHANGED_EVENT } from './kyrubCatalogDraftService';

const SAFE_ACTION_ENDPOINT = '/api/action-execute';
const STORE_PROMOTION_ACTION_ENDPOINT = '/api/store-promotion-execute';

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
    proposal.type === 'update_product' ||
    proposal.type === 'import_catalog_draft'
  ) return 'product';
  if (proposal.type === 'prepare_product_draft') return 'product_draft';
  if (proposal.type === 'create_note') return 'note';
  if (proposal.type === 'create_task') return 'task';
  if (proposal.type === 'adjust_inventory') return 'inventory';
  if (proposal.type === 'set_product_composition') return 'product_composition';
  if (proposal.type === 'update_order_status') return 'order';
  if (
    proposal.type === 'start_store_activation' ||
    proposal.type === 'update_store_profile'
  ) {
    return 'store';
  }
  return undefined;
};

const recordConfirmedKyrubiaActionAttempt = (
  actorUid: string,
  proposal: KyrubActionProposal,
  confirmed: boolean
): void => {
  if (!confirmed) return;
  recordUserActivityEvent(actorUid, {
    type: 'interaction.action_attempted',
    domain: 'kyrubia',
    source: 'client_observation',
    screenId: 'home:kyrub',
    actionId: proposal.type,
    entityType: activityEntityType(proposal),
    metadata: { proposal_id: proposal.id },
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
  actorUid: string,
  proposal: KyrubActionProposal,
  result: KyrubActionExecutionResult,
  confirmed: boolean
): void => {
  if (!confirmed) return;
  recordUserActivityEvent(actorUid, {
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

const emitCatalogChanged = (productId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(KYRUB_CATALOG_PRODUCT_CHANGED_EVENT, {
      detail: { productId, published: false },
    })
  );
};

export const executeKyrubAction = async (
  user: User,
  proposal: KyrubActionProposal,
  confirmed: boolean
): Promise<KyrubActionExecutionResult> => {
  recordConfirmedKyrubiaActionAttempt(user.uid, proposal, confirmed);

  let token = '';
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new Error(
      'Não foi possível validar sua sessão. Entre novamente antes de executar esta ação.'
    );
  }

  // Promoções ainda não fazem parte do registro canônico genérico de ações.
  // Mantemos esse limite intacto e apenas roteamos a proposta já validada pelo
  // bridge especializado para seu executor dedicado.
  const isStorePromotion =
    (proposal as unknown as { type?: string }).type === 'create_store_promotion';
  const endpoint = isStorePromotion
    ? STORE_PROMOTION_ACTION_ENDPOINT
    : SAFE_ACTION_ENDPOINT;

  let response: Response;
  try {
    response = await fetch(endpoint, {
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
  recordConfirmedKyrubiaActionResult(user.uid, proposal, result, confirmed);

  if (
    proposal.type === 'create_product' ||
    proposal.type === 'update_product' ||
    proposal.type === 'update_store_profile' ||
    proposal.type === 'import_catalog_draft' ||
    proposal.type === 'adjust_inventory' ||
    proposal.type === 'set_product_composition' ||
    proposal.type === 'update_order_status' ||
    isStorePromotion
  ) {
    invalidateKyrubErpContext(user.uid);
  }
  if (proposal.type === 'create_product') {
    advanceProductSequenceAfterExecution(user, proposal);
  }
  if (proposal.type === 'import_catalog_draft') {
    emitCatalogChanged(result.entityId);
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

export const executePreauthorizedProductDraftAction = async (
  user: User,
  proposal: KyrubAiPrepareProductDraftProposal
): Promise<KyrubActionExecutionResult> => {
  if (proposal.requiresConfirmation !== false) {
    throw new Error('Este rascunho está marcado como uma ação que exige confirmação.');
  }

  recordConfirmedKyrubiaActionAttempt(user.uid, proposal, true);
  const result = await executeKyrubAction(user, proposal, false);
  recordConfirmedKyrubiaActionResult(user.uid, proposal, result, true);
  emitCatalogChanged(result.entityId);
  return result;
};
