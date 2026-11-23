import { Router } from 'express';
import { getStoreMediaForManager, saveStoreMediaForManager } from './storeMediaService.js';

type Request={method?:string;query?:Record<string,unknown>;body?:unknown;headers?:Record<string,string|string[]|undefined>};
type Response={status:(code:number)=>{json:(body:unknown)=>unknown};setHeader:(name:string,value:string)=>unknown};

const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const errorStatus=(code:string)=>{
  if(code==='AUTH_REQUIRED')return 401;
  if(code==='STORE_MEDIA_FORBIDDEN'||code==='STAFF_NOTICE_FORBIDDEN')return 403;
  if(code==='STAFF_NOTICE_STORE_INVALID'||code==='STORE_MEDIA_NOT_FOUND')return 404;
  if(code==='STORE_MEDIA_INVALID')return 400;
  if(code==='STORE_MEDIA_CONFLICT')return 409;
  return 503;
};

export const handleStoreMediaRequest=async(req:Request,res:Response):Promise<void>=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  const authHeader=req.headers?.authorization??req.headers?.Authorization;
  const authorization=clean(Array.isArray(authHeader)?authHeader[0]:authHeader);
  const method=clean(req.method).toUpperCase();
  const body=req.body&&typeof req.body==='object'&&!Array.isArray(req.body)
    ?req.body as Record<string,unknown>:{};
  const legacyStoreId=clean(method==='GET'?req.query?.storeId:body.storeId);
  if(!['GET','POST'].includes(method)){
    res.status(405).json({code:'METHOD_NOT_ALLOWED',error:'Método não permitido.'});return;
  }
  try{
    const media=method==='GET'
      ?await getStoreMediaForManager({authorization,legacyStoreId})
      :await saveStoreMediaForManager({
        authorization,legacyStoreId,
        logo:body.logo,bannerImages:body.bannerImages,
        galleryImages:body.galleryImages,expectedVersion:body.expectedVersion,
      });
    res.status(200).json(media);
  }catch(error){
    const code=error instanceof Error?error.message:'STORE_MEDIA_UNAVAILABLE';
    const status=errorStatus(code);
    if(status===503)console.error('[store-media]',code);
    res.status(status).json({code:status===503?'STORE_MEDIA_UNAVAILABLE':code,
      error:status===403?'Você não possui permissão para gerenciar as imagens desta loja.'
        :status===409?'As imagens foram alteradas por outra pessoa. Atualize e tente novamente.'
        :status===404?'Loja não encontrada.':status===400?'Dados das imagens inválidos.'
        :status===401?'Faça login para continuar.':'Imagens da loja temporariamente indisponíveis.'});
  }
};

export const createStoreMediaRouter=():Router=>{
  const router=Router();
  router.all('/',(request,response)=>{void handleStoreMediaRequest(request as Request,response as Response);});
  return router;
};
