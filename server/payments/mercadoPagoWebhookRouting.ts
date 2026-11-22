// A bound merchant payment may have no actionable event (e.g. pending).
// Only absence of a binding permits legacy platform lookup; errors propagate.
export type MercadoPagoScopedWebhookResult<T> =
  | { kind: 'unbound' }
  | { kind: 'bound'; event: T | null };

export async function selectMercadoPagoWebhookEvent<T>(
  scoped: MercadoPagoScopedWebhookResult<T>,
  legacy: () => Promise<T | null>
): Promise<T | null> {
  if (scoped.kind === 'bound') return scoped.event;
  return legacy();
}
