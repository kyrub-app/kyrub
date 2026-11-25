import type { Firestore } from 'firebase-admin/firestore';
import { authorizePlatformEconomy } from './platformEconomyRouter.js';
import { financeMonthRange } from '../../shared/storeFinanceCalendar.js';
import { normalizeStoreFinancePayable } from '../../shared/storeFinancePayables.js';
import { TECHNOLOGY_COST_CATEGORIES } from '../../shared/platformFinops.js';
import { INFRASTRUCTURE_COST_CENTER_ID } from '../../shared/storeFinanceCostCenters.js';

type Category = typeof TECHNOLOGY_COST_CATEGORIES[number];
export type InfrastructureFixtureReference = {
  payableId:string; category:Category; billingDocumentReference:string;
  reconciliationRef:string;
};
type Dependencies = {
  db:Pick<Firestore,'doc'|'collection'|'runTransaction'>;
  projectId:string;
  verify:(token:string)=>Promise<{uid:string;emailVerified?:boolean}>;
};
export type OfficialInfrastructureFixtureDiagnostic = {
  month:string; timeZone:'America/Sao_Paulo'; basis:'cash';
  scope:'emulator_only'; status:'fixture_partial'|'unavailable';
  registeredPaidMinor:number|null; matchedCount:number|null;
  actualInfrastructureCostMinor:null; realMau:null;
};
const safeId=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(s);
const evidence=(s:unknown):s is string=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=500;
const canonicalIso=(s:string)=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;

// Candidate reader: explicit synthetic references, no browser request or route.
// References carry no amount and establish no actual payment/coverage evidence.
export async function readOfficialInfrastructureFixture(
  authorization:string, month:string, references:readonly InfrastructureFixtureReference[], deps:Dependencies,
):Promise<OfficialInfrastructureFixtureDiagnostic>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||
      process.env.NODE_ENV==='production'||process.env.VERCEL_ENV==='production'||
      deps.projectId!=='kyrub-security-test')throw Error('INFRASTRUCTURE_EMULATOR_ONLY');
  const range=financeMonthRange(month,'America/Sao_Paulo');
  await authorizePlatformEconomy(authorization,{db:deps.db,verify:deps.verify});
  const unavailable:OfficialInfrastructureFixtureDiagnostic={month,timeZone:'America/Sao_Paulo',basis:'cash',
    scope:'emulator_only',status:'unavailable',registeredPaidMinor:null,matchedCount:null,
    actualInfrastructureCostMinor:null,realMau:null};
  // No empty input interpreted as a zero cost. Bounded, unique, document-level
  // references only; mixed invoices/FX and credits require future reconciliation.
  if(!Array.isArray(references)||references.length===0||references.length>100)return unavailable;
  const ids=new Set<string>(), docs=new Set<string>(), reconciliations=new Set<string>();
  for(const ref of references){
    if(!ref||!safeId(ref.payableId)||!TECHNOLOGY_COST_CATEGORIES.includes(ref.category)||
        !evidence(ref.billingDocumentReference)||!evidence(ref.reconciliationRef)||
        ids.has(ref.payableId)||docs.has(ref.billingDocumentReference)||reconciliations.has(ref.reconciliationRef))return unavailable;
    ids.add(ref.payableId);docs.add(ref.billingDocumentReference);reconciliations.add(ref.reconciliationRef);
  }
  try {
    // One read-only snapshot, with the official identity resolved inside it.
    return await deps.db.runTransaction(async tx=>{
      const designation=await tx.get(deps.db.doc('kyrub_admin/official_store'));
      const d=designation.data();
      if(!designation.exists||d?.schemaVersion!==1||d.kind!=='official_cairobi_store'||
          !safeId(d.canonicalStoreId)||!safeId(d.ownerUserId)||d.legacyStoreId!==d.ownerUserId||
          !safeId(d.designatedBy))return unavailable;
      const storeId=d.canonicalStoreId;
      const store=await tx.get(deps.db.doc('stores/'+storeId));
      if(!store.exists||store.get('id')!==storeId||store.get('ownerId')!==d.ownerUserId||
          store.get('legacyTenantId')!==d.legacyStoreId)return unavailable;
      const snapshots=await Promise.all(references.map(ref=>tx.get(deps.db.doc('stores/'+storeId+'/financePayables/'+ref.payableId))));
      let total=0;
      for(let i=0;i<snapshots.length;i++){
        const snap=snapshots[i], ref=references[i], raw=snap.data();
        if(!snap.exists||raw?.id!==ref.payableId||raw.storeId!==storeId)return unavailable;
        const p=normalizeStoreFinancePayable(raw);
        if(p.costCenter?.id!==INFRASTRUCTURE_COST_CENTER_ID||p.status!=='paid'||p.sourceAuthority!=='store_owner_manual'||!canonicalIso(p.paidAt)||
          p.paidAt<range.startIso||p.paidAt>=range.endExclusiveIso||
          p.billingDocumentType==='none'||p.billingDocumentReference!==ref.billingDocumentReference)
          return unavailable;
        total+=p.amountMinor;
        if(!Number.isSafeInteger(total))return unavailable;
      }
      return {...unavailable,status:'fixture_partial' as const,registeredPaidMinor:total,matchedCount:snapshots.length};
    },{readOnly:true});
  } catch {return unavailable;}
}

