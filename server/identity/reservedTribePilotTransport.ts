import type {KyrubMcpHttpRequest,KyrubMcpHttpResponse} from '../mcp/kyrubiaMcpServer.js';
import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {getReservedTribeSetupStatus,initializeReservedTribe,unlockReservedTribe,lockReservedTribeSession,setReservedTribeContact,getOrdinaryTribeDirectory,getReservedTribeDirectory,searchOrdinaryTribeSuggestions,mutateOrdinaryConnection,setOrdinaryTribeFavorite,createOrdinaryTribe,setOrdinaryTribeMember,deleteOrdinaryTribe} from './reservedTribeService.js';
import {readTribeChat,sendTribeChatMessage,clearTribeChatHistory} from './reservedTribeChatService.js';
import {recoverReservedTribeCode} from './reservedTribeRecoveryService.js';
import {listReservedUserNotifications,markReservedUserNotificationRead} from '../notifications/userNotificationService.js';

export const RESERVED_TRIBE_EMULATOR_PROJECT='kyrub-security-test';
const localHost=(value:string|undefined)=>typeof value==='string'&&/^(127\.0\.0\.1|localhost):\d+$/.test(value);
/** Deliberately reject all deployed environments, including preview, until
 * client/server isolation and the migration have been proven. No fallback. */
export function reservedTribePilotEnvironmentAllowed(env:Record<string,string|undefined>):boolean{
 return env.KYRUB_RESERVED_TRIBE_PILOT==='true'&&!env.VERCEL&&!env.VERCEL_ENV&&env.NODE_ENV!=='production'&&
  env.FIREBASE_PROJECT_ID===RESERVED_TRIBE_EMULATOR_PROJECT&&
  localHost(env.FIRESTORE_EMULATOR_HOST)&&localHost(env.FIREBASE_AUTH_EMULATOR_HOST);
}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validSession=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fields={
 status:[],setup:['code','confirmation'],unlock:['code'],lock:['session'],
 'directory':[],'reserved-directory':['session'],suggestions:['term','limit'],
 connection:['peerId','operation'],favorite:['connectionId','favorited'],
 'tribe-create':['groupId','name'],'tribe-member':['groupId','connectionId','member'],'tribe-delete':['groupId'],
 membership:['session','peerId','reserved'],recover:['code','confirmation'],
 'chat-read':['session','connectionId'],'chat-send':['session','connectionId','messageId','text'],
 'chat-clear':['session','connectionId'],
 'ordinary-chat-read':['connectionId'],'ordinary-chat-send':['connectionId','messageId','text'],'ordinary-chat-clear':['connectionId'],
 'notifications':['session'],
 'notification-read':['session','notificationId'],
} as const;
type Action=keyof typeof fields;
export function parseReservedTribePilotBody(input:unknown):{action:Action;data:Record<string,unknown>}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('TRIBE_INVALID');
 const data=input as Record<string,unknown>;
 const action=data.action;
 if(typeof action!=='string'||!Object.prototype.hasOwnProperty.call(fields,action))throw Error('TRIBE_INVALID');
 const keys:readonly string[]=fields[action as Action];
 if(Object.keys(data).length!==keys.length+1||keys.some(key=>!Object.prototype.hasOwnProperty.call(data,key)))throw Error('TRIBE_INVALID');
 if(keys.includes('session')&&!validSession(data.session))throw Error('TRIBE_INVALID');
 for(const key of ['peerId','connectionId','messageId','notificationId','groupId'])if(keys.includes(key)&&!validId(data[key]))throw Error('TRIBE_INVALID');
 if(keys.includes('code')&&(typeof data.code!=='string'||data.code.length>64))throw Error('TRIBE_INVALID');
 if(keys.includes('confirmation')&&(typeof data.confirmation!=='string'||data.confirmation.length>64))throw Error('TRIBE_INVALID');
 if(action==='connection'&&!['request','accept','remove'].includes(String(data.operation)))throw Error('TRIBE_INVALID');
 if(action==='tribe-create'&&(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>60))throw Error('TRIBE_INVALID');
 if(action==='tribe-member'&&typeof data.member!=='boolean')throw Error('TRIBE_INVALID');
 if(action==='favorite'&&typeof data.favorited!=='boolean')throw Error('TRIBE_INVALID');
 if(action==='membership'&&typeof data.reserved!=='boolean')throw Error('TRIBE_INVALID');
 if(action==='suggestions'&&(typeof data.term!=='string'||data.term.length>128||typeof data.limit!=='number'||!Number.isSafeInteger(data.limit)||data.limit<1||data.limit>50))throw Error('TRIBE_INVALID');
 if((action==='chat-send'||action==='ordinary-chat-send')&&(typeof data.text!=='string'||data.text.length>4000))throw Error('TRIBE_INVALID');
 return {action:action as Action,data};
}

type PilotIdentity={uid:string;email_verified?:boolean};
type VerifyIdentity=(bearer:string)=>Promise<PilotIdentity>;
const first=(value:string|string[]|undefined)=>typeof value==='string'?value:'';
/** Dependency injection is only for automated testing. The exported route
 * below always checks the actual environment, Admin project, and Auth token. */
