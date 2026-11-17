import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  classifyDeliveryReturnLiability,
  validateDeliveryReturnLiabilityJustification,
  DELIVERY_RETURN_LIABILITY_POLICY_ID,
  DELIVERY_RETURN_LIABILITY_POLICY_VERSION,
  type DeliveryReturnLiabilityCause,
} from '../../shared/deliveryReturnLiabilityPolicy.js';

const REVIEWS = 'deliveryReturnLiabilityReviews';
const EVENTS = 'deliveryReturnLiabilityReviewEvents';
const ADMINS = 'kyrub_admin/control_plane/admins';
const DELIVERIES = 'hub/renda/deliveries';
const clean = (v:unknown):string => typeof v==='string'?v.trim():'';
const obj = (v:unknown):Record<string,unknown> =>
  v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const safeId = (v:unknown):string => {
  const value=clean(v);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('DELIVERY_RETURN_LIABILITY_INVALID');
  return value;
};
const allowedAdmin = (profile:Record<string,unknown>,uid:string):boolean =>
  profile.uid===uid && profile.status==='active'
  && ['super_admin','operations','finance','compliance'].includes(clean(profile.role));
const receiptFingerprint = (deliveryId:string, protocol:Record<string,unknown>):string => {
  const at = protocol.receivedByStoreAt;
  if (!(at instanceof Timestamp)) throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
  return createHash('sha256').update(JSON.stringify({
    deliveryId,
    ticketId:protocol.ticketId,
    orderId:protocol.orderId,
    storeId:protocol.storeId,
    courierId:protocol.courierId,
    receivedCondition:protocol.receivedCondition,
    receivedByStoreId:protocol.receivedByStoreId,
    receivedByStoreAtMs:at.toMillis(),
  })).digest('hex');
};
const ensureCustody = (
  deliveryId:string,
  protocol:Record<string,unknown>,
  delivery:Record<string,unknown>,
  claim:Record<string,unknown>,
  completionExists:boolean
):string=>{
  const courierId=safeId(protocol.courierId);
  if (protocol.status!=='returned_to_store_pending_reconciliation'
    || protocol.financialStatus!=='awaiting_independent_reconciliation'
    || !['intact','damaged','disputed'].includes(clean(protocol.receivedCondition))
    || protocol.receivedByStoreId!==protocol.storeId || !protocol.receivedByStoreAt
    || delivery.id!==deliveryId || delivery.source!=='kyrub-order'
    || delivery.status!=='returned_to_store' || claim.status!=='returned_to_store'
    || delivery.storeId!==protocol.storeId || delivery.sourceOrderId!==protocol.orderId
    || delivery.acceptedBy!==courierId || claim.courierId!==courierId
    || completionExists) throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
  return courierId;
};
const reviewSnapshot = async (
  tx: FirebaseFirestore.Transaction,
  deliveryId: string,
  operatorId: string
): Promise<{protocol:Record<string,unknown>; fingerprint:string}> => {
  const [admin,protocolSnap,deliverySnap,claimSnap,completionSnap]=await Promise.all([
    tx.get(adminDb.doc(ADMINS+'/'+operatorId)),
    tx.get(adminDb.doc('deliveryReturnProtocols/'+deliveryId)),
    tx.get(adminDb.doc(DELIVERIES+'/'+deliveryId)),
    tx.get(adminDb.doc('deliveryClaims/'+deliveryId)),
    tx.get(adminDb.doc('deliveryCompletions/'+deliveryId)),
  ]);
  if (!allowedAdmin(obj(admin.data()),operatorId)) throw new Error('DELIVERY_RETURN_LIABILITY_FORBIDDEN');
  const protocol=obj(protocolSnap.data());
  if (!protocolSnap.exists || !deliverySnap.exists || !claimSnap.exists) {
    throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
  }
  const courier=ensureCustody(deliveryId,protocol,obj(deliverySnap.data()),
    obj(claimSnap.data()),completionSnap.exists);
  if (operatorId===courier || operatorId===protocol.storeId) {
    throw new Error('DELIVERY_RETURN_LIABILITY_FORBIDDEN');
  }
  const orderSnap=await tx.get(adminDb.doc(
    'artifacts/'+safeId(protocol.storeId)+'/public/data/customerOrders/'+safeId(protocol.orderId)));
  const order=obj(orderSnap.data());
  if (!orderSnap.exists || order.deliveryProvider!=='kyrub'
    || order.returnCustody && obj(order.returnCustody).status!=='received_by_store_pending_financial_review') {
    throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
  }
  return {protocol,fingerprint:receiptFingerprint(deliveryId,protocol)};
};

