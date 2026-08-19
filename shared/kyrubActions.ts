import type {
  KyrubCatalogDraftField,
  KyrubCatalogDraftFieldProvenance,
  KyrubCatalogDraftIssue,
  KyrubCatalogDraftProductInput,
  KyrubCatalogDraftSource,
} from './kyrubCatalogDrafts';

export const KYRUB_ACTION_TYPES = {
  CREATE_NOTE: 'create_note',
  CREATE_TASK: 'create_task',
  START_STORE_ACTIVATION: 'start_store_activation',
  UPDATE_STORE_PROFILE: 'update_store_profile',
  PREPARE_PRODUCT_DRAFT: 'prepare_product_draft',
  IMPORT_CATALOG_DRAFT: 'import_catalog_draft',
  CREATE_PRODUCT: 'create_product',
  UPDATE_PRODUCT: 'update_product',
  ADJUST_INVENTORY: 'adjust_inventory',
  READ_STORE_SUMMARY: 'read_store_summary',
  LIST_PRODUCTS: 'list_products',
  LIST_LOW_STOCK_PRODUCTS: 'list_low_stock_products',
  LIST_PENDING_ORDERS: 'list_pending_orders',
} as const;

export const KYRUB_PLANNED_ERP_ACTION_TYPES = {
  UPDATE_PRODUCT_DRAFT: 'update_product_draft',
  ANALYZE_CATALOG: 'analyze_catalog',
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
  | 'UNTRUSTED_INPUT_REQUIRES_CONFIRMATION'
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

export type KyrubWriteActionType =
  | typeof KYRUB_ACTION_TYPES.CREATE_NOTE
  | typeof KYRUB_ACTION_TYPES.CREATE_TASK
  | typeof KYRUB_ACTION_TYPES.START_STORE_ACTIVATION
  | typeof KYRUB_ACTION_TYPES.UPDATE_STORE_PROFILE
  | typeof KYRUB_ACTION_TYPES.PREPARE_PRODUCT_DRAFT
  | typeof KYRUB_ACTION_TYPES.IMPORT_CATALOG_DRAFT
  | typeof KYRUB_ACTION_TYPES.CREATE_PRODUCT
  | typeof KYRUB_ACTION_TYPES.UPDATE_PRODUCT
  | typeof KYRUB_ACTION_TYPES.ADJUST_INVENTORY;

export type KyrubReadActionType = Exclude<
  KyrubActiveActionType,
  KyrubWriteActionType
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
  create_task: {
    type: 'create_task',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'tasks.write',
    maxAffectedEntities: 1,
  },
  start_store_activation: {
    type: 'start_store_activation',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'store.activate',
    maxAffectedEntities: 1,
  },
  update_store_profile: {
    type: 'update_store_profile',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'store.profile.write',
    maxAffectedEntities: 1,
  },
  prepare_product_draft: {
    type: 'prepare_product_draft',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: false,
    permission: 'products.drafts.write',
    maxAffectedEntities: 1,
  },
  import_catalog_draft: {
    type: 'import_catalog_draft',
    mode: 'write',
    risk: 'low',
    requiresConfirmation: true,
    permission: 'products.drafts.write',
    maxAffectedEntities: 60,
  },
  create_product: {
    type: 'create_product',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'products.write',
    maxAffectedEntities: 1,
  },
  update_product: {
    type: 'update_product',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'products.write',
    maxAffectedEntities: 1,
  },
  adjust_inventory: {
    type: 'adjust_inventory',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'inventory.write',
    maxAffectedEntities: 60,
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

export type KyrubAiCreateTaskProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.CREATE_TASK;
  title: string;
  content: string;
  reminderDateTime: string | null;
  requiresConfirmation: true;
};

export type KyrubStoreActivationPurpose =
  | 'store_setup'
  | 'create_product';

export type KyrubAiStartStoreActivationProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.START_STORE_ACTIVATION;
  purpose: KyrubStoreActivationPurpose;
  requiresConfirmation: true;
};

