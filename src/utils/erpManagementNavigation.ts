export const KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT =
  'kyrub:erp-management-navigation';

export type ErpManagementModule =
  | 'produtos'
  | 'vendas'
  | 'financeiro'
  | 'rh'
  | 'crm'
  | 'marketing'
  | 'integracoes'
  | 'vouchers';

export type ErpManagementNavigationRequest = {
  module: ErpManagementModule | null;
};

// A management selection can be committed immediately after the native mobile
// dialog closes, before RetailerPanelRuntimeRouter has installed its effect
// listener. Keep exactly one in-memory request so that first mount cannot lose
// the user's navigation intent. It is deliberately not persisted across reloads.
let pendingNavigationRequest: ErpManagementNavigationRequest | undefined;

export const consumePendingErpManagementNavigation = ():
  | ErpManagementNavigationRequest
  | undefined => {
  const pending = pendingNavigationRequest;
  pendingNavigationRequest = undefined;
  return pending;
};

export const requestErpManagementNavigation = (
  module: ErpManagementModule | null
): void => {
  if (typeof window === 'undefined') return;

  const request: ErpManagementNavigationRequest = { module };
  pendingNavigationRequest = request;

  window.dispatchEvent(
    new CustomEvent<ErpManagementNavigationRequest>(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      { detail: request }
    )
  );
};
