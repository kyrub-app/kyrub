import {
  KYRUB_ACTION_REGISTRY,
  type KyrubActiveActionType,
  type KyrubActionRisk,
} from './kyrubActions';

export type KyrubAutonomyLevel = 1 | 2 | 3 | 4;
export type KyrubAutonomyDomain =
  | 'knowledge'
  | 'productivity'
  | 'store'
  | 'catalog'
  | 'inventory'
  | 'orders'
  | 'financial';

export type KyrubAutonomyDefinition = {
  actionType: KyrubActiveActionType;
  domain: KyrubAutonomyDomain;
  risk: KyrubActionRisk;
  maximumLevel: KyrubAutonomyLevel;
  featureFlag: string;
};

export type KyrubAutonomyRuntimeControls = {
  globalKillSwitch?: boolean;
  domainKillSwitches?: Partial<Record<KyrubAutonomyDomain, boolean>>;
  actionKillSwitches?: Partial<Record<KyrubActiveActionType, boolean>>;
  featureFlags?: Record<string, boolean>;
};

export type KyrubAutonomyDecisionReason =
  | 'GLOBAL_KILL_SWITCH'
  | 'DOMAIN_KILL_SWITCH'
  | 'ACTION_KILL_SWITCH'
  | 'FEATURE_DISABLED'
  | 'LEVEL_EXCEEDED';

export type KyrubAutonomyDecision = {
  allowed: boolean;
  actionType: KyrubActiveActionType;
  domain: KyrubAutonomyDomain;
  requestedLevel: KyrubAutonomyLevel;
  maximumLevel: KyrubAutonomyLevel;
  reasons: KyrubAutonomyDecisionReason[];
};

const define = (
  actionType: KyrubActiveActionType,
  domain: KyrubAutonomyDomain,
  maximumLevel: KyrubAutonomyLevel
): KyrubAutonomyDefinition => ({
  actionType,
  domain,
  risk: KYRUB_ACTION_REGISTRY[actionType].risk,
  maximumLevel,
  featureFlag: `kyrubia.autonomy.${actionType}`,
});

export const KYRUB_AUTONOMY_REGISTRY: Record<
  KyrubActiveActionType,
  KyrubAutonomyDefinition
> = {
  create_note: define('create_note', 'productivity', 4),
  create_task: define('create_task', 'productivity', 4),
  start_store_activation: define('start_store_activation', 'store', 3),
  update_store_profile: define('update_store_profile', 'store', 3),
  prepare_product_draft: define('prepare_product_draft', 'catalog', 4),
  import_catalog_draft: define('import_catalog_draft', 'catalog', 3),
  create_product: define('create_product', 'catalog', 3),
  update_product: define('update_product', 'catalog', 3),
  set_product_publication: define('set_product_publication', 'catalog', 3),
  adjust_inventory: define('adjust_inventory', 'inventory', 3),
  set_product_composition: define('set_product_composition', 'inventory', 3),
  update_order_status: define('update_order_status', 'orders', 3),
  read_store_summary: define('read_store_summary', 'knowledge', 4),
  list_products: define('list_products', 'knowledge', 4),
  list_low_stock_products: define('list_low_stock_products', 'knowledge', 4),
  list_pending_orders: define('list_pending_orders', 'knowledge', 4),
};

export const evaluateKyrubAutonomy = (
  actionType: KyrubActiveActionType,
  requestedLevel: KyrubAutonomyLevel,
  controls: KyrubAutonomyRuntimeControls = {}
): KyrubAutonomyDecision => {
  const definition = KYRUB_AUTONOMY_REGISTRY[actionType];
  const reasons: KyrubAutonomyDecisionReason[] = [];

  // Kill switches intentionally dominate every other condition.
  if (controls.globalKillSwitch === true) reasons.push('GLOBAL_KILL_SWITCH');
  if (controls.domainKillSwitches?.[definition.domain] === true) {
    reasons.push('DOMAIN_KILL_SWITCH');
  }
  if (controls.actionKillSwitches?.[actionType] === true) {
    reasons.push('ACTION_KILL_SWITCH');
  }
  if (controls.featureFlags?.[definition.featureFlag] === false) {
    reasons.push('FEATURE_DISABLED');
  }
  if (requestedLevel > definition.maximumLevel) reasons.push('LEVEL_EXCEEDED');

  return {
    allowed: reasons.length === 0,
    actionType,
    domain: definition.domain,
    requestedLevel,
    maximumLevel: definition.maximumLevel,
    reasons,
  };
};
