import type {
  KyrubAiAdjustInventoryProposal,
  KyrubInventoryAdjustmentEntry,
} from './kyrubActions';

export type KyrubExactInventoryAdjustmentEntry = KyrubInventoryAdjustmentEntry & {
  inventoryItemId?: string;
};

export type KyrubExactInventoryAdjustmentProposal = Omit<
  KyrubAiAdjustInventoryProposal,
  'entries'
> & {
  entries: KyrubExactInventoryAdjustmentEntry[];
};

export const normalizeExactInventoryItemId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{1,180}$/.test(normalized) ? normalized : '';
};
