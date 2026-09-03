export const KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT =
  'kyrub:physical-inventory-focus';

export type PhysicalInventoryFocusDetail = {
  inventoryItemId: string;
};

const clean = (value: string): string => value.trim();

export const physicalInventoryItemElementId = (inventoryItemId: string): string =>
  `kyrub-physical-inventory-item-${encodeURIComponent(clean(inventoryItemId))}`;

export const requestPhysicalInventoryFocus = (inventoryItemId: string): boolean => {
  const normalized = clean(inventoryItemId);
  if (!normalized) return false;
  window.dispatchEvent(new CustomEvent<PhysicalInventoryFocusDetail>(
    KYRUB_PHYSICAL_INVENTORY_FOCUS_EVENT,
    { detail: { inventoryItemId: normalized } }
  ));
  return true;
};
