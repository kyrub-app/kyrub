// Server-only domain policy. No location permission request, IP lookup, hardware ingestion,
// database write, or HTTP endpoint. All identity and timestamps must be verified server-side.
// Do not expose individual visitor IP-derived regions or raw technical logs to a tag owner.
import {isTagId} from '../../shared/kyrubTagContract.js';
import type {CidSosOccurrence} from './cidSosAlertPolicy.js';
type Tag={tagId:string;ownerId:string;active:boolean};
type Point={latitude:number;longitude:number;accuracy:number};
export type CidAccessObservation={kind:'cid-access';tagId:string;observedAt:number};
export type CidVoluntaryObservation={kind:'visitor-shared';tagId:string;occurrenceId:string;observedAt:number;point:Point};
export type CidDeviceObservation={kind:'device-gps';tagId:string;deviceId:string;observedAt:number;point:Point};
export type CidLocationObservation=CidAccessObservation|CidVoluntaryObservation|CidDeviceObservation;
const deny=():never=>{throw Error('CID_LOCATION_FORBIDDEN');};
const validTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function assertTag(tag:Tag){
 if(!tag||!isTagId(tag.tagId)||!validId(tag.ownerId))return deny();
}
function assertOwner(tag:Tag,verifiedOwnerId:string){
 assertTag(tag);if(tag.ownerId!==verifiedOwnerId)return deny();
}
function validPoint(input:unknown):Point{
 if(!input||typeof input!=='object'||Array.isArray(input))return deny();
 const p=input as Record<string,unknown>,inRange=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(!inRange(p.latitude,-90,90)||!inRange(p.longitude,-180,180)||!inRange(p.accuracy,0,10000000))return deny();
 return {latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy};
}
// An HTTP access does not prove NFC reading or proximity. No visitor identity, location,
// IP address, browser fingerprint, or other technical access metadata is collected here.
// A future adapter should minimize writes and avoid counting previews/bots as human reads.
export function observeCidAccess(tag:Tag,serverNow:number):CidAccessObservation{
 assertTag(tag);if(!tag.active||!validTime(serverNow))return deny();
 return {kind:'cid-access',tagId:tag.tagId,observedAt:serverNow};
}
// Derive coordinates ONLY from a trusted, committed occurrence whose emitter chose to share.
// The time is when the occurrence was registered, not a verified GPS measurement timestamp.
export function observeCidVoluntaryLocation(tag:Tag,occurrence:CidSosOccurrence):CidVoluntaryObservation|null{
 assertTag(tag);
 if(!occurrence||occurrence.tagId!==tag.tagId||occurrence.ownerId!==tag.ownerId||!validId(occurrence.id)||!validTime(occurrence.createdAt))return deny();
 if(!occurrence.location)return null;
 if(occurrence.location.consent!==true)return deny();
 return {kind:'visitor-shared',tagId:tag.tagId,occurrenceId:occurrence.id,observedAt:occurrence.createdAt,point:validPoint(occurrence.location)};
}
// Reserved hardware boundary. A real adapter must verify device credentials, enrollment,
// telemetry authenticity, replay protection, clock and revocation. Never accept these
// observations from anonymous CID access or a caller-supplied claim that GPS is enabled.
export type VerifiedDeviceFix={tagId:string;deviceId:string;observedAt:number;point:Point};
export function observeVerifiedDeviceGps(tag:Tag,fix:VerifiedDeviceFix,serverNow:number):CidDeviceObservation{
 assertTag(tag);if(!tag.active||!fix||fix.tagId!==tag.tagId||!validId(fix.deviceId)||!validTime(fix.observedAt)||!validTime(serverNow)||fix.observedAt>serverNow)return deny();
 return {kind:'device-gps',tagId:tag.tagId,deviceId:fix.deviceId,observedAt:fix.observedAt,point:validPoint(fix.point)};
}
export const CID_LOCATION_LABELS={
 access:'Último acesso ao CID',
 shared:'Localização compartilhada',
 device:'Última posição informada pelo dispositivo',
 accessNote:'O acesso ao CID não comprova leitura NFC ou presença física da Tag.',
 sharedNote:'Localização informada por um participante autorizado. Não comprova a posição física da Tag.',
 deviceNote:'Coordenadas informadas pelo dispositivo. Não representam necessariamente sua posição atual.'
} as const;
// Trusted, retained observations only. The storage adapter must enforce occurrence membership,
// consent and retention before passing records to this projection. No public projection exists.
export function projectOwnerAssistedLocation(tag:Tag,verifiedOwnerId:string,observations:readonly CidLocationObservation[],serverNow:number){
 assertOwner(tag,verifiedOwnerId);if(!validTime(serverNow))return deny();
 const records=observations.filter(r=>r.tagId===tag.tagId&&validTime(r.observedAt)&&r.observedAt<=serverNow);
 const latest=<T extends CidLocationObservation['kind']>(kind:T)=>records.filter((r):r is Extract<CidLocationObservation,{kind:T}>=>r.kind===kind).sort((a,b)=>b.observedAt-a.observedAt)[0];
 const access=latest('cid-access'),shared=latest('visitor-shared'),device=latest('device-gps');
 return {
  access:access?{observedAt:access.observedAt}:null,
  shared:shared?{observedAt:shared.observedAt,occurrenceId:shared.occurrenceId,point:validPoint(shared.point)}:null,
  device:device?{observedAt:device.observedAt,point:validPoint(device.point)}:null,
  labels:CID_LOCATION_LABELS
 };
}
