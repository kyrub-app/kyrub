import { adminDb } from '../firebaseAdmin.js';
import {storeOrderDistributionEnabled} from '../../shared/storeOrderDistributionPolicy.js';
import { projectPublicDeliveryOpportunity } from '../../shared/publicDeliveryDiscovery.js';

/**
 * Auth-free, strictly allowlisted projection. The private deliveries
 * collection is NEVER made readable by a Firestore client rule.
 * Server-side payment, assignment and courier eligibility gates remain
 * unchanged. This endpoint cannot reserve or accept a job.
 */
export const listPublicDeliveryOpportunities = async () => {
  // This legacy projection only describes integrated store-order offers.
  if(!storeOrderDistributionEnabled())return {opportunities:[]};
  const snapshot = await adminDb
    .collection('hub/renda/deliveries')
    .where('status', '==', 'available')
    .limit(30)
    .get();

  const opportunities = snapshot.docs
    .map(document => projectPublicDeliveryOpportunity(document.id, document.data()))
    .filter((opportunity): opportunity is NonNullable<typeof opportunity> => opportunity !== null)
    .slice(0, 12);

  return { opportunities };
};
