import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { parseDeliveryCustomerDestinationSnapshot } from '../../shared/deliveryCustomerDestination.js';
import { resolvePlatformCredentials } from '../integrations/platformCredentialStore.js';
import { GOOGLE_MAPS_API_KEY_SLOT, GOOGLE_MAPS_ENVIRONMENT,
  GOOGLE_MAPS_PROVIDER_ID, assertGoogleMapsApiKey } from '../../shared/googleMapsIntegration.js';

const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const obj=(v:unknown):Record<string,unknown> =>
  v && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{};
const id=(v:unknown):string=>{
  const x=clean(v);
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(x))throw new Error('DELIVERY_RETURN_ROUTE_INVALID');
  return x;
};
const routeMode=(vehicle:unknown):'DRIVE'|'BICYCLE'|'TWO_WHEELER'=>{
  if(vehicle==='car')return 'DRIVE';
  if(vehicle==='bicycle')return 'BICYCLE';
  if(vehicle==='motorcycle')return 'TWO_WHEELER';
  throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
};
export const routeVerificationPolicy=(v:unknown):number|null=>{
  const data=obj(v),maximum=data.maxDistanceMeters;
  return data.enabled===true && Number.isSafeInteger(maximum)
    && Number(maximum)>0 && Number(maximum)<=200_000?Number(maximum):null;
};
export const parseGoogleRouteDistance=(payload:unknown,max:number):number=>{
  const routes=obj(payload).routes;
  if(!Array.isArray(routes)||routes.length!==1)throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
  const meters=obj(routes[0]).distanceMeters;
  if(!Number.isSafeInteger(meters)||Number(meters)<=0||Number(meters)>max){
    throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
  }
  return Number(meters);
};
export const computeGoogleReturnRouteDistance=async(input:{
  apiKey:string;
  origin:{latitude:number;longitude:number};
  destination:string;
  vehicle:'car'|'bicycle'|'motorcycle';
  maxMeters:number;
  request?:typeof fetch;
}):Promise<number>=>{
  if(!Number.isFinite(input.origin.latitude)||Math.abs(input.origin.latitude)>90
    ||!Number.isFinite(input.origin.longitude)||Math.abs(input.origin.longitude)>180
    ||!clean(input.destination)||clean(input.destination).length>500){
    throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
  }
  const apiKey=assertGoogleMapsApiKey(input.apiKey);
  const mode=routeMode(input.vehicle);
  try {
    const response=await (input.request??fetch)(
      'https://routes.googleapis.com/directions/v2:computeRoutes',{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'X-Goog-Api-Key':apiKey,
          'X-Goog-FieldMask':'routes.distanceMeters',
        },
        body:JSON.stringify({
          origin:{location:{latLng:input.origin}},
          destination:{address:clean(input.destination)},
          travelMode:mode,computeAlternativeRoutes:false,
        }),
        signal:AbortSignal.timeout(8000),
      });
    if(!response.ok)throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
    return parseGoogleRouteDistance(await response.json(),input.maxMeters);
  }catch{
    // Do not expose provider errors or secret credentials in API responses.
    throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
  }
};
const policyPath='platformEconomicPolicies/deliveryReturnRouteVerification';
const protocolPath=(deliveryId:string)=>'deliveryReturnProtocols/'+deliveryId;
const deliveryPath=(deliveryId:string)=>'hub/renda/deliveries/'+deliveryId;
const authorise=(profile:Record<string,unknown>,operatorId:string)=>
  profile.uid===operatorId && profile.status==='active'
  && ['super_admin','operations','compliance'].includes(clean(profile.role));

