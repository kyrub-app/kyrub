import { buildPublicDestinationUrl } from '../../shared/publicDestinationRoutes';

export type CardDraft = { name:string; occupation:string; about:string; profile:string; store:string; community:string };
export const EMPTY_CARD_DRAFT:CardDraft={name:'',occupation:'',about:'',profile:'',store:'',community:''};
const limits={name:80,occupation:90,about:320,profile:120,store:120,community:120} as const;
export const CARD_DRAFT_KEY='kyrub.card.demo.v1';
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function normalizeCardDraft(input:unknown):CardDraft|null {
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const source=input as Record<string,unknown>;
 const result={...EMPTY_CARD_DRAFT};
 for(const key of Object.keys(limits) as (keyof CardDraft)[]){
  const value=source[key];
  if(typeof value!=='string'||value.length>limits[key])return null;
  result[key]=value.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');
 }
 for(const kind of ['profile','store','community'] as const){
  if(result[kind]){
   const identifier=result[kind].replace(/^@/,'').toLowerCase();
   if(!buildPublicDestinationUrl(kind,identifier))return null;
   result[kind]=identifier;
  }
 }
 return result;
}
export function loadCardDraft(storage:StorageLike,key=CARD_DRAFT_KEY):CardDraft|null{
 try{return normalizeCardDraft(JSON.parse(storage.getItem(key)??'null'));}catch{return null;}
}
export function saveCardDraft(storage:StorageLike,draft:CardDraft,key=CARD_DRAFT_KEY):boolean{
 const value=normalizeCardDraft(draft);
 if(!value)return false;
 try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}
}
export function clearCardDraft(storage:StorageLike,key=CARD_DRAFT_KEY):boolean{
 try{storage.removeItem(key);return true;}catch{return false;}
}
export function cardDraftUrls(draft:CardDraft):string[]{
 return (['profile','store','community'] as const).flatMap(kind=>{
  const url=buildPublicDestinationUrl(kind,draft[kind]);return url?[url]:[];
 });
}
