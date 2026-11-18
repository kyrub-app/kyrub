/**
 * Public delivery discovery is a preview only, never an entitlement, an
 * accepted courier contract, or a copy of the private delivery document.
 * Do not add pickup/destination, phone, buyer, recipient, GPS or money here.
 */
export interface PublicDeliveryOpportunity {
  id: string;
  label: 'Entrega Kyrub disponível';
}

export const projectPublicDeliveryOpportunity = (
  id: string,
  value: unknown
): PublicDeliveryOpportunity | null => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const delivery = value as Record<string, unknown>;
  if (delivery.source !== 'kyrub-order' || delivery.status !== 'available') {
    return null;
  }
  if (typeof delivery.acceptedBy === 'string' && delivery.acceptedBy.trim()) {
    return null;
  }
  return { id, label: 'Entrega Kyrub disponível' };
};
