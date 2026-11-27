export type CourierActivityAlert = { id: string; status: 'accepted' | 'delivering' | 'done' };
/** Only server-controlled claim records are used. Never use public jobs or local state. */
export function projectCourierActivityAlert(id: string, raw: unknown, uid: string): CourierActivityAlert | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !uid || !raw || typeof raw !== 'object') return null;
  const claim = raw as Record<string, unknown>;
  if (claim.id !== id || claim.deliveryJobId !== id || claim.courierId !== uid) return null;
  const status = claim.status;
  if (status !== 'accepted' && status !== 'delivering' && status !== 'done') return null;
  return { id, status };
}
