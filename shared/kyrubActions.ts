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

export type KyrubInputProvenance =
  | 'user_intent'
  | 'quoted_content'
  | 'document_content'
  | 'tool_output'
  | 'ai_generated_content'
  | 'sensor_inference';

export type KyrubActionReversibility = 'easy' | 'limited' | 'hard';

export type KyrubActionImpact = {
  entityCount: number;
  reversibility: KyrubActionReversibility;
  financialExposureMinor?: number;
  financialCurrency?: string;
};

export type KyrubPolicyOutcome =
  | 'allow'
  | 'require_confirmation'
  | 'deny';

export type KyrubPolicyReason =
  | 'ACTION_NOT_REGISTERED'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'WRITE_REQUIRES_USER_INTENT'
  | 'BLAST_RADIUS_EXCEEDED'
  | 'INVALID_IMPACT';

export type KyrubPolicyDecision = {
  version: 1;
  id: string;
  outcome: KyrubPolicyOutcome;
  actionType: KyrubActiveActionType;
  permission: string;
  reasons: KyrubPolicyReason[];
  evaluatedAt: string;
  maxAffectedEntities: number;
};

export type KyrubAuthorizationMode =
  | 'human_confirmation'
  | 'preauthorized';

export type KyrubExecutionEnvelope = {
  version: 1;
  executionId: string;
  actionId: string;
  actionType: KyrubActiveActionType;
  actorUid: string;
  origin: KyrubActionOrigin;
  inputProvenance: KyrubInputProvenance;
  impact: KyrubActionImpact;
  proposalHash: string;
  policyDecisionId: string;
  authorizationMode: KyrubAuthorizationMode;
  authorizedAt: string;
  expiresAt: string;
  idempotencyKey: string;
};

export type KyrubActiveActionType =
  typeof KYRUB_ACTION_TYPES[keyof typeof KYRUB_ACTION_TYPES];

export type KyrubReadActionType = Exclude<
  KyrubActiveActionType,
  typeof KYRUB_ACTION_TYPES.CREATE_NOTE
>;

export type KyrubActionDefinition = {
  type: KyrubActiveActionType;
  mode: KyrubActionMode;
  risk: KyrubActionRisk;
  requiresConfirmation: boolean;
  permission: string;
  maxAffectedEntities: number;
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
    maxAffectedEntities: 1,
  },
  read_store_summary: {
    type: 'read_store_summary',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'store.read',
    maxAffectedEntities: 1,
  },
  list_products: {
    type: 'list_products',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.read',
    maxAffectedEntities: 50,
  },
  list_low_stock_products: {
    type: 'list_low_stock_products',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.read',
    maxAffectedEntities: 50,
  },
  list_pending_orders: {
    type: 'list_pending_orders',
    mode: 'read',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'orders.read',
    maxAffectedEntities: 50,
  },
};

export type KyrubActionProposalMetadata = {
  origin?: KyrubActionOrigin;
  risk?: KyrubActionRisk;
  idempotencyKey?: string;
  inputProvenance?: KyrubInputProvenance;
  impact?: KyrubActionImpact;
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
  executionEnvelope?: KyrubExecutionEnvelope;
};
