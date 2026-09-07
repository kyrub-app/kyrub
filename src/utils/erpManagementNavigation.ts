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

export const requestErpManagementNavigation = (
  module: ErpManagementModule | null
): void => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<ErpManagementNavigationRequest>(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      { detail: { module } }
    )
  );
};
