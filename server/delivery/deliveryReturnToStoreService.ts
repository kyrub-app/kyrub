import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { isFreshCourierTrackingTimestamp } from './courierTrackingFreshness.js';

const clean=(v:unknown):string=>typeof v==='string'?v.trim():'';
const obj=(v:unknown):Record<string,unknown> =>
  v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const safeId=(v:unknown):string=>{
  const id=clean(v);
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('DELIVERY_RETURN_INVALID');
  return id;
};
const reasonText=(v:unknown):string=>{
  const s=clean(v);
  if(s.length<10 || s.length>500)throw new Error('DELIVERY_RETURN_INVALID');
  return s;
};
const protocols='deliveryReturnProtocols';
const events='deliveryReturnEvents';
const deliverables='hub/renda/deliveries';
const claims='deliveryClaims';
const tracking='deliveryTracking';
const completions='deliveryCompletions';
const offers='hub/renda/deliveryOffers';
const ticketCollection='deliverySupportTickets';
const adminCollection='kyrub_admin/control_plane/admins';

type ReturnStatus='return_authorized'|'courier_presented_to_store'|
 'returned_to_store_pending_reconciliation'|'authorization_revoked';
export const RETURN_POLICY_REFERENCE='manual_operator_review_no_auto_refund' as const;

const checkOngoing=(delivery:Record<string,unknown>,claim:Record<string,unknown>,
  completionExists:boolean,courierId:string):void=>{
  if(delivery.source!=='kyrub-order' || delivery.status!=='delivering'
    || claim.status!=='delivering'
    || delivery.acceptedBy!==courierId || claim.courierId!==courierId
    || !delivery.collectedAt || completionExists) {
    throw new Error('DELIVERY_RETURN_CONFLICT');
  }
};

const operatorAuthorized=(admin:Record<string,unknown>,id:string):boolean=>
  admin.uid===id && admin.status==='active'
  && ['super_admin','operations','compliance'].includes(clean(admin.role));

const timestampIsFresh=(value:unknown):boolean=>
  isFreshCourierTrackingTimestamp(value);

