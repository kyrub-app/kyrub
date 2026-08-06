export const KYRUB_ACTION_TYPES = {
  CREATE_NOTE: 'create_note',
} as const;

export const KYRUB_PLANNED_ERP_ACTION_TYPES = {
  READ_STORE_SUMMARY: 'read_store_summary',
  LIST_PRODUCTS: 'list_products',
  LIST_LOW_STOCK_PRODUCTS: 'list_low_stock_products',
  LIST_PENDING_ORDERS: 'list_pending_orders',
  CREATE_PRODUCT_DRAFT: 'create_product_draft',
  UPDATE_PRODUCT_DRAFT: 'update_product_draft',
  ADJUST_INVENTORY: 'adjust_inventory',
  UPDATE_STORE: 'update_store',
  ANALYZE_CATALOG: 'analyze_catalog',
  IMPORT_CATALOG_DRAFT: 'import_catalog_draft',
} as const;

export type KyrubActionOrigin =
  | 'kyrubia'
  | 'chatgpt'
  | 'manual'
  | 'automation';

export type KyrubActionRisk = 'low' | 'medium' | 'high';

export type KyrubActionProposalMetadata = {
  origin?: KyrubActionOrigin;
  risk?: KyrubActionRisk;
  idempotencyKey?: string;
};

export type KyrubAiCreateNoteProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.CREATE_NOTE;
  title: string;
  content: string;
  checklist: string[];
  requiresConfirmation: true;
};

export type KyrubActionProposal = KyrubAiCreateNoteProposal;

export type KyrubActionExecutionStatus =
  | 'success'
  | 'already_applied';

export type KyrubActionExecutionResult = {
  actionId: string;
  type: KyrubActionProposal['type'];
  status: KyrubActionExecutionStatus;
  entityId: string;
  origin: KyrubActionOrigin;
  idempotencyKey: string;
};
