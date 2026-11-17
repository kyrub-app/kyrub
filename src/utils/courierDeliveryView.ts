import type { DeliveryJob } from '../types';

type OperationalDelivery = DeliveryJob & { source?: string };

export const isCanonicalCourierDelivery = (job: DeliveryJob): boolean =>
  (job as OperationalDelivery).source === 'kyrub-order';

export const isAvailableCourierOffer = (job: DeliveryJob): boolean =>
  isCanonicalCourierDelivery(job) && job.status === 'available';

export const isAssignedCourierDelivery = (
  job: DeliveryJob,
  courierUid: string | undefined
): boolean =>
  Boolean(courierUid)
  && isCanonicalCourierDelivery(job)
  && job.acceptedBy === courierUid;
