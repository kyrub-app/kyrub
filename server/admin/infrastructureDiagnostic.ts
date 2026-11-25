import type { AdminInfrastructureDiagnostic } from '../../shared/adminPlatformEconomy.js';
import { adminDb, getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

type Dependencies={
  env:Record<string,string|undefined>;
  currentProject:()=>string;
  read:(authorization:string,month:string)=>Promise<AdminInfrastructureDiagnostic>;
};
const fixtureAllowed=(env:Dependencies['env'])=>
  env.KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED==='true'&&
  env.NODE_ENV!=='production'&&env.VERCEL_ENV!=='production'&&
  env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&
  env.FIREBASE_PROJECT_ID==='kyrub-security-test'&&!env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

// Existing endpoint authorization precedes this call; reader independently
// rechecks authorization. No production read or additional route.
export async function loadInfrastructureDiagnostic(
  authorization:string,month:string,
  deps:Dependencies={
    env:process.env,currentProject:getFirebaseAdminProjectId,
    read:async(auth,period)=>{
      const {readOfficialRegisteredInfrastructureFixture}=await import('./officialInfrastructureFixtureReader.js');
      return readOfficialRegisteredInfrastructureFixture(auth,period,{db:adminDb,projectId:getFirebaseAdminProjectId(),verify:verifyFirebaseIdToken});
    },
  },
):Promise<AdminInfrastructureDiagnostic>{
  const unavailable:AdminInfrastructureDiagnostic={month,timeZone:'America/Sao_Paulo',basis:'cash',
    scope:'emulator_only',status:'unavailable',registeredPaidMinor:null,matchedCount:null,
    actualInfrastructureCostMinor:null,realMau:null};
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!fixtureAllowed(deps.env))return unavailable;
  try{
    if(deps.currentProject()!=='kyrub-security-test')return unavailable;
    const d=await deps.read(authorization,month);
    if(d.month!==month||d.scope!=='emulator_only'||d.timeZone!=='America/Sao_Paulo'||d.basis!=='cash'||
      d.status!=='fixture_partial'||d.actualInfrastructureCostMinor!==null||d.realMau!==null||
      typeof d.registeredPaidMinor!=='number'||!Number.isSafeInteger(d.registeredPaidMinor)||d.registeredPaidMinor<=0||
      typeof d.matchedCount!=='number'||!Number.isSafeInteger(d.matchedCount)||d.matchedCount<=0||d.matchedCount>500)return unavailable;
    return {...unavailable,status:'fixture_partial',registeredPaidMinor:d.registeredPaidMinor,matchedCount:d.matchedCount};
  }catch{return unavailable;}
}
