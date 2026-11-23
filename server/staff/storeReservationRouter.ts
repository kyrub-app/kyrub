import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { hasStorePermission } from '../../src/utils/storeSecurity.js';
import { resolveStaffActor } from './staffNoticeService.js';
import {
  readAuthorizedStoreReservationsEnabled,
  setAuthorizedStoreReservationsEnabled,
} from './storeReservationSettingsService.js';

type Input = {
  method?: string;
  path?: string;
  query?: Record<string,unknown>;
  body?: unknown;
  headers?: Record<string,string|string[]|undefined>;
};
type Output = {
  setHeader: (key: string, value: string) => unknown;
  status: (status: number) => { json: (payload: unknown) => unknown };
};
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const isValidLocalDateTime = (value: string): boolean => {
  if (!LOCAL_DATE_TIME.test(value)) return false;
  const [date,time] = value.split('T'), [y,m,d]=date.split('-').map(Number);
  const [hour,minute,second]=time.split(':').map(Number);
  const candidate=new Date(Date.UTC(y,m-1,d,hour,minute,second));
  return candidate.getUTCFullYear()===y &&
    candidate.getUTCMonth()===m-1 && candidate.getUTCDate()===d &&
    candidate.getUTCHours()===hour && candidate.getUTCMinutes()===minute &&
    candidate.getUTCSeconds()===second;
};

const errors = (error:unknown): {status:number;code:string;message:string} => {
  const code=error instanceof Error?error.message:'';
  if(code==='AUTH_REQUIRED'||code==='AUTH_UNAUTHORIZED') return {status:401,code:'AUTH_REQUIRED',message:'Autenticação necessária.'};
  if(code==='STAFF_NOTICE_STORE_INVALID') return {status:404,code:'RESERVATION_STORE_NOT_FOUND',message:'Loja canônica não encontrada.'};
  if(code==='STAFF_NOTICE_FORBIDDEN'||code==='RESERVATION_FORBIDDEN'||code==='RESERVATION_SETTINGS_FORBIDDEN')
    return {status:403,code:'RESERVATION_FORBIDDEN',message:'Seu acesso não permite esta operação.'};
  if(code==='RESERVATION_SETTINGS_INVALID'||code==='RESERVATION_INVALID')
    return {status:400,code:'RESERVATION_INVALID',message:'Dados da reserva inválidos.'};
  if(code==='RESERVATION_NOT_FOUND') return {status:404,code,message:'Reserva não encontrada.'};
  console.error('[staff-reservations]', error instanceof Error?error.message:String(error));
  return {status:503,code:'RESERVATION_UNAVAILABLE',message:'Reservas temporariamente indisponíveis.'};
};

export const handleStoreReservationRequest=async(request:Input,response:Output):Promise<void>=>{
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  const method=clean(request.method).toUpperCase();
  const route=(clean(request.query?.transport)==='store-reservations'
    ?clean(request.query?.path):clean(request.path)).replace(/^\/+|\/+$/g,'');
  const headers=request.headers??{};
  const rawAuth=headers.authorization??headers.Authorization;
  const auth=clean(Array.isArray(rawAuth)?rawAuth[0]:rawAuth);
  const body=request.body&&typeof request.body==='object'&&!Array.isArray(request.body)
    ?request.body as Record<string,unknown>:{};
  const legacyStoreId=clean(method==='GET'?request.query?.storeId:body.storeId);
  try{
    if(!safeId(legacyStoreId)) throw Error('STAFF_NOTICE_STORE_INVALID');
    if(route==='settings' && method==='GET'){
      const enabled=await readAuthorizedStoreReservationsEnabled({authorization:auth,legacyStoreId});
      response.status(200).json({enabled});return;
    }
    if(route==='settings' && method==='POST'){
      const enabled=await setAuthorizedStoreReservationsEnabled({
        authorization:auth,legacyStoreId,enabled:body.enabled,
      });
      response.status(200).json({enabled});return;
    }
    if(!route && (method==='GET'||method==='POST')){
      const actor=await resolveStaffActor(auth,legacyStoreId);
      if(!hasStorePermission(actor.role,'orders.create')) throw Error('RESERVATION_FORBIDDEN');
      const collection=adminDb.collection('stores/'+actor.canonicalStoreId+'/reservations');
      if(method==='GET'){
        const snapshot=await collection.where('status','==','scheduled')
          .orderBy('scheduledAt','asc').limit(200).get();
        response.status(200).json({reservations:snapshot.docs.map(doc=>({id:doc.id,...doc.data()}))});return;
      }
      const clientName=clean(body.clientName),scheduledAt=clean(body.scheduledAt);
      const people=Number(body.people);
      if(!clientName||clientName.length>160||!isValidLocalDateTime(scheduledAt)||
        !Number.isInteger(people)||people<1||people>1000)throw Error('RESERVATION_INVALID');
      const ref=collection.doc();
      await ref.set({
        clientName,scheduledAt,scheduledLocal:scheduledAt,
        scheduleTimeBasis:'store-local-unzoned',timezone:null,people,
        status:'scheduled',createdBy:actor.uid,completedBy:null,
        createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
      });
      response.status(201).json({id:ref.id});return;
    }
    const complete=/^([A-Za-z0-9_-]{1,128})\/complete$/.exec(route);
    if(method==='POST'&&complete){
      const actor=await resolveStaffActor(auth,legacyStoreId);
      if(!hasStorePermission(actor.role,'orders.create'))throw Error('RESERVATION_FORBIDDEN');
      const ref=adminDb.doc('stores/'+actor.canonicalStoreId+'/reservations/'+complete[1]);
      const updated=await adminDb.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists)throw Error('RESERVATION_NOT_FOUND');
        if(snap.get('status')==='completed')return false;
        if(snap.get('status')!=='scheduled')throw Error('RESERVATION_INVALID');
        tx.update(ref,{
          status:'completed',completedBy:actor.uid,
          completedAt:FieldValue.serverTimestamp(),
          updatedAt:FieldValue.serverTimestamp(),
        });
        return true;
      });
      response.status(200).json({id:ref.id,updated});return;
    }
    response.status(405).json({error:'Método não permitido.',code:'METHOD_NOT_ALLOWED'});
  }catch(error){
    const result=errors(error);
    response.status(result.status).json({error:result.message,code:result.code});
  }
};

/** Local Express and production serverless use the same authorized handler. */
export const createStoreReservationRouter=():Router=>{
  const router=Router();
  for(const route of ['/','/settings','/:reservationId/complete']){
    router.all(route,(request,response)=>{
      void handleStoreReservationRequest(request as Input,response as Output);
    });
  }
  return router;
};