export type ReturnLiabilityReviewDTO={
  deliveryId:string;
  status:'not_classified'|'awaiting_independent_review'|'needs_more_evidence'|'approved_no_financial_execution';
  cause?:DeliveryReturnLiabilityCause;
  initialFunding?:string;
  damageReviewRequired?:boolean;
  proposedBy?:string;
  reviewerId?:string;
  justification?:string;
  reviewReason?:string;
  revision?:number;
  financialExecutionAuthorized:false;
};

const publicProjection=(deliveryId:string, raw:Record<string,unknown>):ReturnLiabilityReviewDTO =>
  raw.status ? {
    deliveryId,
    status:raw.status as ReturnLiabilityReviewDTO['status'],
    cause:raw.cause as DeliveryReturnLiabilityCause,
    initialFunding:clean(raw.initialFunding),
    damageReviewRequired:raw.damageReviewRequired===true,
    proposedBy:clean(raw.proposedBy),
    reviewerId:clean(raw.reviewerId),
    justification:clean(raw.justification),
    reviewReason:clean(raw.reviewReason),
    revision:Number(raw.revision)||1,
    financialExecutionAuthorized:false,
  } : {deliveryId,status:'not_classified',financialExecutionAuthorized:false};

export const getDeliveryReturnLiabilityReview=async(input:{
  deliveryId:string;operatorId:string;
}):Promise<ReturnLiabilityReviewDTO>=>{
  const deliveryId=safeId(input.deliveryId),operatorId=safeId(input.operatorId);
  const [admin,protocol,review]=await Promise.all([
    adminDb.doc(ADMINS+'/'+operatorId).get(),
    adminDb.doc('deliveryReturnProtocols/'+deliveryId).get(),
    adminDb.doc(REVIEWS+'/'+deliveryId).get(),
  ]);
  if (!allowedAdmin(obj(admin.data()),operatorId)) throw new Error('DELIVERY_RETURN_LIABILITY_FORBIDDEN');
  if (!protocol.exists || protocol.data()?.status!=='returned_to_store_pending_reconciliation') {
    throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
  }
  return publicProjection(deliveryId,obj(review.data()));
};

