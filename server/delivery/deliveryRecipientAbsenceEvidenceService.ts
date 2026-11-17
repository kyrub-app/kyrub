import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const validId = (v: unknown, maxLength=128): string => {
  const parsed = clean(v);
  if (!parsed || parsed.length>maxLength || !/^[a-zA-Z0-9_-]+$/.test(parsed)) {
    throw new Error('RECIPIENT_ABSENCE_INVALID');
  }
  return parsed;
};
const TICKETS='deliverySupportTickets';
const EVENTS='deliverySupportTicketEvents';
const DELIVERIES='hub/renda/deliveries';
const CLAIMS='deliveryClaims';

export type ContactMethod = 'called_recipient'|'messaged_recipient'|'tried_intercom'|'other_contact';
const METHODS:readonly ContactMethod[]=[
  'called_recipient','messaged_recipient','tried_intercom','other_contact',
];
export const MAX_DECLARED_CONTACT_ATTEMPTS=12;
export const RECIPIENT_WAIT_REFERENCE_MS=10*60_000;
// Time reference for the UI only. It NEVER authorizes return, cancellation,
// delivery completion, penalty or automatic paid waiting.

const validateActiveCourierAndArrival=(
  ticket:Record<string,unknown>,
  delivery:Record<string,unknown>,
  claim:Record<string,unknown>,
  courierId:string
):{arrivedAt:Timestamp;deliveryId:string}=>{
  const deliveryId=validId(ticket.deliveryId);
  const handoff=record(delivery.customerHandoff);
  const arrivedAt=handoff.arrivedAt;
  if(ticket.courierId!==courierId || claim.courierId!==courierId
    || delivery.acceptedBy!==courierId
    || ticket.reasonCode!=='recipient_not_found'
    || ticket.deliveryId!==delivery.id
    || delivery.source!=='kyrub-order'
    || delivery.status!=='delivering' || claim.status!=='delivering'
    || !['open','working'].includes(clean(ticket.status))
    || handoff.status!=='awaiting_buyer_confirmation'
    || handoff.arrivedByCourierId!==courierId || handoff.trackingWasActive!==true
    || !(arrivedAt instanceof Timestamp) || arrivedAt.toMillis()>Date.now()){
    throw new Error('RECIPIENT_ABSENCE_CONFLICT');
  }
  return {arrivedAt,deliveryId};
};

const validateCourierAndDelivery=async(
  transaction:FirebaseFirestore.Transaction,
  ticketRef:FirebaseFirestore.DocumentReference,
  courierId:string
)=>{
  const ticket=await transaction.get(ticketRef);
  if(!ticket.exists)throw new Error('RECIPIENT_ABSENCE_CONFLICT');
  const ticketData=record(ticket.data());
  if(ticketData.courierId!==courierId)throw new Error('RECIPIENT_ABSENCE_FORBIDDEN');
  const deliveryId=validId(ticketData.deliveryId);
  const deliveryRef=adminDb.doc(`${DELIVERIES}/${deliveryId}`);
  const claimRef=adminDb.doc(`${CLAIMS}/${deliveryId}`);
  const [delivery,claim]=await Promise.all([transaction.get(deliveryRef),transaction.get(claimRef)]);
  if(!delivery.exists || !claim.exists)throw new Error('RECIPIENT_ABSENCE_CONFLICT');
  const arrival=validateActiveCourierAndArrival(ticketData,record(delivery.data()),
    record(claim.data()),courierId);
  return {ticketData,deliveryId,arrival};
};

