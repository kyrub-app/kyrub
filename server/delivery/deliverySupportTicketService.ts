import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { getCourierSupportReason } from '../../shared/deliverySupportReasons.js';

const DELIVERY_PATH = 'hub/renda/deliveries';
const CLAIM_PATH = 'deliveryClaims';
const TICKET_PATH = 'deliverySupportTickets';
const EVENT_PATH = 'deliverySupportTicketEvents';
const ADMIN_PATH = 'kyrub_admin/control_plane/admins';
const RATE_PATH = 'deliverySupportRateLimits';
const RATE_WINDOW_MS = 20_000;

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeId = (value: unknown): string => {
  const valueId = clean(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(valueId)) throw new Error('DELIVERY_SUPPORT_INVALID');
  return valueId;
};
const ticketId = (value: unknown): string => {
  const valueId = clean(value);
  if (!/^[A-Za-z0-9_-]{20,90}$/.test(valueId)) throw new Error('DELIVERY_SUPPORT_INVALID');
  return valueId;
};
const reportText = (value: unknown, mandatory = false): string => {
  const message = clean(value);
  if (message.length > 900 || (mandatory && message.length < 10)) {
    throw new Error('DELIVERY_SUPPORT_INVALID');
  }
  return message;
};
const isOperator = (profile: Record<string, unknown>, uid: string): boolean =>
  profile.uid === uid && profile.status === 'active'
  && ['super_admin','operations','compliance'].includes(clean(profile.role));

export const submitCourierSupportTicket = async (input: {
  deliveryId: string;
  courierId: string;
  ticketId: string;
  reasonCode: string;
  detail: string;
}): Promise<{ticketId: string; status: 'open'; priority: string}> => {
  const deliveryId = safeId(input.deliveryId);
  const courierId = safeId(input.courierId);
  const id = ticketId(input.ticketId);
  const detail = reportText(input.detail);
  const deliveryRef = adminDb.doc(`${DELIVERY_PATH}/${deliveryId}`);
  const claimRef = adminDb.doc(`${CLAIM_PATH}/${deliveryId}`);
  const ticketRef = adminDb.doc(`${TICKET_PATH}/${id}`);
  const rateRef = adminDb.doc(`${RATE_PATH}/${courierId}`);
  const eventRef = adminDb.collection(EVENT_PATH).doc();

  return adminDb.runTransaction(async transaction => {
    const [deliverySnap,claimSnap,ticketSnap,rateSnap] = await Promise.all([
      transaction.get(deliveryRef),transaction.get(claimRef),
      transaction.get(ticketRef),transaction.get(rateRef),
    ]);
    if (ticketSnap.exists) {
      const old = rec(ticketSnap.data());
      if (old.deliveryId === deliveryId && old.courierId === courierId
        && old.reasonCode === input.reasonCode && old.detail === detail) {
        return {ticketId:id,status:'open' as const,priority:clean(old.priority)};
      }
      throw new Error('DELIVERY_SUPPORT_CONFLICT');
    }
    const delivery = rec(deliverySnap.data());
    const claim = rec(claimSnap.data());
    if (!deliverySnap.exists || !claimSnap.exists ||
      delivery.acceptedBy !== courierId || claim.courierId !== courierId
      || delivery.source !== 'kyrub-order') {
      throw new Error('DELIVERY_SUPPORT_FORBIDDEN');
    }
    const stage = delivery.status;
    if (stage !== 'accepted' && stage !== 'delivering') {
      throw new Error('DELIVERY_SUPPORT_CONFLICT');
    }
    const reason = getCourierSupportReason(input.reasonCode,stage);
    if (!reason || (reason.code === 'other_issue' && detail.length < 10)) {
      throw new Error('DELIVERY_SUPPORT_INVALID');
    }
    const at = Timestamp.now();
    const lastAt = rec(rateSnap.data()).lastCreatedAt as Timestamp | undefined;
    if (reason.priority !== 'safety' && lastAt instanceof Timestamp
      && at.toMillis() - lastAt.toMillis() < RATE_WINDOW_MS) {
      throw new Error('DELIVERY_SUPPORT_RATE_LIMIT');
    }
    transaction.create(ticketRef,{
      schemaVersion:1,id,deliveryId,courierId,
      storeId:safeId(delivery.storeId),
      sourceOrderId:safeId(delivery.sourceOrderId),
      stage,reasonCode:reason.code,reasonLabel:reason.label,
      priority:reason.priority,group:reason.group,detail,
      status:'open',assignedTo:'',lastResponse:'',
      createdAt:at,updatedAt:at,respondedAt:null,resolvedAt:null,
      // Intentionally no GPS, exact address, phone or buyer PII.
      // This is NOT a cancellation or emergency-service dispatch.
    });
    transaction.create(eventRef,{
      schemaVersion:1,ticketId:id,deliveryId,
      actorId:courierId,actorType:'courier',
      action:'opened',reasonCode:reason.code,priority:reason.priority,
      createdAt:at,
    });
    if (reason.priority !== 'safety') {
      transaction.set(rateRef,{courierId,lastCreatedAt:at});
    }
    return {ticketId:id,status:'open' as const,priority:reason.priority};
  });
};

