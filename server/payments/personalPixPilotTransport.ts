import {adminAuth} from '../firebaseAdmin.js';
import {personalPixPilotEnabled,personalPixPilotAllowed,personalPixPilotProjectReady,readPersonalPixPilot,changePersonalPixPilot} from './personalPixDestinationService.js';
import {personalPixRecentLogin} from './personalPixTransport.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
type Dependencies={env:NodeJS.ProcessEnv;projectReady:()=>boolean;verify:(token:string)=>Promise<{uid:string;aud:string;email_verified?:boolean;auth_time?:number}>;active:(uid:string)=>Promise<boolean>;read:(uid:string)=>Promise<unknown>;change:(uid:string,input:unknown)=>Promise<unknown>};
const defaults:Dependencies={env:process.env,projectReady:personalPixPilotProjectReady,verify:token=>adminAuth.verifyIdToken(token,true),active:async uid=>{const u=await adminAuth.getUser(uid);return !u.disabled&&u.emailVerified;},read:readPersonalPixPilot,change:changePersonalPixPilot};
export async function handlePersonalPixPilot(req:Request,res:Response,deps:Dependencies=defaults){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 try{if(!personalPixPilotEnabled(deps.env)||!deps.projectReady())throw Error();}catch{res.status(503).json({code:'PERSONAL_FINANCE_DISABLED'});return;}
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 if(Object.keys(req.query??{}).length){res.status(400).json({code:'PERSONAL_PIX_INVALID'});return;}
 const h=req.headers.authorization,token=typeof h==='string'&&h.length<=8199?/^Bearer (\S+)$/i.exec(h)?.[1]:undefined;
 if(!token){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 let identity:Awaited<ReturnType<Dependencies['verify']>>;
 try{identity=await deps.verify(token);if(identity.aud!=='kyrub-b8d0e'||identity.email_verified!==true||!(/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)))throw Error();}catch{res.status(401).json({code:'AUTH_REQUIRED'});return;}
 try{
  if(!personalPixPilotAllowed(identity.uid,deps.env)||!await deps.active(identity.uid)){res.status(403).json({code:'PERSONAL_PIX_FORBIDDEN'});return;}
  if(req.method==='GET'){res.status(200).json(await deps.read(identity.uid));return;}
  const media=req.headers['content-type'];if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){res.status(415).json({code:'JSON_REQUIRED'});return;}
  if(Buffer.byteLength(JSON.stringify(req.body)??'','utf8')>2048){res.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
  if(!personalPixRecentLogin(identity.auth_time)){res.status(403).json({code:'REAUTHENTICATION_REQUIRED'});return;}
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw Error('PERSONAL_PIX_INVALID');
  const b=req.body as Record<string,unknown>;
  const fields=b.action==='declare'?['action','expectedRevision','confirmed','destination']:['action','expectedRevision','confirmed'];
  if((b.action!=='declare'&&b.action!=='revoke')||Object.keys(b).length!==fields.length||Object.keys(b).some(k=>!fields.includes(k))||b.confirmed!==true||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0)throw Error('PERSONAL_PIX_INVALID');
  res.status(200).json(await deps.change(identity.uid,b));
 }catch(e){
  const code=e instanceof Error?e.message:'';
  const status=code==='PERSONAL_PIX_INVALID'?400:['IDENTITY_VERIFICATION_REQUIRED','PERSONAL_CID_UNAVAILABLE'].includes(code)?403:code==='PERSONAL_PIX_CONFLICT'?409:503;
  res.status(status).json({code:status===503?'PERSONAL_FINANCE_UNAVAILABLE':code});
 }
}