export const authorizeRecipientAbsenceReturn=async(input:{
  ticketId:string;operatorId:string;reason:string;
}):Promise<{deliveryId:string;status:ReturnStatus}>=>{
  const ticketId=safeId(input.ticketId);
  const operatorId=safeId(input.operatorId);
  const explanation=reasonText(input.reason);
  const ticketRef=adminDb.doc(`${ticketCollection}/${ticketId}`);
  const adminRef=adminDb.doc(`${adminCollection}/${operatorId}`);
  const eventRef=adminDb.collection(events).doc();
  return adminDb.runTransaction(async tx=>{
    const [ticketSnap,adminSnap]=await Promise.all([
      tx.get(ticketRef),tx.get(adminRef),
    ]);
    if(!operatorAuthorized(obj(adminSnap.data()),operatorId)){
      throw new Error('DELIVERY_RETURN_FORBIDDEN');
    }
    const ticket=obj(ticketSnap.data());
    if(!ticketSnap.exists || ticket.reasonCode!=='recipient_not_found'
      || !['open','working'].includes(clean(ticket.status))
      || ticket.assignedTo!==operatorId
      || !ticket.recipientAbsenceReviewRequestedAt
      || !Number.isSafeInteger(ticket.contactAttemptsCount)
      || Number(ticket.contactAttemptsCount)<1){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const deliveryId=safeId(ticket.deliveryId);
    const deliveryRef=adminDb.doc(`${deliverables}/${deliveryId}`);
    const claimRef=adminDb.doc(`${claims}/${deliveryId}`);
    const completionRef=adminDb.doc(`${completions}/${deliveryId}`);
    const returnRef=adminDb.doc(`${protocols}/${deliveryId}`);
    const transferRef=adminDb.doc(`deliveryCustodyTransfers/${deliveryId}`);
    const [deliverySnap,claimSnap,completionSnap,returnSnap,transferSnap]=await Promise.all([
      tx.get(deliveryRef),tx.get(claimRef),tx.get(completionRef),
      tx.get(returnRef),tx.get(transferRef),
    ]);
    const delivery=obj(deliverySnap.data());
    const claim=obj(claimSnap.data());
    const courierId=safeId(ticket.courierId);
    if(transferSnap.exists)throw new Error('DELIVERY_RETURN_CONFLICT');
    if(ticket.storeId!==delivery.storeId
      || ticket.sourceOrderId!==delivery.sourceOrderId
      || ticket.courierId!==delivery.acceptedBy){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    if(returnSnap.exists){
      const existing=obj(returnSnap.data());
      if(existing.status==='return_authorized'
        && existing.ticketId===ticketId && existing.operatorId===operatorId
        && existing.reason===explanation){
        return {deliveryId,status:'return_authorized' as const};
      }
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    checkOngoing(delivery,claim,completionSnap.exists,courierId);
    const customerHandoff=obj(delivery.customerHandoff);
    if(customerHandoff.status!=='awaiting_buyer_confirmation'
      || customerHandoff.arrivedByCourierId!==courierId
      || !customerHandoff.arrivedAt){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const orderId=safeId(delivery.sourceOrderId);
    const storeId=safeId(delivery.storeId);
    const orderSnap=await tx.get(adminDb.doc(
      `artifacts/${storeId}/public/data/customerOrders/${orderId}`));
    if(!orderSnap.exists || orderSnap.data()?.status!=='out_for_delivery'
      || orderSnap.data()?.buyerId!==delivery.buyerId){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const at=Timestamp.now();
    const corroboration=obj(customerHandoff.arrivalCorroboration);
    const arrivedAt=customerHandoff.arrivedAt;
    const geoAt=corroboration.evaluatedAt;
    const recipientWaitingCorroboratedInterval =
      arrivedAt instanceof Timestamp && geoAt instanceof Timestamp
      && ticket.recipientArrivedAt instanceof Timestamp
      && ticket.recipientArrivedAt.toMillis()===arrivedAt.toMillis()
      && corroboration.source==='server_customer_geofence'
      && corroboration.verified===true
      && Math.abs(arrivedAt.toMillis()-geoAt.toMillis())<=90_000
      && at.toMillis()>=arrivedAt.toMillis()
      ? {
          source:'corroborated_server_interval' as const,
          verified:true,
          arrivedAt:arrivedAt.toDate().toISOString(),
          returnAuthorizedAt:at.toDate().toISOString(),
          evidenceRef:'hub/renda/deliveries/'+deliveryId+':customerHandoff',
          // A server-evaluated geofence corroborates location, not contact.
        }
      : null;
    tx.create(returnRef,{
      schemaVersion:1,deliveryId,ticketId,storeId,orderId,courierId,
      recipientWaitingCorroboratedInterval,
      operatorId,reason:explanation,
      status:'return_authorized',authorizedAt:at,
      courierPresentedAt:null,receivedByStoreAt:null,receivedByStoreId:'',
      revokedAt:null,policyReference:RETURN_POLICY_REFERENCE,
      financialStatus:'awaiting_independent_reconciliation',
      updatedAt:at,
    });
    tx.update(deliveryRef,{
      returnCustody:{status:'return_authorized',source:'supervised_kyrub_return'},
      updatedAt:at,
    });
    tx.create(eventRef,{
      schemaVersion:1,deliveryId,ticketId,actorId:operatorId,
      actorType:'operations',action:'return_authorized',
      createdAt:at,
    });
    // Only a return authorization is created. The courier still has custody.
    return {deliveryId,status:'return_authorized' as const};
  });
};

export const revokeRecipientAbsenceReturn=async(input:{
  deliveryId:string;operatorId:string;reason:string;
}):Promise<{deliveryId:string;status:ReturnStatus}>=>{
  const deliveryId=safeId(input.deliveryId);
  const operatorId=safeId(input.operatorId);
  const explanation=reasonText(input.reason);
  const ref=adminDb.doc(`${protocols}/${deliveryId}`);
  const adminRef=adminDb.doc(`${adminCollection}/${operatorId}`);
  const deliveryRef=adminDb.doc(`${deliverables}/${deliveryId}`);
  const ev=adminDb.collection(events).doc();
  return adminDb.runTransaction(async tx=>{
    const [protocolSnap,adminSnap,deliverySnap]=await Promise.all([
      tx.get(ref),tx.get(adminRef),tx.get(deliveryRef),
    ]);
    if(!operatorAuthorized(obj(adminSnap.data()),operatorId)){
      throw new Error('DELIVERY_RETURN_FORBIDDEN');
    }
    const protocol=obj(protocolSnap.data());
    if(protocol.status==='authorization_revoked'
      && protocol.revokedBy===operatorId && protocol.revocationReason===explanation){
      return {deliveryId,status:'authorization_revoked' as const};
    }
    if(protocol.status!=='return_authorized'
      || deliverySnap.data()?.status!=='delivering'
      || obj(deliverySnap.data()).returnCustody===undefined
      || obj(obj(deliverySnap.data()).returnCustody).status!=='return_authorized'){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const at=Timestamp.now();
    tx.update(deliveryRef,{
      returnCustody:{status:'authorization_revoked',source:'supervised_kyrub_return'},
      updatedAt:at,
    });
    tx.update(ref,{status:'authorization_revoked',revokedBy:operatorId,
      revocationReason:explanation,revokedAt:at,updatedAt:at});
    tx.create(ev,{schemaVersion:1,deliveryId,actorId:operatorId,
      actorType:'operations',action:'return_authorization_revoked',createdAt:at});
    return {deliveryId,status:'authorization_revoked' as const};
  });
};

export const declareCourierReturnAtStore=async(input:{
  deliveryId:string;courierId:string;
}):Promise<{deliveryId:string;status:ReturnStatus}>=>{
  const deliveryId=safeId(input.deliveryId);
  const courierId=safeId(input.courierId);
  const returnRef=adminDb.doc(`${protocols}/${deliveryId}`);
  const deliveryRef=adminDb.doc(`${deliverables}/${deliveryId}`);
  const claimRef=adminDb.doc(`${claims}/${deliveryId}`);
  const completeRef=adminDb.doc(`${completions}/${deliveryId}`);
  const trackingRef=adminDb.doc(`${tracking}/${deliveryId}`);
  const eventRef=adminDb.collection(events).doc();
  return adminDb.runTransaction(async tx=>{
    const [returnSnap,deliverySnap,claimSnap,completeSnap,trackSnap]=await Promise.all([
      tx.get(returnRef),tx.get(deliveryRef),tx.get(claimRef),
      tx.get(completeRef),tx.get(trackingRef),
    ]);
    const protocol=obj(returnSnap.data());
    if(protocol.courierId!==courierId || !returnSnap.exists){
      throw new Error('DELIVERY_RETURN_FORBIDDEN');
    }
    if(protocol.status==='courier_presented_to_store'){
      return {deliveryId,status:'courier_presented_to_store' as const};
    }
    if(protocol.status!=='return_authorized'){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const delivery=obj(deliverySnap.data()),claim=obj(claimSnap.data());
    checkOngoing(delivery,claim,completeSnap.exists,courierId);
    if(delivery.storeId!==protocol.storeId
      || delivery.sourceOrderId!==protocol.orderId){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const gps=obj(trackSnap.data());
    const assessment=obj(gps.storeArrivalAssessment);
    // Always demand a fresh server-evaluated position back INSIDE the store.
    // Original collection's old geofence evidence cannot validate a return.
    if(gps.courierId!==courierId || gps.active!==true
      || !timestampIsFresh(gps.updatedAt)
      || !timestampIsFresh(assessment.evaluatedAt)
      || assessment.configured!==true
      || assessment.insideGeofence!==true
      || typeof assessment.accuracyMeters!=='number'
      || assessment.accuracyMeters>100){
      throw new Error('DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED');
    }
    const at=Timestamp.now();
    tx.update(returnRef,{status:'courier_presented_to_store',
      courierPresentedAt:at,courierDeclaredBy:courierId,
      evidenceKind:'fresh_server_evaluated_store_geofence',
      updatedAt:at,
    });
    tx.update(deliveryRef,{
      returnCustody:{status:'courier_presented_to_store',source:'supervised_kyrub_return'},
      updatedAt:at,
    });
    tx.create(eventRef,{schemaVersion:1,deliveryId,actorId:courierId,
      actorType:'courier',action:'courier_declared_return_at_store',
      evidenceKind:'fresh_server_evaluated_store_geofence',createdAt:at});
    // Still no delivery/claim state change until store acknowledges the package.
    return {deliveryId,status:'courier_presented_to_store' as const};
  });
};

export const confirmStoreReceivedReturnedDelivery=async(input:{
  deliveryId:string;storeId:string;condition:'intact'|'damaged'|'disputed';
  note:string;
}):Promise<{deliveryId:string;status:ReturnStatus}>=>{
  const deliveryId=safeId(input.deliveryId);
  const storeId=safeId(input.storeId);
  const condition=input.condition;
  if(!['intact','damaged','disputed'].includes(condition)){
    throw new Error('DELIVERY_RETURN_INVALID');
  }
  const note=reasonText(input.note);
  const returnRef=adminDb.doc(`${protocols}/${deliveryId}`);
  const deliveryRef=adminDb.doc(`${deliverables}/${deliveryId}`);
  const claimRef=adminDb.doc(`${claims}/${deliveryId}`);
  const offerRef=adminDb.doc(`${offers}/${deliveryId}`);
  const completeRef=adminDb.doc(`${completions}/${deliveryId}`);
  const trackingRef=adminDb.doc(`${tracking}/${deliveryId}`);
  const eventRef=adminDb.collection(events).doc();

  return adminDb.runTransaction(async tx=>{
    const [returnSnap,deliverySnap,claimSnap,completeSnap]=await Promise.all([
      tx.get(returnRef),tx.get(deliveryRef),tx.get(claimRef),tx.get(completeRef),
    ]);
    const protocol=obj(returnSnap.data());
    if(!returnSnap.exists || protocol.storeId!==storeId){
      throw new Error('DELIVERY_RETURN_FORBIDDEN');
    }
    if(protocol.status==='returned_to_store_pending_reconciliation'
      && protocol.receivedByStoreId===storeId
      && protocol.receivedCondition===condition && protocol.receivedNote===note){
      return {deliveryId,status:'returned_to_store_pending_reconciliation' as const};
    }
    if(protocol.status!=='courier_presented_to_store' || !protocol.courierPresentedAt){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const delivery=obj(deliverySnap.data()),claim=obj(claimSnap.data());
    const courierId=safeId(protocol.courierId);
    checkOngoing(delivery,claim,completeSnap.exists,courierId);
    if(delivery.storeId!==storeId || delivery.sourceOrderId!==protocol.orderId){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const orderRef=adminDb.doc(
      `artifacts/${storeId}/public/data/customerOrders/${safeId(protocol.orderId)}`);
    const orderSnap=await tx.get(orderRef);
    if(!orderSnap.exists || orderSnap.data()?.status!=='out_for_delivery'
      || orderSnap.data()?.deliveryProvider!=='kyrub'){
      throw new Error('DELIVERY_RETURN_CONFLICT');
    }
    const at=Timestamp.now();
    const returnMarker={
      status:'received_by_store_pending_financial_review',
      returnedAt:at,deliveryId,source:'supervised_kyrub_return',
    };
    tx.update(returnRef,{status:'returned_to_store_pending_reconciliation',
      receivedByStoreId:storeId,receivedByStoreAt:at,
      receivedCondition:condition,receivedNote:note,updatedAt:at,
      financialStatus:'awaiting_independent_reconciliation',
    });
    tx.update(deliveryRef,{status:'returned_to_store',returnCustody:returnMarker,
      updatedAt:at});
    tx.update(claimRef,{status:'returned_to_store',returnCustody:returnMarker,
      updatedAt:at});
    tx.set(offerRef,{status:'returned_to_store',updatedAt:at},{merge:true});
    // Keep the original financial/order workflow untouched, but expose the
    // visible return marker; the order must NOT be completed or refunded here.
    tx.update(orderRef,{returnCustody:returnMarker,updatedAt:at.toDate().toISOString()});
    tx.set(trackingRef,{active:false,latitude:FieldValue.delete(),
      longitude:FieldValue.delete(),accuracy:FieldValue.delete(),
      heading:FieldValue.delete(),speed:FieldValue.delete(),
      endedAt:at,endReason:'package_returned_to_store',updatedAt:at},{merge:true});
    tx.create(eventRef,{schemaVersion:1,deliveryId,actorId:storeId,
      actorType:'store',action:'store_physically_received_return',
      receivedCondition:condition,createdAt:at});
    return {deliveryId,status:'returned_to_store_pending_reconciliation' as const};
  });
};
