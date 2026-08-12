import type {
  KyrubAiActionProposal,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import { KYRUB_ACTION_REGISTRY } from '../../shared/kyrubActions';

export const KYRUB_AI_ACTION_PROPOSAL_EVENT =
  'kyrub-ai-action-proposal';

export type KyrubAiActionProposalEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiActionProposal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasCommonProposalFields = (value: Record<string, unknown>): boolean =>
  typeof value.id === 'string' &&
  value.id.trim().length > 0;

export const isKyrubAiActionProposal = (
  value: unknown
): value is KyrubAiActionProposal => {
  if (!isRecord(value) || !hasCommonProposalFields(value)) return false;

  switch (value.type) {
    case 'create_note':
      return (
        typeof value.title === 'string' &&
        typeof value.content === 'string' &&
        Array.isArray(value.checklist) &&
        value.checklist.every(item => typeof item === 'string') &&
        value.requiresConfirmation === true
      );
    case 'start_store_activation':
      return (
        (value.purpose === 'store_setup' || value.purpose === 'create_product') &&
        value.requiresConfirmation === true
      );
    case 'update_store_profile':
      return (
        typeof value.activationGrantId === 'string' &&
        isRecord(value.patch) &&
        value.requiresConfirmation === false
      );
    case 'create_product':
      return (
        typeof value.name === 'string' &&
        typeof value.description === 'string' &&
        typeof value.price === 'number' &&
        typeof value.stock === 'number' &&
        typeof value.category === 'string' &&
        typeof value.image === 'string' &&
        typeof value.isService === 'boolean' &&
        typeof value.isComplimentary === 'boolean' &&
        value.requiresConfirmation === true
      );
    case 'update_product':
      return (
        typeof value.productId === 'string' &&
        value.productId.trim().length > 0 &&
        typeof value.expectedCurrentName === 'string' &&
        value.expectedCurrentName.trim().length > 0 &&
        isRecord(value.patch) &&
        typeof value.patch.name === 'string' &&
        value.patch.name.trim().length > 0 &&
        value.requiresConfirmation === true
      );
    default:
      return false;
  }
};

const prepareProposalForConfirmation = (
  proposal: KyrubAiActionProposal
): KyrubAiActionProposal => ({
  ...proposal,
  origin: proposal.origin ?? 'kyrubia',
  risk: proposal.risk ?? KYRUB_ACTION_REGISTRY[proposal.type].risk,
  inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
  impact: proposal.impact ?? {
    entityCount: 1,
    reversibility:
      proposal.type === 'create_product' || proposal.type === 'update_product'
        ? 'limited'
        : 'easy',
  },
});

export const emitKyrubAiActionProposal = (
  conversationId: string,
  response: KyrubAiConsultantResponse
): void => {
  if (
    typeof window === 'undefined' ||
    !isKyrubAiActionProposal(response.actionProposal) ||
    response.actionProposal.requiresConfirmation !== true
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<KyrubAiActionProposalEventDetail>(
      KYRUB_AI_ACTION_PROPOSAL_EVENT,
      {
        detail: {
          conversationId,
          requestId: response.requestId,
          proposal: prepareProposalForConfirmation(response.actionProposal),
        },
      }
    )
  );
};