export const respondToCourierSupportTicket = async (input:{
  ticketId:string;
  operatorId:string;
  action:'take'|'reply'|'resolve';
  response:string;
}):Promise<{ticketId:string;status:'open'|'working'|'resolved'}>=>{
  const id=ticketId(input.ticketId);
  const operatorId=safeId(input.operatorId);
  const action=input.action;
  if (!['take','reply','resolve'].includes(action)) throw new Error('DELIVERY_SUPPORT_INVALID');
  const response=reportText(input.response,action!=='take');
  const operatorRef=adminDb.doc(`${ADMIN_PATH}/${operatorId}`);
  const ticketRef=adminDb.doc(`${TICKET_PATH}/${id}`);
  const eventRef=adminDb.collection(EVENT_PATH).doc();

  return adminDb.runTransaction(async transaction=>{
    const [operatorSnap,ticketSnap]=await Promise.all([
      transaction.get(operatorRef),transaction.get(ticketRef),
    ]);
    if (!isOperator(rec(operatorSnap.data()),operatorId)) {
      throw new Error('DELIVERY_SUPPORT_FORBIDDEN');
    }
    if (!ticketSnap.exists) throw new Error('DELIVERY_SUPPORT_CONFLICT');
    const ticket=rec(ticketSnap.data());
    if (ticket.status==='resolved') {
      if (action==='resolve' && ticket.lastResponse===response
        && ticket.assignedTo===operatorId) {
        return {ticketId:id,status:'resolved' as const};
      }
      throw new Error('DELIVERY_SUPPORT_CONFLICT');
    }
    if (ticket.status!=='open' && ticket.status!=='working') {
      throw new Error('DELIVERY_SUPPORT_CONFLICT');
    }
    if (action==='take' && ticket.assignedTo===operatorId
      && ticket.status==='working') {
      return {ticketId:id,status:'working' as const};
    }
    if (ticket.assignedTo && ticket.assignedTo!==operatorId && action!=='take') {
      throw new Error('DELIVERY_SUPPORT_CONFLICT');
    }
    const at=Timestamp.now();
    const nextStatus=action==='resolve'?'resolved' as const:'working' as const;
    transaction.update(ticketRef,{
      status:nextStatus,assignedTo:operatorId,updatedAt:at,
      ...(action==='take'?{}:{lastResponse:response,respondedAt:at}),
      ...(action==='resolve'?{resolvedAt:at}:{}),
    });
    transaction.create(eventRef,{
      schemaVersion:1,ticketId:id,deliveryId:ticket.deliveryId,
      actorId:operatorId,actorType:'admin',action,
      // Keep exact response readable in the private ticket, not the event.
      createdAt:at,
    });
    // Never cancel, free up a claimed parcel, mark delivered or change money.
    return {ticketId:id,status:nextStatus};
  });
};