// Automatic classification diagnostic. No externally supplied list of payable IDs,
// no new registry, no additional financial record. A bounded paidAt query uses
// the existing single-field index; never claims complete actual costs.
export async function readOfficialRegisteredInfrastructureFixture(
  authorization:string,month:string,deps:Dependencies,
):Promise<OfficialInfrastructureFixtureDiagnostic>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||
      process.env.NODE_ENV==='production'||process.env.VERCEL_ENV==='production'||
      deps.projectId!=='kyrub-security-test')throw Error('INFRASTRUCTURE_EMULATOR_ONLY');
  const range=financeMonthRange(month,'America/Sao_Paulo');
  await authorizePlatformEconomy(authorization,{db:deps.db,verify:deps.verify});
  const unavailable:OfficialInfrastructureFixtureDiagnostic={month,timeZone:'America/Sao_Paulo',basis:'cash',
    scope:'emulator_only',status:'unavailable',registeredPaidMinor:null,matchedCount:null,
    actualInfrastructureCostMinor:null,realMau:null};
  try{
    return await deps.db.runTransaction(async tx=>{
      const designation=await tx.get(deps.db.doc('kyrub_admin/official_store'));
      const d=designation.data();
      if(!designation.exists||d?.schemaVersion!==1||d.kind!=='official_cairobi_store'||
        !safeId(d.canonicalStoreId)||!safeId(d.ownerUserId)||d.legacyStoreId!==d.ownerUserId||
        !safeId(d.designatedBy))return unavailable;
      const storeId=d.canonicalStoreId;
      const store=await tx.get(deps.db.doc('stores/'+storeId));
      if(!store.exists||store.get('id')!==storeId||store.get('ownerId')!==d.ownerUserId||
        store.get('legacyTenantId')!==d.legacyStoreId)return unavailable;
      const result=await tx.get(deps.db.collection('stores/'+storeId+'/financePayables')
        .where('paidAt','>=',range.startIso).where('paidAt','<',range.endExclusiveIso).limit(501));
      if(result.size>500)return unavailable;
      let total=0,count=0;
      for(const snap of result.docs){
        const raw=snap.data();
        if(raw.costCenter?.id!==INFRASTRUCTURE_COST_CENTER_ID)continue;
        if(raw.id!==snap.id||raw.storeId!==storeId)return unavailable;
        const p=normalizeStoreFinancePayable(raw);
        if(p.status!=='paid'||!canonicalIso(p.paidAt)||p.paidAt<range.startIso||p.paidAt>=range.endExclusiveIso)return unavailable;
        total+=p.amountMinor;count++;
        if(!Number.isSafeInteger(total))return unavailable;
      }
      return count?{...unavailable,status:'fixture_partial' as const,registeredPaidMinor:total,matchedCount:count}:unavailable;
    },{readOnly:true});
  }catch{return unavailable;}
}
