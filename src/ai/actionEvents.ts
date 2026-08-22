import type {
  KyrubAiActionProposal,
  KyrubAiConsultantResponse,
} from '../../shared/aiConsultant';
import type { KyrubCatalogAnalysis } from '../../shared/kyrubCatalogAnalysis';
import { KYRUB_ACTION_REGISTRY } from '../../shared/kyrubActions';
import { normalizeKyrubInventoryTransformationProposal } from '../../shared/kyrubInventoryTransformation';
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

const isInventoryUnit = (value: unknown): boolean =>
  ['un', 'kg', 'g', 'l', 'ml'].includes(String(value));

const isInventoryEntry = (value: unknown, allowZero = false): boolean => {
  if (!isRecord(value)) return false;
  const quantityValid =
    typeof value.quantity === 'number' &&
    Number.isFinite(value.quantity) &&
    (allowZero ? value.quantity >= 0 : value.quantity > 0);
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    quantityValid &&
    isInventoryUnit(value.unit) &&
    (value.purchaseCost === undefined ||
      (typeof value.purchaseCost === 'number' &&
        Number.isFinite(value.purchaseCost) &&
        value.purchaseCost >= 0))
  );
};

const isCompositionLine = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    typeof value.inventoryItemId === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(value.inventoryItemId) &&
    typeof value.inventoryItemName === 'string' &&
    value.inventoryItemName.trim().length > 0 &&
    typeof value.quantity === 'number' &&
    Number.isFinite(value.quantity) &&
    value.quantity > 0 &&
    isInventoryUnit(value.unit)
  );
};

const isProductPatch = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const supportedKeys = ['name', 'description', 'price', 'category', 'image'] as const;
  const supplied = supportedKeys.filter(key => value[key] !== undefined);
  if (supplied.length === 0) return false;
  if (value.name !== undefined && (
    typeof value.name !== 'string' || value.name.trim().length === 0
  )) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.category !== undefined && (
    typeof value.category !== 'string' || value.category.trim().length === 0
  )) return false;
  if (value.image !== undefined && typeof value.image !== 'string') return false;
  if (value.price !== undefined && (
    typeof value.price !== 'number' ||
    !Number.isFinite(value.price) ||
    value.price < 0
  )) return false;
  return Object.keys(value).every(key => supportedKeys.includes(key as typeof supportedKeys[number]));
};

const ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
] as const;
const MUTABLE_ORDER_STATUSES = ORDER_STATUSES.filter(status => status !== 'pending');

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
        isProductPatch(value.patch) &&
        value.requiresConfirmation === true
      );
    case 'set_product_publication':
      return (
        typeof value.productId === 'string' &&
        value.productId.trim().length > 0 &&
        !value.productId.includes('/') &&
        typeof value.productName === 'string' &&
        value.productName.trim().length > 0 &&
        (value.expectedCurrentStatus === 'draft' || value.expectedCurrentStatus === 'published') &&
        typeof value.published === 'boolean' &&
        value.published !== (value.expectedCurrentStatus === 'published') &&
        value.requiresConfirmation === true
      );
    case 'adjust_inventory': {
      const validMode =
        value.mode === 'increment' ||
        value.mode === 'decrement' ||
        value.mode === 'set';
      const validSource =
        isRecord(value.source) &&
        [
          'supplier_invoice',
          'inventory_intake_text',
          'manual_outflow',
          'loss_report',
          'physical_count',
        ].includes(String(value.source.kind));
      return (
        validMode &&
        Array.isArray(value.entries) &&
        value.entries.length > 0 &&
        value.entries.length <= 60 &&
        value.entries.every(entry => isInventoryEntry(entry, value.mode === 'set')) &&
        validSource &&
        value.requiresConfirmation === true
      );
    }
    case 'transform_inventory':
      return normalizeKyrubInventoryTransformationProposal(value) !== null;
    case 'set_product_composition':
      return (
        typeof value.productId === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(value.productId) &&
        typeof value.productName === 'string' &&
        value.productName.trim().length > 0 &&
        (value.kind === 'recipe' || value.kind === 'bundle') &&
        typeof value.yieldQuantity === 'number' &&
        Number.isFinite(value.yieldQuantity) &&
        value.yieldQuantity > 0 &&
        Array.isArray(value.lines) &&
        value.lines.length > 0 &&
        value.lines.length <= 40 &&
        value.lines.every(isCompositionLine) &&
        new Set(value.lines.map(line => isRecord(line) ? line.inventoryItemId : '')).size === value.lines.length &&
        value.requiresConfirmation === true
      );
    case 'update_order_status': {
      const decision = value.decision;
      const validDecision = decision === undefined || (
        isRecord(decision) &&
        (decision.reason === undefined || typeof decision.reason === 'string') &&
        (decision.alternative === undefined || typeof decision.alternative === 'string')
      );
      const nextStatus = String(value.nextStatus);
      const needsReason = nextStatus === 'rejected' || nextStatus === 'cancelled';
      return (
        typeof value.orderId === 'string' &&
        value.orderId.trim().length > 0 &&
        !value.orderId.includes('/') &&
        ORDER_STATUSES.includes(value.expectedCurrentStatus as typeof ORDER_STATUSES[number]) &&
        MUTABLE_ORDER_STATUSES.includes(value.nextStatus as typeof MUTABLE_ORDER_STATUSES[number]) &&
        validDecision &&
        (!needsReason || (isRecord(decision) && typeof decision.reason === 'string' && decision.reason.trim().length > 0)) &&
        value.requiresConfirmation === true
      );
    }
    default:
      return false;
  }
};

const prepareProposalForConfirmation = (
  proposal: KyrubAiActionProposal
): KyrubAiActionProposal => {
  if (proposal.type === 'transform_inventory') {
    const normalized = normalizeKyrubInventoryTransformationProposal(proposal);
    return normalized ?? proposal;
  }

  return {
    ...proposal,
    origin: proposal.origin ?? 'kyrubia',
    risk: proposal.risk ?? KYRUB_ACTION_REGISTRY[proposal.type].risk,
    inputProvenance: proposal.inputProvenance ?? 'ai_generated_content',
    impact: proposal.impact ?? {
      entityCount: proposal.type === 'import_catalog_draft'
        ? proposal.items.length
        : proposal.type === 'adjust_inventory'
          ? proposal.entries.length
          : proposal.type === 'set_product_composition'
            ? proposal.lines.length
            : 1,
      reversibility:
        proposal.type === 'create_product' ||
        proposal.type === 'update_product' ||
        proposal.type === 'adjust_inventory' ||
        proposal.type === 'set_product_composition' ||
        proposal.type === 'update_order_status'
          ? 'limited'
          : 'easy',
    },
  };
};

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
