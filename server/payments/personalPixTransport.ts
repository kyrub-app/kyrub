import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {readPersonalPixDestination,changePersonalPixDestination,listPersonalCidPixCandidates,importPersonalCidPixDestination} from './personalPixDestinationService.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
export function personalPixTransportEnabled(){
 return process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true'&&!process.env.VERCEL&&!process.env.VERCEL_ENV&&
 !process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&
 process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&
 getFirebaseAdminProjectId()==='kyrub-security-test';
}
export function personalPixRecentLogin(authTime:unknown,nowSeconds=Math.floor(Date.now()/1000)){
 return typeof authTime==='number'&&Number.isInteger(authTime)&&authTime>0&&authTime<=nowSeconds&&nowSeconds-authTime<=300;
}
export async function handlePersonalPix(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 try{if(!personalPixTransportEnabled())throw Error('DISABLED');}catch{res.status(503).json({code:'PERSONAL_FINANCE_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const h=req.headers.authorization;
 const token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let identity:Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
 try{identity=await adminAuth.verifyIdToken(token,true);if(!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid))throw Error('AUTH_REQUIRED');}catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 if(identity.email_verified!==true){res.status(403).json({code:'EMAIL_VERIFICATION_REQUIRED'});return;}
 const query=req.query??{};
 const listCid=req.method==='GET'&&Object.keys(query).length===1&&query.view==='cid_candidates';
 if(Object.keys(query).length&&!listCid){res.status(400).json({code:'PERSONAL_PIX_INVALID'});return;}
 try{
  if(req.method==='GET'){
   res.status(200).json(listCid?await listPersonalCidPixCandidates(identity.uid):await readPersonalPixDestination(identity.uid));return;
  }
  const media=req.headers['content-type'];
  if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>2048){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  if(!personalPixRecentLogin(identity.auth_time)){res.status(403).json({code:'REAUTHENTICATION_REQUIRED'});return;}
  // Only a verified eligible participant may declare a destination in this candidate.
  // Revocation remains possible if the participant's eligibility has changed.
  const b=req.body as Record<string,unknown>|undefined;
  if(b?.action==='declare'){
   const profile=await adminDb.doc('identity_verifications/'+identity.uid).get();
   const roles=profile.get('approvedProfiles');
   if(profile.get('status')!=='approved'||!Array.isArray(roles)||!roles.some(r=>['requester','freelancer','bicycle_courier','motorized_courier'].includes(r))){
    res.status(403).json({code:'IDENTITY_VERIFICATION_REQUIRED'});return;
   }
  }
  res.status(200).json(b?.action==='import_cid'?await importPersonalCidPixDestination(identity.uid,req.body):await changePersonalPixDestination(identity.uid,req.body));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=code==='PERSONAL_PIX_INVALID'?400:code==='PERSONAL_CID_UNAVAILABLE'||code==='IDENTITY_VERIFICATION_REQUIRED'?403:['PERSONAL_PIX_CONFLICT','PERSONAL_CID_CHANGED','PERSONAL_CID_LIST_LIMIT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'PERSONAL_FINANCE_UNAVAILABLE':code});
 }
}
