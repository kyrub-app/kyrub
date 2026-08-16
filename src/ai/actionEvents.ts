import type {
  KyrubAiActionProposal,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import type { KyrubCatalogAnalysis } from '../../shared/kyrubCatalogAnalysis';
import { KYRUB_ACTION_REGISTRY } from '../../shared/kyrubActions';
import { auth } from '../utils/firebase';
import { saveKyrubiaCatalogAnalysis } from './catalogAnalysisStore';

export const KYRUB_AI_ACTION_PROPOSAL_EVENT =
  'kyrub-ai-action-proposal';
export const KYRUB_CATALOG_ANALYSIS_EVENT =
  'kyrub-catalog-analysis';

export type KyrubAiActionProposalEventDetail = {
  conversationId: string;
  requestId: string;
  proposal: KyrubAiActionProposal;
};

export type KyrubCatalogAnalysisEventDetail = {
  conversationId: string;
  requestId: string;
  analysis: KyrubCatalogAnalysis;
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
    case 'create_task':
      return (
        typeof value.title === 'string' &&
        value.title.trim().length > 0 &&
        typeof value.content === 'string' &&
        value.content.trim().length > 0 &&
        (value.reminderDateTime === null ||
          typeof value.reminderDateTime === 'string') &&
        value.requiresConfirmation === true
      );
    case 'start_store_activation':
      return (
        (value.purpose === 'store_setup' || value.purpose === 'create_product') &&
        value.requiresConfirmation === true
      );
    case 'update_store_profile':
      return (
        isRecord(value.patch) &&
        (value.requiresConfirmation === true ||
          (value.requiresConfirmation === false &&
            typeof value.activationGrantId === 'string' &&
            value.activationGrantId.trim().length > 0))
      );
    case 'import_catalog_draft':
      return (
        typeof value.conversationId === 'string' &&
        value.conversationId.trim().length > 0 &&
        isRecord(value.source) &&
        value.source.kind === 'catalog_analysis' &&
        Array.isArray(value.items) &&
        value.items.length > 0 &&
        value.items.length <= 60 &&
        value.items.every(item =>
          isRecord(item) &&
          typeof item.ref === 'string' &&
          item.ref.trim().length > 0 &&
          isRecord(item.product) &&
          typeof item.product.name === 'string' &&
          item.product.name.trim().length > 0 &&
          typeof item.product.category === 'string' &&
          item.product.category.trim().length > 0 &&
          typeof item.product.price === 'number' &&
          Number.isFinite(item.product.price) &&
          item.product.price >= 0 &&
          isRecord(item.fieldProvenance) &&
          Array.isArray(item.issues)
        ) &&
        value.requiresConfirmation === true
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
    entityCount: proposal.type === 'import_catalog_draft'
      ? proposal.items.length
      : 1,
    reversibility:
      proposal.type === 'create_product' || proposal.type === 'update_product'
        ? 'limited'
        : 'easy',
  },
});

const emitCatalogAnalysis = (
  conversationId: string,
  response: KyrubAiConsultantResponse
): void => {
  if (typeof window === 'undefined' || !response.catalogAnalysis) return;
  const uid = auth.currentUser?.uid ?? '';
  if (uid && typeof localStorage !== 'undefined') {
    saveKyrubiaCatalogAnalysis(
      localStorage,
      uid,
      conversationId,
      response.catalogAnalysis
    );
  }
  window.dispatchEvent(
    new CustomEvent<KyrubCatalogAnalysisEventDetail>(
      KYRUB_CATALOG_ANALYSIS_EVENT,
      {
        detail: {
          conversationId,
          requestId: response.requestId,
          analysis: response.catalogAnalysis,
        },
      }
    )
  );
};

export const emitKyrubAiActionProposal = (
  conversationId: string,
  response: KyrubAiConsultantResponse
): void => {
  emitCatalogAnalysis(conversationId, response);

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
