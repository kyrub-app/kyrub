import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {evaluateKyrubMfa} from '../../shared/kyrubMfaPolicy.js';
import {isDocumentId} from './publicSocialAddressPolicy.js';
import {consumeDirectoryQuota} from './directoryQuotaService.js';
import {readVisibleSocialDirectoryPage,readVisibleAuthorIdentities,searchVisibleNoteCollaborators} from './socialDiscoveryDirectoryService.js';
import {searchStoreStaffDirectory,createStoreStaffInvitation} from './storeStaffDirectoryService.js';
import {lookupAdminDirectoryIdentity,countAdminDirectoryUsers} from './adminDirectoryIdentityService.js';

const PROJECT='kyrub-b8d0e';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown};
export type DirectoryScope='social'|'staff'|'admin';
export type DirectoryRequest={scope:DirectoryScope;operation:string;input:Record<string,unknown>};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** Independent release switch. Never infer activation from NODE_ENV or client flags.
 * Staff operations require a separate explicit release switch. Invitation writes
 * revalidate age and authority inside the transaction.
 */
export function directoryReleaseEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_PRIVATE_DIRECTORY_RELEASE_ENABLED==='true'&&env.VERCEL==='1'&&
  env.VERCEL_ENV==='production'&&env.NODE_ENV==='production'&&
  !env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}

export function staffDirectoryReleaseEnabled(env:NodeJS.ProcessEnv=process.env){
 return directoryReleaseEnabled(env)&&env.KYRUB_PRIVATE_DIRECTORY_STAFF_ENABLED==='true';
}

/** Exact operation and payload allowlist. Never trust caller-supplied identity or role grants. */
export function parsePrivateDirectoryRequest(body:unknown):DirectoryRequest|null{
 if(!object(body)||!exact(body,['scope','operation','input'])||!object(body.input))return null;
 const {scope,operation,input}=body;
 const valid=scope==='social'?(operation==='page'?(Object.keys(input).length===0||(exact(input,['after'])&&isDocumentId(input.after))):
  operation==='authors'?exact(input,['authorIds'])&&Array.isArray(input.authorIds)&&input.authorIds.length<=40&&input.authorIds.every(isDocumentId):
  operation==='collaborators'&&exact(input,['term'])&&typeof input.term==='string'&&input.term.trim().length>=3&&input.term.length<=254):
  scope==='staff'?((operation==='search'&&exact(input,['storeId','term','role']))||(operation==='invite'&&exact(input,['storeId','term','role','targetUid'])&&isDocumentId(input.targetUid)))&&isDocumentId(input.storeId)&&typeof input.term==='string'&&input.term.trim().length>=3&&input.term.length<=254&&typeof input.role==='string'&&['manager','cashier','seller','production'].includes(input.role):
  scope==='admin'&&(operation==='count'?Object.keys(input).length===0:operation==='identity'&&exact(input,['term'])&&typeof input.term==='string'&&input.term.trim().length>0&&input.term.length<=254);
 return valid?{scope:scope as DirectoryScope,operation:operation as string,input}:null;
}

export async function handlePrivateDirectoryRequest(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!directoryReleaseEnabled()){res.status(404).json({error:'DIRECTORY_DISABLED'});return;}
 if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
 const parsed=parsePrivateDirectoryRequest(req.body);
 if(!parsed){res.status(400).json({error:'DIRECTORY_INPUT_INVALID'});return;}
 const {scope,operation,input}=parsed;
 if(scope==='staff'&&!staffDirectoryReleaseEnabled()){res.status(404).json({error:'DIRECTORY_DISABLED'});return;}
 try{
  if(getFirebaseAdminProjectId()!==PROJECT||(adminDb as typeof adminDb&{projectId?:string}).projectId!==PROJECT||adminAuth.app.options.projectId!==PROJECT)throw Error('PROJECT_MISMATCH');
 }catch{res.status(503).json({error:'DIRECTORY_UNAVAILABLE'});return;}
 const authorization=req.headers.authorization??req.headers.Authorization;
 const token=typeof authorization==='string'?/^Bearer (\S+)$/i.exec(authorization)?.[1]:undefined;
 if(!token||token.length>8192){res.status(401).json({error:'AUTH_REQUIRED'});return;}
 let uid:string;
 try{
  const identity=await adminAuth.verifyIdToken(token,true);
  if(identity.aud!==PROJECT||identity.email_verified!==true||!isDocumentId(identity.uid))throw Error('AUTH_INVALID');
  const actor=await adminAuth.getUser(identity.uid);
  if(actor.disabled||!actor.emailVerified)throw Error('AUTH_INVALID');
  if(scope!=='social'&&evaluateKyrubMfa({authenticated:true,responsibility:'administrative',
   secondFactor:identity.firebase?.sign_in_second_factor,authTimeSeconds:identity.auth_time,
   nowSeconds:Math.floor(Date.now()/1000),maxAgeSeconds:900})!=='allowed'){
   res.status(403).json({error:'MFA_REQUIRED'});return;
  }
  uid=identity.uid;
 }catch{res.status(401).json({error:'AUTH_REQUIRED'});return;}
 try{
  const age=(await adminDb.doc('age_eligibility_private/'+uid).get()).data();
  if(age?.uid!==uid||age.status!=='verified_adult'){res.status(403).json({error:'AGE_REQUIRED'});return;}
  const quota=await consumeDirectoryQuota(adminDb,uid,scope as 'social'|'staff'|'admin');
  if(quota.allowed===false){res.setHeader('Retry-After',String(quota.retryAfterSeconds));res.status(429).json({error:'DIRECTORY_LIMIT'});return;}
  if(scope==='social'){
   if(operation==='page'){res.status(200).json(await readVisibleSocialDirectoryPage(adminDb,uid,input.after as string|undefined));return;}
   if(operation==='authors'){res.status(200).json({entries:await readVisibleAuthorIdentities(adminDb,uid,input.authorIds)});return;}
   res.status(200).json({entries:await searchVisibleNoteCollaborators(adminDb,adminAuth,uid,input.term)});return;
  }
  if(scope==='staff'){
   if(operation==='invite'){
    const result=await createStoreStaffInvitation(adminDb,adminAuth,uid,input.storeId as string,input.targetUid as string,input.term as string,input.role as string);
    res.status(201).json(result);return;
   }
   res.status(200).json({entries:await searchStoreStaffDirectory(adminDb,adminAuth,uid,input.storeId as string,input.term as string,input.role as string)});return;
  }
  if(operation==='count'){res.status(200).json({count:await countAdminDirectoryUsers(adminDb,uid)});return;}
  res.status(200).json({user:await lookupAdminDirectoryIdentity(adminDb,adminAuth,uid,input.term)});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(/^(DIRECTORY|STAFF_DIRECTORY|ADMIN_DIRECTORY)_INVALID$/.test(code)){res.status(400).json({error:'DIRECTORY_INPUT_INVALID'});return;}
  if(code==='STAFF_INVITATION_EXISTS'){res.status(409).json({error:code});return;}
  if(code==='STAFF_DIRECTORY_AGE_REQUIRED'||/^(STAFF_DIRECTORY|ADMIN_DIRECTORY)_FORBIDDEN$/.test(code)){res.status(403).json({error:'DIRECTORY_FORBIDDEN'});return;}
  res.status(503).json({error:'DIRECTORY_UNAVAILABLE'});
 }
}
