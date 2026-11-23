import type {PromotionalTagPresentation} from './kyrubTagPromotional';
export const KYRUB_TAG_MODELS=['pitanga','pulseira','cartao','adesivo'] as const;
export type KyrubTagModel=(typeof KYRUB_TAG_MODELS)[number];
export const KYRUB_TAG_MODEL_LABELS:Record<KyrubTagModel,string>={pitanga:'Chaveiro Pitanga',pulseira:'Pulseira',cartao:'Cartão',adesivo:'Adesivo'};
export const isTagId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
export const isTagModel=(v:unknown):v is KyrubTagModel=>KYRUB_TAG_MODELS.includes(v as KyrubTagModel);
export const tagPath=(id:string)=>isTagId(id)?'/tag/'+id:null;
export const tagUrl=(id:string)=>isTagId(id)?'https://kyrub.com/tag/'+id:null;
export type OwnedKyrubTag={id:string;model:KyrubTagModel;enabled:boolean;urls:string[];distribution?:'promotional';presentation?:PromotionalTagPresentation;blocked?:boolean};

export const normalizeTagRecipientEmail=(value:unknown):string|null=>typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():null;

// Only two explicitly supported external destinations. No arbitrary redirects,
// query strings, credentials, URL shortening or user-controlled schemes.
export type TagExternalKind='whatsapp'|'instagram';
export type TagExternalLink={kind:TagExternalKind;name:string;url:string};
export function parseTagExternalUrl(value:unknown):TagExternalLink|null{
 if(typeof value!=='string'||value.length>180)return null;
 if(/^https:\/\/wa\.me\/[1-9][0-9]{7,14}$/.test(value))return {kind:'whatsapp',name:'WhatsApp',url:value};
 if(/^https:\/\/www\.instagram\.com\/[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?\/$/.test(value)&&!value.includes('..')&&!/\/(accounts|explore|reels|reel|p|stories|direct|about|challenge|oauth)\/$/i.test(value))return {kind:'instagram',name:'Instagram',url:value};
 return null;
}
export function buildTagExternalUrl(kind:TagExternalKind,value:string):string|null{
 const trimmed=value.trim();
 const url=kind==='whatsapp'?'https://wa.me/'+trimmed.replace(/[+ ()-]/g,''):'https://www.instagram.com/'+trimmed.replace(/^@/,'').toLowerCase()+'/';
 return parseTagExternalUrl(url)?.url??null;
}
export type TagDestinationOption={kind:'profile'|'store'|'community'|TagExternalKind;name:string;url:string};
export type TagDestinationCatalog={profile:{eligible:boolean;identifier:string|null};options:TagDestinationOption[];unavailable:string[]};
