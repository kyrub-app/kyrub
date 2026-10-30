/** Pure decision for racing Mercado Pago preapproval reservation completions. */
export type ReservationCompletion = 'write' | 'already-completed' | 'conflict';

export const decideReservationCompletion = (
  expectedReference: string,
  expectedProviderId: string,
  current: { billingReference?: unknown; checkoutReservationStatus?: unknown; providerSubscriptionId?: unknown }
): ReservationCompletion => {
  if (current.billingReference !== expectedReference) return 'conflict';
  if (current.checkoutReservationStatus === 'completed' &&
      current.providerSubscriptionId === expectedProviderId) return 'already-completed';
  if (current.checkoutReservationStatus !== 'pending') return 'conflict';
  return 'write';
};
