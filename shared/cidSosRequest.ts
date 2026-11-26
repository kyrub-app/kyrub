// Shared form contract. No permission request, geolocation call, or network access.
export const CID_SOS_NOTICE='As informações desta ocorrência, incluindo mensagens e registros técnicos de acesso, poderão ser preservadas e fornecidas às autoridades competentes, conforme a legislação aplicável. O uso indevido desta funcionalidade poderá resultar em responsabilização legal.';
export const CID_SOS_REASON_PLACEHOLDER='Ex.: Tag encontrada; animal encontrado; emergência acionada.';
export const CID_SOS_CHAT_GREETING='Alerta recebido. Por favor, explique a situação.';
export const CID_SOS_MAX_CONTACTS=3;
export type CidSosSharedLocation={latitude:number;longitude:number;accuracy:number;consent:true};
export type CidSosRequest={id:string;confirmed:true;reason:string;sms:boolean;location?:CidSosSharedLocation};
const fail=():never=>{throw Error('CID_SOS_UNAVAILABLE');};
export function normalizeCidSosRequest(value:unknown):CidSosRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const r=value as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['id','confirmed','reason','sms','location'].includes(k))||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{22,80}$/.test(r.id)||r.confirmed!==true||typeof r.sms!=='boolean'||typeof r.reason!=='string'||r.reason.length>1000)return fail();
 const reason=r.reason.normalize('NFC').trim();
 if(!reason||reason.length>500||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(reason))return fail();
 if(r.location===undefined)return {id:r.id,confirmed:true,reason,sms:r.sms};
 if(!r.location||typeof r.location!=='object'||Array.isArray(r.location))return fail();
 const loc=r.location as Record<string,unknown>;
 const inRange=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(Object.keys(loc).some(k=>!['latitude','longitude','accuracy','consent'].includes(k))||loc.consent!==true||!inRange(loc.latitude,-90,90)||!inRange(loc.longitude,-180,180)||!inRange(loc.accuracy,0,10000000))return fail();
 return {id:r.id,confirmed:true,reason,sms:r.sms,location:{latitude:loc.latitude,longitude:loc.longitude,accuracy:loc.accuracy,consent:true}};
}
