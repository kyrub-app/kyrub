/**
 * Compatibility mount kept while App.tsx still references the historical CRM bridge.
 *
 * CRM is no longer injected into the PDV/Clientes DOM. The authoritative UI is
 * mounted by RetailerPanelRuntimeRouter as the direct `crm` management module,
 * reusing StoreCrmRelationshipPanel there.
 */
export const StoreCrmRelationshipBridge = () => null;