export const declareRecipientContactAttempt=async(input:{
  ticketId:string;courierId:string;attemptId:string;method:ContactMethod;
}):Promise<{ticketId:string;attempts:number;arrivedAtEpochMs:number;status:'recorded'}>=>{
  const ticketId=validId(input.ticketId,90);
  const courierId=validId(input.courierId);
  const attemptId=validId(input.attemptId,80);
  const method=input.method;
  if(!METHODS.includes(method))throw new Error('RECIPIENT_ABSENCE_INVALID');
  const ticketRef=adminDb.doc(`${TICKETS}/${ticketId}`);
  const eventRef=adminDb.doc(`${EVENTS}/${ticketId}_contact_${attemptId}`);
  return adminDb.runTransaction(async transaction=>{
    const event=await transaction.get(eventRef);
    if(event.exists){
      const old=record(event.data());
      if(old.actorId!==courierId || old.ticketId!==ticketId || old.method!==method
        || old.action!=='contact_attempt_declared'){
        throw new Error('RECIPIENT_ABSENCE_CONFLICT');
      }
      const oldArrived=old.arrivedAt as Timestamp|undefined;
      return {ticketId,attempts:Number(old.contactAttemptsCount)||1,
        arrivedAtEpochMs:oldArrived?.toMillis()??0,status:'recorded' as const};
    }
    const {ticketData,deliveryId,arrival}=await validateCourierAndDelivery(
      transaction,ticketRef,courierId
    );
    const prior=Number(ticketData.contactAttemptsCount??0);
    if(!Number.isSafeInteger(prior) || prior<0 || prior>=MAX_DECLARED_CONTACT_ATTEMPTS){
      throw new Error('RECIPIENT_ABSENCE_LIMIT');
    }
    const at=Timestamp.now();
    const attempts=prior+1;
    transaction.create(eventRef,{
      schemaVersion:1,ticketId,deliveryId,actorId:courierId,
      actorType:'courier',action:'contact_attempt_declared',method,
      contactAttemptsCount:attempts,arrivedAt:arrival.arrivedAt,createdAt:at,
      evidenceLevel:'courier_self_declared',
      // No phone number, message contents or location coordinates.
    });
    transaction.update(ticketRef,{
      contactAttemptsCount:attempts,lastContactAttemptAt:at,
      recipientArrivedAt:arrival.arrivedAt,
      updatedAt:at,
    });
    return {ticketId,attempts,arrivedAtEpochMs:arrival.arrivedAt.toMillis(),
      status:'recorded' as const};
  });
};

export const requestRecipientAbsenceReview=async(input:{
  ticketId:string;courierId:string;
}):Promise<{ticketId:string;status:'review_requested';elapsedMs:number;attempts:number}>=>{
  const ticketId=validId(input.ticketId,90);
  const courierId=validId(input.courierId);
  const ticketRef=adminDb.doc(`${TICKETS}/${ticketId}`);
  const eventRef=adminDb.doc(`${EVENTS}/${ticketId}_review_requested`);
  return adminDb.runTransaction(async transaction=>{
    const {ticketData,deliveryId,arrival}=await validateCourierAndDelivery(
      transaction,ticketRef,courierId
    );
    const attempts=Number(ticketData.contactAttemptsCount??0);
    if(!Number.isSafeInteger(attempts)||attempts<1){
      throw new Error('RECIPIENT_ABSENCE_CONTACT_REQUIRED');
    }
    const prior=await transaction.get(eventRef);
    const at=Timestamp.now();
    if(prior.exists){
      const old=record(prior.data());
      if(old.actorId!==courierId || old.ticketId!==ticketId){
        throw new Error('RECIPIENT_ABSENCE_CONFLICT');
      }
      return {ticketId,status:'review_requested' as const,
        elapsedMs:Math.max(0,at.toMillis()-arrival.arrivedAt.toMillis()),attempts};
    }
    transaction.create(eventRef,{
      schemaVersion:1,ticketId,deliveryId,actorId:courierId,
      actorType:'courier',action:'recipient_absence_review_requested',
      declaredContactAttempts:attempts,arrivedAt:arrival.arrivedAt,
      elapsedAtRequestMs:Math.max(0,at.toMillis()-arrival.arrivedAt.toMillis()),
      createdAt:at,evidenceLevel:'courier_self_declared',
    });
    transaction.update(ticketRef,{
      recipientAbsenceReviewRequestedAt:at,
      recipientArrivedAt:arrival.arrivedAt,
      updatedAt:at,
    });
    // No return label, no reoffer, no cancellation or economic mutation.
    return {ticketId,status:'review_requested' as const,
      elapsedMs:Math.max(0,at.toMillis()-arrival.arrivedAt.toMillis()),attempts};
  });
};