export function createReservedTribePilotHandler(deps:{allowed:()=>boolean;project:()=>string;verify:VerifyIdentity}){
 return async function handle(request:KyrubMcpHttpRequest,response:KyrubMcpHttpResponse){
  response.setHeader('Cache-Control','no-store, private, max-age=0');
  response.setHeader('Pragma','no-cache');
  response.setHeader('Vary','Authorization');
  if(!deps.allowed()){response.status(404).json({error:'NOT_FOUND'});return;}
  if((request.method??'GET').toUpperCase()!=='POST'){response.setHeader('Allow','POST');response.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
  try{if(deps.project()!==RESERVED_TRIBE_EMULATOR_PROJECT){response.status(404).json({error:'NOT_FOUND'});return;}}
  catch{response.status(404).json({error:'NOT_FOUND'});return;}
  const bearer=/^Bearer ([^\s]+)$/i.exec(first(request.headers.authorization??request.headers.Authorization))?.[1];
  if(!bearer||bearer.length>8192){response.status(401).json({error:'AUTH_REQUIRED'});return;}
  let identity:PilotIdentity;
  try{identity=await deps.verify(bearer);if(!validId(identity.uid)||identity.email_verified!==true)throw Error('AUTH_REQUIRED');}
  catch{response.status(401).json({error:'AUTH_REQUIRED'});return;}
  try{
   const {action,data}=parseReservedTribePilotBody(request.body),actor=identity.uid;
   const session=data.session as string;
   let result:unknown;
   switch(action){
    case 'status':result=await getReservedTribeSetupStatus(actor);break;
    case 'setup':if(data.code!==data.confirmation)throw Error('TRIBE_CODE_INVALID');await initializeReservedTribe(actor,data.code);result={configured:true};break;
    case 'unlock':{const unlocked=await unlockReservedTribe(actor,data.code);result=unlocked.ok?unlocked:{ok:false};break;}
    case 'lock':result=await lockReservedTribeSession(actor,session);break;
    case 'directory':result=await getOrdinaryTribeDirectory(actor);break;
    case 'reserved-directory':result=await getReservedTribeDirectory(actor,session);break;
    case 'suggestions':result=await searchOrdinaryTribeSuggestions(actor,data.term,data.limit as number);break;
    case 'connection':result=await mutateOrdinaryConnection(actor,data.peerId,data.operation);break;
    case 'favorite':result=await setOrdinaryTribeFavorite(actor,data.connectionId,data.favorited);break;
    case 'tribe-create':result=await createOrdinaryTribe(actor,data.groupId,data.name);break;
    case 'tribe-member':result=await setOrdinaryTribeMember(actor,data.groupId,data.connectionId,data.member);break;
    case 'tribe-delete':result=await deleteOrdinaryTribe(actor,data.groupId);break;
    case 'membership':result=await setReservedTribeContact(actor,session,data.peerId,data.reserved);break;
    case 'recover':result=await recoverReservedTribeCode(bearer,data.code,data.confirmation);break;
    case 'ordinary-chat-read':result=await readTribeChat(actor,data.connectionId as string);break;
    case 'ordinary-chat-send':result=await sendTribeChatMessage(actor,data.connectionId as string,undefined,data.messageId,data.text);break;
    case 'ordinary-chat-clear':result=await clearTribeChatHistory(actor,data.connectionId as string);break;
    case 'chat-read':result=await readTribeChat(actor,data.connectionId as string,session);break;
    case 'chat-send':result=await sendTribeChatMessage(actor,data.connectionId as string,session,data.messageId,data.text);break;
    case 'chat-clear':result=await clearTribeChatHistory(actor,data.connectionId as string,session);break;
    case 'notifications':result=await listReservedUserNotifications({recipientUserId:actor},session);break;
    case 'notification-read':await markReservedUserNotificationRead({recipientUserId:actor,notificationId:data.notificationId as string},session);result={read:true};break;
   }
   response.status(200).json(result);
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(['TRIBE_INVALID','TRIBE_CODE_INVALID','TRIBE_SEARCH_INVALID','TRIBE_CONTACT_INVALID','TRIBE_MESSAGE_INVALID'].includes(code))response.status(400).json({error:'TRIBE_INVALID'});
   else if(['TRIBE_ACCESS_DENIED','TRIBE_RECOVERY_DENIED','TRIBE_SETUP_UNAVAILABLE','TRIBE_CONNECTION_REQUIRED','USER_NOTIFICATION_NOT_FOUND'].includes(code))response.status(403).json({error:'TRIBE_ACCESS_DENIED'});
   else if(['TRIBE_LIMIT_REACHED','TRIBE_DIRECTORY_LIMIT','TRIBE_MESSAGE_CONFLICT','TRIBE_GROUP_CONFLICT'].includes(code))response.status(409).json({error:code});
   else response.status(503).json({error:'TRIBE_UNAVAILABLE'});
   // Never log request bodies, codes, capabilities, IDs or raw SDK exceptions.
  }
 };
}
export const handleReservedTribePilotRequest=createReservedTribePilotHandler({
 allowed:()=>reservedTribePilotEnvironmentAllowed(process.env),
 project:getFirebaseAdminProjectId,
 verify:token=>adminAuth.verifyIdToken(token,true),
});