export const proposeDeliveryReturnLiabilityReview=async(input:{
  deliveryId:string;operatorId:string;cause:unknown;justification:unknown;
}):Promise<ReturnLiabilityReviewDTO>=>{
  const deliveryId=safeId(input.deliveryId),operatorId=safeId(input.operatorId);
  const justification=validateDeliveryReturnLiabilityJustification(input.justification);
  const ref=adminDb.doc(REVIEWS+'/'+deliveryId);
  const eventRef=adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async tx=>{
    const {protocol,fingerprint}=await reviewSnapshot(tx,deliveryId,operatorId);
    const classification=classifyDeliveryReturnLiability({
      cause:input.cause,receivedCondition:protocol.receivedCondition,
    });
    const priorSnap=await tx.get(ref);
    const prior=obj(priorSnap.data());
    if (priorSnap.exists) {
      if (prior.status==='awaiting_independent_review'
        && prior.proposedBy===operatorId && prior.justification===justification
        && prior.cause===classification.cause && prior.receiptFingerprint===fingerprint) {
        return publicProjection(deliveryId,prior);
      }
      if (prior.status!=='needs_more_evidence' || Number(prior.revision)>=10) {
        throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
      }
    }
    const now=Timestamp.now();
    const revision=priorSnap.exists ? Number(prior.revision)+1 : 1;
    const proposal={
      schemaVersion:1,deliveryId,
      policyId:DELIVERY_RETURN_LIABILITY_POLICY_ID,
      policyVersion:DELIVERY_RETURN_LIABILITY_POLICY_VERSION,
      revision,receiptFingerprint:fingerprint,
      cause:classification.cause,initialFunding:classification.initialFunding,
      damageReviewRequired:classification.damageReviewRequired,
      recoverFromBuyer:false,deductFromCourier:false,financialExecutionAuthorized:false,
      status:'awaiting_independent_review',proposedBy:operatorId,
      justification,reviewerId:'',reviewReason:'',proposedAt:now,
      reviewedAt:null,updatedAt:now,
    };
    if (priorSnap.exists) tx.update(ref,proposal); else tx.create(ref,proposal);
    tx.create(eventRef,{
      schemaVersion:1,deliveryId,revision,action:'proposal_created',
      actorId:operatorId,cause:classification.cause,
      initialFunding:classification.initialFunding,
      receiptFingerprint:fingerprint,at:now,
    });
    return publicProjection(deliveryId,proposal);
  });
};

export const reviewDeliveryReturnLiability=async(input:{
  deliveryId:string;reviewerId:string;decision:'approve'|'request_evidence';reviewReason:unknown;
}):Promise<ReturnLiabilityReviewDTO>=>{
  const deliveryId=safeId(input.deliveryId),reviewerId=safeId(input.reviewerId);
  const reviewReason=validateDeliveryReturnLiabilityJustification(input.reviewReason);
  if (!['approve','request_evidence'].includes(input.decision)) {
    throw new Error('DELIVERY_RETURN_LIABILITY_INVALID');
  }
  const ref=adminDb.doc(REVIEWS+'/'+deliveryId);
  const eventRef=adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async tx=>{
    const {protocol,fingerprint}=await reviewSnapshot(tx,deliveryId,reviewerId);
    const snap=await tx.get(ref);
    const prior=obj(snap.data());
    if (!snap.exists) throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
    if (reviewerId===prior.proposedBy) throw new Error('DELIVERY_RETURN_LIABILITY_FORBIDDEN');
    const targetStatus=input.decision==='approve'
      ?'approved_no_financial_execution':'needs_more_evidence';
    if (prior.status===targetStatus && prior.reviewerId===reviewerId
      && prior.reviewReason===reviewReason) return publicProjection(deliveryId,prior);
    if (prior.status!=='awaiting_independent_review'
      || prior.receiptFingerprint!==fingerprint
      || prior.policyId!==DELIVERY_RETURN_LIABILITY_POLICY_ID
      || prior.policyVersion!==DELIVERY_RETURN_LIABILITY_POLICY_VERSION) {
      throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
    }
    const expected=classifyDeliveryReturnLiability({
      cause:prior.cause,receivedCondition:protocol.receivedCondition,
    });
    if (expected.initialFunding!==prior.initialFunding
      || expected.damageReviewRequired!==prior.damageReviewRequired) {
      throw new Error('DELIVERY_RETURN_LIABILITY_CONFLICT');
    }
    const now=Timestamp.now();
    const changes={status:targetStatus,reviewerId,reviewReason,reviewedAt:now,updatedAt:now};
    tx.update(ref,changes);
    tx.create(eventRef,{
      schemaVersion:1,deliveryId,revision:prior.revision,
      action:input.decision==='approve'?'independently_reviewed':'more_evidence_requested',
      actorId:reviewerId,cause:prior.cause,initialFunding:prior.initialFunding,
      receiptFingerprint:fingerprint,at:now,
    });
    return publicProjection(deliveryId,{...prior,...changes});
  });
};
