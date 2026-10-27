/** Classifies a CRM identifier without treating an external buyer as a Kyrub account. */
export const classifyCrmCustomerIdentity = (customerId: string): { label: string; canUseKyrubChat: boolean } => {
  const id = customerId.trim().toLowerCase();
  if (!id || id.startsWith('local-order:')) return { label: 'Origem não identificada', canUseKyrubChat: false };
  if (id.startsWith('99food:')) return { label: '99Food', canUseKyrubChat: false };
  if (id.startsWith('mercadolivre:') || id.startsWith('mercado-livre:') || id.startsWith('meli:')) return { label: 'Mercado Livre', canUseKyrubChat: false };
  if (id.startsWith('ifood:')) return { label: 'iFood', canUseKyrubChat: false };
  if (id.startsWith('presencial:') || id.startsWith('pos:')) return { label: 'Presencial', canUseKyrubChat: false };
  // Unknown namespaced identifiers are not authenticated Kyrub users.
  if (id.includes(':')) return { label: 'Origem não identificada', canUseKyrubChat: false };
  return { label: 'Kyrub', canUseKyrubChat: true };
};