export type KyrubStoreProfilePatch = {
  name?: string;
  description?: string;
  address?: string;
  contact?: string;
  keywords?: string[];
};

export type KyrubAiUpdateStoreProfileProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.UPDATE_STORE_PROFILE;
  activationGrantId?: string;
  patch: KyrubStoreProfilePatch;
  requiresConfirmation: boolean;
};

export type KyrubAiPrepareProductDraftProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.PREPARE_PRODUCT_DRAFT;
  product: KyrubCatalogDraftProductInput;
  source: KyrubCatalogDraftSource;
  fieldProvenance: Partial<
    Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>
  >;
  issues: KyrubCatalogDraftIssue[];
  requiresConfirmation: false;
};

export type KyrubCatalogDraftImportItem = {
  ref: string;
  product: KyrubCatalogDraftProductInput;
  fieldProvenance: Partial<
    Record<KyrubCatalogDraftField, KyrubCatalogDraftFieldProvenance>
  >;
  issues: KyrubCatalogDraftIssue[];
};

export type KyrubAiImportCatalogDraftProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.IMPORT_CATALOG_DRAFT;
  conversationId: string;
  source: KyrubCatalogDraftSource;
  items: KyrubCatalogDraftImportItem[];
  requiresConfirmation: true;
};

export type KyrubAiCreateProductProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.CREATE_PRODUCT;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  isService: boolean;
  isComplimentary: boolean;
  requiresConfirmation: true;
};

export type KyrubProductPatch = {
  name?: string;
};

export type KyrubAiUpdateProductProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.UPDATE_PRODUCT;
  productId: string;
  expectedCurrentName: string;
  patch: KyrubProductPatch;
  requiresConfirmation: true;
};

export type KyrubInventoryUnit = 'un' | 'kg' | 'g' | 'l' | 'ml';
export type KyrubInventoryAdjustmentMode = 'increment' | 'decrement' | 'set';
export type KyrubInventoryMovementKind = 'intake' | 'outflow' | 'loss' | 'correction';
export type KyrubInventoryAdjustmentSourceKind =
  | 'supplier_invoice'
  | 'inventory_intake_text'
  | 'manual_outflow'
  | 'loss_report'
  | 'physical_count';

export type KyrubInventoryAdjustmentEntry = {
  name: string;
  quantity: number;
  unit: KyrubInventoryUnit;
  purchaseCost?: number;
};

export type KyrubAiAdjustInventoryProposal = KyrubActionProposalMetadata & {
  id: string;
  type: typeof KYRUB_ACTION_TYPES.ADJUST_INVENTORY;
  mode: KyrubInventoryAdjustmentMode;
  movementKind?: KyrubInventoryMovementKind;
  entries: KyrubInventoryAdjustmentEntry[];
  source: {
    kind: KyrubInventoryAdjustmentSourceKind;
    label?: string;
  };
  requiresConfirmation: true;
};

export type KyrubActionProposal =
  | KyrubAiCreateNoteProposal
  | KyrubAiCreateTaskProposal
  | KyrubAiStartStoreActivationProposal
  | KyrubAiUpdateStoreProfileProposal
  | KyrubAiPrepareProductDraftProposal
  | KyrubAiImportCatalogDraftProposal
  | KyrubAiCreateProductProposal
  | KyrubAiUpdateProductProposal
  | KyrubAiAdjustInventoryProposal;

export type KyrubActionExecutionStatus =
  | 'success'
  | 'already_applied';

export type KyrubActionAuthorizationGrant = {
  id: string;
  scope: 'store_activation';
  expiresAt: string;
};

export type KyrubActionExecutionResult = {
  actionId: string;
  type: KyrubActionProposal['type'];
  status: KyrubActionExecutionStatus;
  entityId: string;
  origin: KyrubActionOrigin;
  idempotencyKey: string;
  executionEnvelope?: KyrubExecutionEnvelope;
  authorizationGrant?: KyrubActionAuthorizationGrant;
};
