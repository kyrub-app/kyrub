import { parsePublicDestinationUrl, buildPublicDestinationUrl } from '../../shared/publicDestinationRoutes.js';
export type CardTarget = {kind:'profile'|'store'|'community';identifier:string};
export type CardLink = CardTarget & {name:string;url:string};
export const CARD_LIMIT=8;
export function parseCardTargets(value:unknown):CardTarget[] {
  if(!Array.isArray(value)||value.length<1||value.length>CARD_LIMIT)throw Error('INVALID_CARD');
  const seen=new Set<string>();
  return value.map(url=>{
    if(typeof url!=='string'||url.length>180)throw Error('INVALID_CARD');
    const target=parsePublicDestinationUrl(url);
    if(!target||target.kind==='card'||seen.has(url))throw Error('INVALID_CARD');
    seen.add(url);
    return {kind:target.kind,identifier:target.identifier};
  });
}
export function cardLink(target:CardTarget,name:string):CardLink {
  const url=buildPublicDestinationUrl(target.kind,target.identifier);
  if(!url||!name.trim())throw Error('INVALID_CARD');
  return {...target,name:name.trim().slice(0,160),url};
}
export const isCardId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
export function isBoundTarget(value:unknown):value is CardTarget & {bindingId:string} {
  if(!value||typeof value!=='object')return false;
  const t=value as Record<string,unknown>;
  return (t.kind==='profile'||t.kind==='store'||t.kind==='community')&&typeof t.identifier==='string'&&
    !!buildPublicDestinationUrl(t.kind,t.identifier)&&typeof t.bindingId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(t.bindingId);
}
