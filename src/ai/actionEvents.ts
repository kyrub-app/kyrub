import type {
  KyrubAiActionProposal,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';

export const KYRUB_AI_ACTION_PROPOSAL_EVENT =
  'kyrub-ai-action-proposal';

export type KyrubAiActionProposalEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiActionProposal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isKyrubAiActionProposal = (
  value: unknown
): value is KyrubAiActionProposal => {
  if (!isRecord(value) || value.type !== 'create_note') return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.checklist) &&
    value.checklist.every(item => typeof item === 'string') &&
    value.requiresConfirmation === true
  );
};

export const emitKyrubAiActionProposal = (
  conversationId: string,
  response: KyrubAiConsultantResponse
): void => {
  if (
    typeof window === 'undefined' ||
    !isKyrubAiActionProposal(response.actionProposal)
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
          proposal: response.actionProposal,
        },
      }
    )
  );
};