const verifySnapshot=(deliveryId:string,operatorId:string,values:{
  protocol:Record<string,unknown>;
  delivery:Record<string,unknown>;
  claim:Record<string,unknown>;
  store:Record<string,unknown>;
  policy:Record<string,unknown>;
  completionExists:boolean;
}):{latitude:number;longitude:number;destination:string;mode:'DRIVE'|'BICYCLE'|'TWO_WHEELER';maxMeters:number;signature:string}=>{
  const {protocol,delivery,claim,store,policy,completionExists}=values;
  const snapshot=parseDeliveryCustomerDestinationSnapshot(delivery.customerGeofenceSnapshot);
  const maximum=routeVerificationPolicy(policy);
  const destination=clean(store.address);
  if(!snapshot||maximum===null||completionExists
    ||protocol.status!=='returned_to_store_pending_reconciliation'
    ||protocol.financialStatus!=='awaiting_independent_reconciliation'
    ||!protocol.receivedByStoreAt || !protocol.authorizedAt
    ||protocol.operatorId===operatorId
    ||delivery.status!=='returned_to_store'
    ||delivery.source!=='kyrub-order'
    ||claim.status!=='returned_to_store'
    ||claim.courierId!==protocol.courierId
    ||delivery.acceptedBy!==protocol.courierId
    ||delivery.sourceOrderId!==protocol.orderId
    ||delivery.storeId!==protocol.storeId
    ||clean(delivery.from)!==destination ||!destination
    ||!obj(claim.returnTariffAcceptedTerms).offerFingerprint){
    throw new Error('DELIVERY_RETURN_ROUTE_CONFLICT');
  }
  const mode=routeMode(claim.vehicleType);
  const identity={deliveryId,storeId:protocol.storeId,orderId:protocol.orderId,
    courierId:protocol.courierId,operatorId:protocol.operatorId,
    authorizedAt:protocol.authorizedAt instanceof Timestamp?protocol.authorizedAt.toMillis():null,
    receivedAt:protocol.receivedByStoreAt instanceof Timestamp?protocol.receivedByStoreAt.toMillis():null,
    receivedCondition:protocol.receivedCondition,
    origin:[snapshot.latitude,snapshot.longitude],
    destination,mode,maximum,offerFingerprint:obj(claim.returnTariffAcceptedTerms).offerFingerprint};
  if(!identity.authorizedAt||!identity.receivedAt)throw new Error('DELIVERY_RETURN_ROUTE_CONFLICT');
  return {latitude:snapshot.latitude,longitude:snapshot.longitude,
    destination,mode,maxMeters:maximum,
    signature:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
};

export const verifyIndependentReturnDistance=async(input:{
  deliveryId:string;operatorId:string;
}):Promise<{deliveryId:string;status:'verified_pending_financial_review';distanceMeters:number;routePlanId:string}>=>{
  const deliveryId=id(input.deliveryId),operatorId=id(input.operatorId);
  const returnRef=adminDb.doc(protocolPath(deliveryId));
  const deliveryRef=adminDb.doc(deliveryPath(deliveryId));
  const claimRef=adminDb.doc('deliveryClaims/'+deliveryId);
  const operatorRef=adminDb.doc('kyrub_admin/control_plane/admins/'+operatorId);
  const policyRef=adminDb.doc(policyPath);
  const [admin,protocolSnap,deliverySnap,claimSnap,policySnap,completion]=await Promise.all([
    operatorRef.get(),returnRef.get(),deliveryRef.get(),claimRef.get(),policyRef.get(),
    adminDb.doc('deliveryCompletions/'+deliveryId).get(),
  ]);
  if(!authorise(obj(admin.data()),operatorId))throw new Error('DELIVERY_RETURN_ROUTE_FORBIDDEN');
  const protocol=obj(protocolSnap.data()),delivery=obj(deliverySnap.data()),claim=obj(claimSnap.data());
  if(!protocolSnap.exists||!deliverySnap.exists||!claimSnap.exists)throw new Error('DELIVERY_RETURN_ROUTE_CONFLICT');
  const existing=obj(protocol.independentReturnDistanceAuthority);
  if(existing.approved===true&&existing.source==='independent_route_plan'
    &&Number.isSafeInteger(existing.distanceMeters)&&typeof existing.routePlanId==='string'){
    return {deliveryId,status:'verified_pending_financial_review',distanceMeters:Number(existing.distanceMeters),
      routePlanId:existing.routePlanId};
  }
  const storeRef=adminDb.doc('users/'+id(protocol.storeId)+'/stores/'+id(protocol.storeId));
  const store=await storeRef.get();
  const planned=verifySnapshot(deliveryId,operatorId,{protocol,delivery,claim,
    store:obj(store.data()),policy:obj(policySnap.data()),completionExists:completion.exists});
  const secrets=await resolvePlatformCredentials(GOOGLE_MAPS_PROVIDER_ID,GOOGLE_MAPS_ENVIRONMENT);
  if(!secrets)throw new Error('DELIVERY_RETURN_ROUTE_UNAVAILABLE');
  const key=assertGoogleMapsApiKey(secrets[GOOGLE_MAPS_API_KEY_SLOT]);
  const vehicle=planned.mode==='DRIVE'?'car':planned.mode==='BICYCLE'?'bicycle':'motorcycle';
  const distanceMeters=await computeGoogleReturnRouteDistance({
    apiKey:key,origin:{latitude:planned.latitude,longitude:planned.longitude},
    destination:planned.destination,vehicle,maxMeters:planned.maxMeters,
  });
  const routePlanId=createHash('sha256').update(planned.signature+':'+distanceMeters).digest('hex');
  return adminDb.runTransaction(async transaction=>{
    const [adminNow,protocolNow,deliveryNow,claimNow,storeNow,policyNow,completionNow]=await Promise.all([
      transaction.get(operatorRef),transaction.get(returnRef),transaction.get(deliveryRef),
      transaction.get(claimRef),transaction.get(storeRef),transaction.get(policyRef),
      transaction.get(adminDb.doc('deliveryCompletions/'+deliveryId)),
    ]);
    if(!authorise(obj(adminNow.data()),operatorId))throw new Error('DELIVERY_RETURN_ROUTE_FORBIDDEN');
    const current=obj(protocolNow.data()),currentEvidence=obj(current.independentReturnDistanceAuthority);
    if(currentEvidence.approved===true&&currentEvidence.source==='independent_route_plan'){
      if(currentEvidence.routePlanId!==routePlanId)throw new Error('DELIVERY_RETURN_ROUTE_CONFLICT');
      return {deliveryId,status:'verified_pending_financial_review' as const,
        distanceMeters:Number(currentEvidence.distanceMeters),routePlanId};
    }
    const still=verifySnapshot(deliveryId,operatorId,{protocol:current,
      delivery:obj(deliveryNow.data()),claim:obj(claimNow.data()),store:obj(storeNow.data()),
      policy:obj(policyNow.data()),completionExists:completionNow.exists});
    if(still.signature!==planned.signature)throw new Error('DELIVERY_RETURN_ROUTE_CONFLICT');
    const at=Timestamp.now();
    transaction.update(returnRef,{independentReturnDistanceAuthority:{
      source:'independent_route_plan',approved:true,routePlanId,distanceMeters,
      provider:'google_routes',travelMode:planned.mode,
      verifiedBy:operatorId,verifiedAt:at,
      warning:planned.mode==='DRIVE'?'': 'Beta: rotas para bicicleta e moto podem não refletir todas as vias seguras.',
    },updatedAt:at});
    transaction.create(adminDb.collection('deliveryReturnEvents').doc(),{
      schemaVersion:1,deliveryId,actorId:operatorId,actorType:'operations',
      action:'return_route_distance_verified',
      routePlanId,distanceMeters,source:'google_routes',createdAt:at,
    });
    return {deliveryId,status:'verified_pending_financial_review' as const,distanceMeters,routePlanId};
  });
};
