export const KYRUB_TAG_MODELS=['pitanga','pulseira','cartao','adesivo'] as const;
export type KyrubTagModel=(typeof KYRUB_TAG_MODELS)[number];
export const KYRUB_TAG_MODEL_LABELS:Record<KyrubTagModel,string>={pitanga:'Chaveiro Pitanga',pulseira:'Pulseira',cartao:'Cartão',adesivo:'Adesivo'};
export const isTagId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
export const isTagModel=(v:unknown):v is KyrubTagModel=>KYRUB_TAG_MODELS.includes(v as KyrubTagModel);
export const tagPath=(id:string)=>isTagId(id)?'/tag/'+id:null;
export const tagUrl=(id:string)=>isTagId(id)?'https://kyrub.com/tag/'+id:null;
export type OwnedKyrubTag={id:string;model:KyrubTagModel;enabled:boolean;urls:string[]};
