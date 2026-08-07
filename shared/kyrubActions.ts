export const KYRUB_ACTION_TYPES = {
  CREATE_NOTE: 'create_note',
  READ_STORE_SUMMARY: 'read_store_summary',
  LIST_PRODUCTS: 'list_products',
  LIST_LOW_STOCK_PRODUCTS: 'list_low_stock_products',
  LIST_PENDING_ORDERS: 'list_pending_orders',
} as const;

export const KYRUB_PLANNED_ERP_ACTION_TYPES = {
  CREATE_TASK: 'create_task',
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
export type KyrubActionMode = 'read' | 'write';

export type KyrubActiveActionType =
  typeof KYRUB_ACTION_TYPES[keyof typeof KYRUB_ACTION_TYPES];

export type KyrubPlannedActionType =
  typeof KYRUB_PLANNED_ERP_ACTION_TYPES[keyof typeof KYRUB_PLANNED_ERP_ACTION_TYPES];

export type KyrubReadActionType = Exclude<
  KyrubActiveActionType,
  typeof KYRUB_ACTION_TYPES.CREATE_NOTE
>;

export type KyrubActionDefinition<TType extends string = KyrubActiveActionType> = {
  type: TType;
  mode: KyrubActionMode;
  risk: KyrubActionRisk;
  requiresConfirmation: boolean;
  permission: string;
};

export const KYRUB_ACTION_REGISTRY: Record<
  KyrubActiveActionType,
  KyrubActionDefinition
> = {
  create_note: {
    type: 'create_note',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'notes.write',
  },
  read_store_summary: {
    type: 'read_store_summary',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'store.read',
  },
  list_products: {
    type: 'list_products',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.read',
  },
  list_low_stock_products: {
    type: 'list_low_stock_products',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.read',
  },
  list_pending_orders: {
    type: 'list_pending_orders',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'orders.read',
  },
};

export const KYRUB_PLANNED_ACTION_REGISTRY: Record<
  KyrubPlannedActionType,
  KyrubActionDefinition<KyrubPlannedActionType>
> = {
  create_task: {
    type: 'create_task',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'notes.write',
  },
  create_product_draft: {
    type: 'create_product_draft',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'products.write',
  },
  update_product_draft: {
    type: 'update_product_draft',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'products.write',
  },
  adjust_inventory: {
    type: 'adjust_inventory',
    mode: 'write',
    risk: 'high',
    requiresConfirmation: true,
    permission: 'products.write',
  },
  update_store: {
    type: 'update_store',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'store.update',
  },
  analyze_catalog: {
    type: 'analyze_catalog',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.read',
  },
  import_catalog_draft: {
    type: 'import_catalog_draft',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'products.write',
  },
};

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
