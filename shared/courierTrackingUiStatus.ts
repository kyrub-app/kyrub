/**
 * Device-side indication, not a substitute for the server's authorized
 * GET /api/delivery-tracking/:deliveryId/location decision.
 * A successful location POST is historical evidence, not proof that a
 * recipient currently sees an active position.
 */
export const COURIER_TRACKING_UI_FRESH_MS = 90_000 as const;

export type CourierTrackingUiState = 'off' | 'waiting' | 'recent' | 'interrupted' | 'stale';

export const courierTrackingUiState = (input: {
  selected: boolean;
  lastConfirmedAtMs: number | null;
  hasIssue: boolean;
  nowMs: number;
}): CourierTrackingUiState => {
  if (!input.selected) return 'off';
  if (input.hasIssue) return 'interrupted';
  const at = input.lastConfirmedAtMs;
  if (at === null || !Number.isFinite(at) || at <= 0
    || !Number.isFinite(input.nowMs) || at > input.nowMs) return 'waiting';
  return input.nowMs - at <= COURIER_TRACKING_UI_FRESH_MS ? 'recent' : 'stale';
};
