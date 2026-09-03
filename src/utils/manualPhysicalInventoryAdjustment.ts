import type { KyrubErpInventorySummary } from '../../shared/kyrubErpContext';
import type { KyrubActionProposal } from '../../shared/kyrubActions';
import type { KyrubExactInventoryAdjustmentProposal } from '../../shared/exactInventoryAdjustment';
import {
  KYRUB_AI_ACTION_PROPOSAL_EVENT,
  type KyrubAiActionProposalEventDetail,
} from '../ai/actionEvents';

export type ManualPhysicalInventoryAdjustmentMode = 'increment' | 'set';

const createProposalId = (): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `manual-inventory-${random}`;
};

export const requestManualPhysicalInventoryAdjustment = (input: {
  item: KyrubErpInventorySummary;
  mode: ManualPhysicalInventoryAdjustmentMode;
  quantity: number;
}): string => {
  const itemId = input.item.id.trim();
  const name = input.item.name.trim();
  const quantity = input.quantity;
  if (!itemId || !name || !Number.isFinite(quantity)) {
    throw new Error('Item de estoque inválido para ajuste manual.');
  }
  if (input.mode === 'increment' ? quantity <= 0 : quantity < 0) {
    throw new Error(
      input.mode === 'increment'
        ? 'Informe uma quantidade maior que zero para dar entrada.'
        : 'Informe uma contagem física igual ou maior que zero.'
    );
  }

  const proposalId = createProposalId();
  const proposal: KyrubExactInventoryAdjustmentProposal = {
    id: proposalId,
    type: 'adjust_inventory',
    mode: input.mode,
    movementKind: input.mode === 'increment' ? 'intake' : 'correction',
    entries: [{
      inventoryItemId: itemId,
      name,
      quantity,
      unit: input.item.unit,
    }],
    source: {
      kind: input.mode === 'increment' ? 'inventory_intake_text' : 'physical_count',
      label: input.mode === 'increment'
        ? `Entrada manual · ${name}`
        : `Contagem física manual · ${name}`,
    },
    requiresConfirmation: true,
    origin: 'manual',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'limited' },
    idempotencyKey: `manual:adjust_inventory:${proposalId}`,
  };

  const detail: KyrubAiActionProposalEventDetail = {
    conversationId: `manual-inventory:${itemId}`,
    requestId: proposalId,
    proposal: proposal as KyrubActionProposal,
  };
  window.dispatchEvent(
    new CustomEvent<KyrubAiActionProposalEventDetail>(
      KYRUB_AI_ACTION_PROPOSAL_EVENT,
      { detail }
    )
  );
  return proposalId;
};
