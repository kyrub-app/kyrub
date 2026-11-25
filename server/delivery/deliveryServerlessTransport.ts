import {adminAuth} from '../firebaseAdmin.js';
import {requireApprovedWorkProfile} from '../identity/workEligibilityMiddleware.js';
import {parseDeliveryWorkRoute} from './deliveryServerlessPolicy.js';
import {publishKyrubDeliveryOpportunity,updateKyrubDeliveryStatus} from './deliveryOpportunityRouter.js';
import {readOrCreateDeliveryPickupCodeForStore,confirmSecureCourierPickupAndStartRoute} from './deliveryPickupHandoffService.js';
import {markCourierArrivedAtCustomer,confirmBuyerReceivedDelivery} from './deliveryCustomerHandoffService.js';
import {loadCourierEarningsProjection} from './courierEarningsProjectionService.js';
import {materializeDeliveryResponsibilityAndWaitingDecision} from './deliveryResponsibilityDecisionOrchestrator.js';

type Input={method?:string;headers?:Record<string,unknown>;body?:unknown};
type Output={
  status:(code:number)=>{json:(body:unknown)=>unknown};
  json:(body:unknown)=>unknown;
  setHeader:(name:string,value:string)=>unknown;
};
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const bodyOf=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const bearer=(v:unknown)=>{
  if(typeof v!=='string'||v.length>8198)return '';
  return /^Bearer\s+(\S+)$/i.exec(v.trim())?.[1]??'';
};
const failure=(res:Output,err:unknown)=>{
  const message=err instanceof Error?err.message:'';
  if(message==='AUTH_REQUIRED'||/id-token|expired|revoked/i.test(message)){
    res.status(401).json({error:'Faça login novamente.',code:'AUTH_REQUIRED'});return;
  }
  if(message==='IDENTITY_VERIFICATION_REQUIRED'){
    res.status(403).json({error:'A verificação e aprovação do perfil exigido são necessárias antes desta ação.',code:message});return;
  }
  if(/não identificad|inválid/i.test(message)){
    res.status(400).json({error:message||'Dados inválidos.',code:'DELIVERY_INVALID'});return;
  }
  if(/não encontrad|não está pront|não é uma entrega|entregador próprio|já aceitou|já foi aceita|somente|precisa|confirme|código|geofence|chegue|coleta|rota|cliente|delivery/i.test(message)){
    res.status(409).json({error:message,code:'DELIVERY_CONFLICT'});return;
  }
  console.error('[delivery-work-transport]',err);
  res.status(503).json({error:'Operação de entrega temporariamente indisponível.',code:'DELIVERY_UNAVAILABLE'});
};

export async function handleDeliveryWorkServerless(req:Input,res:Output,path:string):Promise<void>{
  res.setHeader('Cache-Control','no-store, max-age=0');
  const action=parseDeliveryWorkRoute(req.method??'GET',path);
  if(!action){res.status(404).json({error:'Rota de entregas não reconhecida.',code:'DELIVERY_ROUTE_NOT_FOUND'});return;}
  try{
    const token=bearer(req.headers?.authorization??req.headers?.Authorization);
    if(!token)throw Error('AUTH_REQUIRED');
    const actor=await adminAuth.verifyIdToken(token,true);
    const uid=actor.uid;
    if(action.kind==='publish'){
      await requireApprovedWorkProfile(uid,'requester');
      res.status(200).json(await publishKyrubDeliveryOpportunity(uid,action.id));return;
    }
    if(action.kind==='earnings'){
      res.status(200).json(await loadCourierEarningsProjection(uid));return;
    }
    if(action.kind==='pickup-code'){
      res.status(200).json(await readOrCreateDeliveryPickupCodeForStore({deliveryId:action.id,storeId:uid}));return;
    }
    if(action.kind==='buyer-confirmation'){
      res.status(200).json(await confirmBuyerReceivedDelivery({deliveryId:action.id,buyerId:uid}));return;
    }
    await requireApprovedWorkProfile(uid,'courier');
    if(action.kind==='status'){
      const status=clean(bodyOf(req.body).status);
      if(status!=='accepted'&&status!=='delivering'&&status!=='done'){
        res.status(400).json({error:'Status de entrega inválido.',code:'DELIVERY_INVALID_STATUS'});return;
      }
      await updateKyrubDeliveryStatus(action.id,status,{uid,name:clean(actor.name)||clean(actor.email)||'Entregador Kyrub'});
      res.status(200).json({ok:true,deliveryId:action.id,status});return;
    }
    if(action.kind==='secure-pickup'){
      const result=await confirmSecureCourierPickupAndStartRoute({
        deliveryId:action.id,courierId:uid,handoffCode:clean(bodyOf(req.body).handoffCode)
      });
      try{
        await materializeDeliveryResponsibilityAndWaitingDecision({deliveryId:action.id});
      }catch(error){console.error('[delivery-work-responsibility]',error);}
      res.status(200).json(result);return;
    }
    if(action.kind==='customer-arrival'){
      res.status(200).json(await markCourierArrivedAtCustomer({deliveryId:action.id,courierId:uid}));return;
    }
    res.status(404).json({error:'Rota de entregas não reconhecida.',code:'DELIVERY_ROUTE_NOT_FOUND'});
  }catch(error){failure(res,error);}
}
