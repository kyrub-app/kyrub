import type { KyrubActionAuthorizationGrant } from '../../shared/kyrubActions';

export type KyrubiaProductDraft = {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  category?: string;
  image?: string;
  isService?: boolean;
  isComplimentary?: boolean;
};

export type KyrubiaOperationalWorkflowStage =
  | 'awaiting_store_activation_confirmation'
  | 'collecting_store_name'
  | 'collecting_store_keywords'
  | 'collecting_product_name'
  | 'collecting_product_price'
  | 'collecting_product_category'
  | 'collecting_product_stock'
  | 'awaiting_product_confirmation';

export type KyrubiaOperationalWorkflow = {
  version: 1;
  conversationId: string;
  userId: string;
  objective: 'store_setup' | 'create_product';
  stage: KyrubiaOperationalWorkflowStage;
  productDraft: KyrubiaProductDraft;
  activationGrant?: KyrubActionAuthorizationGrant;
  updatedAt: string;
};

export const KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT =
  'kyrubia-operational-workflow-message';

export type KyrubiaOperationalWorkflowMessageDetail = {
  conversationId: string;
  message: string;
};

const keyFor = (userId: string, conversationId: string): string =>
  `kyrubia_operational_workflow_v1:${userId}:${conversationId}`;

const isProductDraft = (value: unknown): value is KyrubiaProductDraft =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isStage = (value: unknown): value is KyrubiaOperationalWorkflowStage =>
  value === 'awaiting_store_activation_confirmation' ||
  value === 'collecting_store_name' ||
  value === 'collecting_store_keywords' ||
  value === 'collecting_product_name' ||
  value === 'collecting_product_price' ||
  value === 'collecting_product_category' ||
  value === 'collecting_product_stock' ||
  value === 'awaiting_product_confirmation';

export const loadKyrubiaOperationalWorkflow = (
  storage: Storage,
  userId: string,
  conversationId: string
): KyrubiaOperationalWorkflow | null => {
  const raw = storage.getItem(keyFor(userId, conversationId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      parsed.conversationId !== conversationId ||
      (parsed.objective !== 'store_setup' && parsed.objective !== 'create_product') ||
      !isStage(parsed.stage) ||
      !isProductDraft(parsed.productDraft)
    ) {
      return null;
    }
    return parsed as unknown as KyrubiaOperationalWorkflow;
  } catch {
    return null;
  }
};

export const saveKyrubiaOperationalWorkflow = (
  storage: Storage,
  workflow: KyrubiaOperationalWorkflow
): void => {
  storage.setItem(
    keyFor(workflow.userId, workflow.conversationId),
    JSON.stringify({ ...workflow, updatedAt: new Date().toISOString() })
  );
};

export const clearKyrubiaOperationalWorkflow = (
  storage: Storage,
  userId: string,
  conversationId: string
): void => {
  storage.removeItem(keyFor(userId, conversationId));
};

export const authorizeKyrubiaStoreActivationWorkflow = (
  storage: Storage,
  userId: string,
  conversationId: string,
  grant: KyrubActionAuthorizationGrant
): KyrubiaOperationalWorkflow | null => {
  const workflow = loadKyrubiaOperationalWorkflow(
    storage,
    userId,
    conversationId
  );
  if (!workflow) return null;
  const next: KyrubiaOperationalWorkflow = {
    ...workflow,
    activationGrant: grant,
    stage: 'collecting_store_name',
    updatedAt: new Date().toISOString(),
  };
  saveKyrubiaOperationalWorkflow(storage, next);
  return next;
};

export const dispatchKyrubiaOperationalWorkflowMessage = (
  detail: KyrubiaOperationalWorkflowMessageDetail
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<KyrubiaOperationalWorkflowMessageDetail>(
      KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
      { detail }
    )
  );
};
