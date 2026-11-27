import {adminAuth} from '../firebaseAdmin.js';
import {requireApprovedWorkProfile} from '../identity/workEligibilityMiddleware.js';
import {updateKyrubDeliveryStatus} from './deliveryOpportunityRouter.js';
type Request={method?:string;headers?:Record<string,unknown>;body?:unknown};
type Response={setHeader:(name:string,value:string)=>unknown;status:(code:number)=>{json:(body:unknown)=>unknown}};
export async function handleDeliveryAcceptance(req:Request,res:Response,id:string){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(process.env.KYRUB_DELIVERY_ACCEPTANCE_ENABLED!=='true'||process.env.VERCEL_ENV!=='production'){
  res.status(503).json({error:'DELIVERY_ACCEPTANCE_DISABLED'});return;
 }
 if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
 const body=req.body;
 if(!/^order-[a-f0-9]{64}$/.test(id)||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||(body as {confirmed?:unknown}).confirmed!==true){res.status(400).json({error:'DELIVERY_ACCEPTANCE_INVALID'});return;}
 const authorization=req.headers?.authorization;
 const token=typeof authorization==='string'&&authorization.length<=8198?/^Bearer (\S+)$/.exec(authorization)?.[1]:undefined;
 if(!token){res.status(401).json({error:'AUTH_REQUIRED'});return;}
 try{
  const actor=await adminAuth.verifyIdToken(token,true);
  await requireApprovedWorkProfile(actor.uid,'courier');
  await updateKyrubDeliveryStatus(id,'accepted',{uid:actor.uid,name:typeof actor.name==='string'&&actor.name.trim()?actor.name.trim():'Entregador Kyrub'},{requireCanonicalAcceptance:true});
  res.status(200).json({accepted:true,deliveryId:id,courierId:actor.uid,status:'accepted'});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(message==='IDENTITY_VERIFICATION_REQUIRED'||message==='DELIVERY_ACCEPTANCE_FORBIDDEN'){res.status(403).json({error:'DELIVERY_ACCEPTANCE_FORBIDDEN'});return;}
  if(message==='DELIVERY_ACCEPTANCE_CONFLICT'||/já aceitou|já foi aceita|não foi encontrada/.test(message)){res.status(409).json({error:'DELIVERY_ACCEPTANCE_CONFLICT'});return;}
  res.status(503).json({error:'DELIVERY_ACCEPTANCE_UNCONFIRMED'});
 }
}
