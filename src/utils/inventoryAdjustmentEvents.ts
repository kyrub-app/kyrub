import type {
  KyrubActionExecutionStatus,
  KyrubActionOrigin,
} from '../../shared/kyrubActions';

export const KYRUB_INVENTORY_ADJUSTMENT_CONFIRMED_EVENT =
  'kyrub-inventory-adjustment-confirmed';

export type KyrubInventoryAdjustmentConfirmedDetail = {
  actorUid: string;
  actionId: string;
  entityId: string;
  origin: KyrubActionOrigin;
  status: KyrubActionExecutionStatus;
};

export const emitKyrubInventoryAdjustmentConfirmed = (
  detail: KyrubInventoryAdjustmentConfirmedDetail
): void => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<KyrubInventoryAdjustmentConfirmedDetail>(
      KYRUB_INVENTORY_ADJUSTMENT_CONFIRMED_EVENT,
      { detail }
    )
  );
};
