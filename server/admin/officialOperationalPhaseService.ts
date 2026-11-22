import {adminDb} from '../firebaseAdmin.js';
import {loadMercadoPagoMerchantPixMigrationInventory} from './mercadoPagoMerchantPixMigrationInventoryService.js';
import {
 OFFICIAL_PHASE_STORE_ID,type OperationalPhaseView
} from '../../shared/officialOperationalPhase.js';
import {loadOwnerStoreInstitutionalRepresentation} from '../store/storeInstitutionalIdentityService.js';

const MARKER_PATH='kyrub_admin/control_plane/operational_phase_markers/kyrub-oficial-2026-11';
const AUDIT_PATH='kyrub_admin/control_plane/audit_logs/kyrub-oficial-operational-phase-2026-11';
const empty=():OperationalPhaseView=>({storeId:OFFICIAL_PHASE_STORE_ID,active:false,effectiveAt:'',scope:'operational_view_only'});
const clean=(x:unknown)=>typeof x==='string'?x.trim():'';
const validTimestamp=(value:unknown):value is string=>
 typeof value==='string'&&Number.isFinite(Date.parse(value))&&value.endsWith('Z');

export async function getOfficialOperationalPhaseForLegacyStore(legacyStoreId:string):Promise<OperationalPhaseView>{
 if(!/^[a-zA-Z0-9_-]{1,180}$/.test(legacyStoreId))return empty();
 const snapshot=await adminDb.doc(MARKER_PATH).get();
 if(!snapshot.exists)return empty();
 const marker=snapshot.data() as Record<string,unknown>;
 if(marker.storeId!==OFFICIAL_PHASE_STORE_ID||marker.legacyStoreId!==legacyStoreId||
    marker.scope!=='operational_view_only'||!validTimestamp(marker.effectiveAt))return empty();
 return {storeId:OFFICIAL_PHASE_STORE_ID,active:true,effectiveAt:marker.effectiveAt,scope:'operational_view_only'};
}

export async function getOfficialOperationalPhaseForOwner(input:{
 legacyStoreId:string;actorId:string
}):Promise<OperationalPhaseView>{
 await loadOwnerStoreInstitutionalRepresentation({
  storeId:input.legacyStoreId,authenticatedUserId:input.actorId
 });
 const official=await adminDb.doc(`stores/${OFFICIAL_PHASE_STORE_ID}`).get();
 if(official.get('ownerId')!==input.actorId||official.get('legacyTenantId')!==input.legacyStoreId)
   throw Error('OFFICIAL_PHASE_FORBIDDEN');
 return getOfficialOperationalPhaseForLegacyStore(input.legacyStoreId);
}

export async function getOfficialOperationalPhaseForAdmin(actorId:string):Promise<OperationalPhaseView>{
 if(!actorId)throw Error('OFFICIAL_PHASE_FORBIDDEN');
 const marker=await adminDb.doc(MARKER_PATH).get();
 if(!marker.exists)return empty();
 const data=marker.data() as Record<string,unknown>;
 if(data.storeId!==OFFICIAL_PHASE_STORE_ID||data.scope!=='operational_view_only'||
   !validTimestamp(data.effectiveAt))throw Error('OFFICIAL_PHASE_MARKER_INVALID');
 return {storeId:OFFICIAL_PHASE_STORE_ID,active:true,effectiveAt:data.effectiveAt,scope:'operational_view_only'};
}

export async function startOfficialOperationalPhase(actorId:string):Promise<OperationalPhaseView>{
 if(!/^[a-zA-Z0-9_-]{1,180}$/.test(actorId))throw Error('OFFICIAL_PHASE_FORBIDDEN');
 const inventory=await loadMercadoPagoMerchantPixMigrationInventory();
 const matches=inventory.items.filter(item=>item.canonicalStoreId===OFFICIAL_PHASE_STORE_ID&&item.storeName==='Kyrub Oficial');
 if(!inventory.complete||matches.length!==1||matches[0].readiness==='identity_review')
   throw Error('OFFICIAL_PHASE_SCOPE_INVALID');
 const tenant=matches[0].tenantId;
 return adminDb.runTransaction(async tx=>{
  const markerRef=adminDb.doc(MARKER_PATH);
  const adminRef=adminDb.doc(`kyrub_admin/control_plane/admins/${actorId}`);
  const [existing,admin]=await Promise.all([tx.get(markerRef),tx.get(adminRef)]);
  const data=admin.data() as Record<string,unknown>|undefined;
  if(!admin.exists||data?.uid!==actorId||data?.role!=='super_admin'||data?.status!=='active')
    throw Error('OFFICIAL_PHASE_FORBIDDEN');
  if(existing.exists){
   const row=existing.data() as Record<string,unknown>;
   if(row.storeId!==OFFICIAL_PHASE_STORE_ID||row.legacyStoreId!==tenant||
      row.scope!=='operational_view_only'||!validTimestamp(row.effectiveAt))
     throw Error('OFFICIAL_PHASE_MARKER_INVALID');
   return {storeId:OFFICIAL_PHASE_STORE_ID,active:true,effectiveAt:row.effectiveAt,scope:'operational_view_only' as const};
  }
  const effectiveAt=new Date().toISOString();
  tx.create(markerRef,{
   storeId:OFFICIAL_PHASE_STORE_ID,legacyStoreId:tenant,
   scope:'operational_view_only',effectiveAt,actorId,
   policy:'preserve_paid_provider_records_ledger_obligations_webhooks_and_history',
   financeBalancesUnaffected:true,paymentProcessingUnaffected:true,
   createdAt:effectiveAt
  });
  tx.create(adminDb.doc(AUDIT_PATH),{
   actorId,actorRole:'super_admin',action:'official_store.start_new_operational_phase',
   targetId:OFFICIAL_PHASE_STORE_ID,scope:'operational_view_only',
   effectiveAt,createdAt:effectiveAt
  });
  return {storeId:OFFICIAL_PHASE_STORE_ID,active:true,effectiveAt,scope:'operational_view_only' as const};
 });
}
