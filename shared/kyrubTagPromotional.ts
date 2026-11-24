/**
 * Promotional Kyrub Tags are not pre-reserved to a recipient.
 * The first successfully verified e-mail identity may claim one.
 * This is a conscious product choice: knowledge of the public URI before
 * delivery can permit early claim. Never apply this policy to protected stock.
 */
export type PromotionalSosContact={
  name:string;
  relationship:string;
  phone:string;
  whatsapp:boolean;
  shareInSos:boolean;
  consentConfirmed:boolean;
};
export type PublicSosContact=Pick<PromotionalSosContact,'name'|'relationship'|'phone'|'whatsapp'>;
export type PromotionalTagPresentation={
  name:string;
  occupation:string;
  about:string;
  emergencyContacts?:PromotionalSosContact[];
  coverPath?:string;
  avatarPath?:string;
  backgroundPath?:string;
};
export type PublicPromotionalTagPresentation={
  name:string;
  occupation:string;
  about:string;
  hasCover:boolean;
  hasAvatar:boolean;
  hasBackground?:boolean;
  sosContacts:PublicSosContact[];
  profileMedia?:{photoUrl:string;coverUrl:string;backgroundUrl:string};
  profilePaused?:boolean;
};
export const promotionalMediaPath=(id:string,slot:'cover'|'avatar'|'background',asset:string)=>`kyrub-tag-media/${id}/${slot}/${asset}`;
const mediaPathRegex=/^kyrub-tag-media\/([a-f0-9]{32})\/(cover|avatar|background)\/([a-f0-9]{32})$/;
export function isPromotionalMediaPath(path:string,id:string,slot:'cover'|'avatar'|'background'):boolean{
 const parsed=mediaPathRegex.exec(path);
 return parsed!==null&&parsed[1]===id&&parsed[2]===slot;
}

export const EMPTY_PROMOTIONAL_PRESENTATION:PromotionalTagPresentation={name:'',occupation:'',about:''};
export const PROMOTIONAL_TAG_KIND='promotional' as const;

type ProspectiveTag={
  distribution?:unknown;
  model?:unknown;
  pilotBatch?:unknown;
  pilotSlot?:unknown;
  reservedForUid?:unknown;
  firstOwnerId?:unknown;
  recoveryHash?:unknown;
  ownerId?:unknown;
  enabled?:unknown;
  activationHash?:unknown;
  reservedEmailHash?:unknown;
  blocked?:unknown;
};

export function isOpenPromotionalTag(data:ProspectiveTag|undefined):boolean{
  return data?.distribution===PROMOTIONAL_TAG_KIND &&
    data.model==='adesivo' &&
    data.pilotBatch==null &&
    data.pilotSlot==null &&
    data.reservedForUid==null &&
    data.firstOwnerId==null &&
    data.recoveryHash==null &&
    data.ownerId===null &&
    data.enabled===false &&
    data.activationHash===null &&
    data.reservedEmailHash==null &&
    data.blocked!==true;
}

function clean(value:unknown,max:number):string{
  if(typeof value!=='string'||value.length>max*3)throw Error('TAG_PRESENTATION_INVALID');
  const result=value.trim().replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,'');
  if(result.length>max)throw Error('TAG_PRESENTATION_INVALID');
  return result;
}

export function normalizePromotionalSosContacts(input:unknown):PromotionalSosContact[]{
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>2)throw Error('TAG_PRESENTATION_INVALID');
 const contacts=input.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('TAG_PRESENTATION_INVALID');
  const entry=value as Record<string,unknown>;
  if(Object.keys(entry).some(key=>!['name','relationship','phone','whatsapp','shareInSos','consentConfirmed'].includes(key)))
   throw Error('TAG_PRESENTATION_INVALID');
  const name=clean(entry.name,70),relationship=clean(entry.relationship,50);
  if(typeof entry.phone!=='string'||!/^[+()\d\s-]{10,25}$/.test(entry.phone))throw Error('TAG_PRESENTATION_INVALID');
  const digits=entry.phone.replace(/\D/g,'');
  const domestic=digits.startsWith('55')&&[12,13].includes(digits.length)?digits.slice(2):digits;
  if(![10,11].includes(domestic.length)||!domestic.match(/^[1-9][0-9]{9,10}$/))
   throw Error('TAG_PRESENTATION_INVALID');
  if(typeof entry.whatsapp!=='boolean'||typeof entry.shareInSos!=='boolean'||typeof entry.consentConfirmed!=='boolean'||
   entry.shareInSos&&!entry.consentConfirmed||!name)throw Error('TAG_PRESENTATION_INVALID');
  return {name,relationship,phone:'+55'+domestic,whatsapp:entry.whatsapp,shareInSos:entry.shareInSos,consentConfirmed:entry.consentConfirmed};
 });
 if(new Set(contacts.map(c=>c.phone)).size!==contacts.length)throw Error('TAG_PRESENTATION_INVALID');
 return contacts;
}

export function publicPromotionalPresentation(input:PromotionalTagPresentation):PublicPromotionalTagPresentation{
 return {name:input.name,occupation:input.occupation,about:input.about,
  hasCover:!!input.coverPath,hasAvatar:!!input.avatarPath,...(input.backgroundPath?{hasBackground:true}:{}),
  sosContacts:(input.emergencyContacts??[]).filter(c=>c.shareInSos&&c.consentConfirmed)
   .map(({name,relationship,phone,whatsapp})=>({name,relationship,phone,whatsapp}))};
}

export function normalizePromotionalPresentation(input:unknown):PromotionalTagPresentation{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('TAG_PRESENTATION_INVALID');
  const entry=input as Record<string,unknown>;
  if(Object.keys(entry).some(key=>!['name','occupation','about','emergencyContacts','coverPath','avatarPath','backgroundPath'].includes(key)))
   throw Error('TAG_PRESENTATION_INVALID');
  const mediaField=(slot:'cover'|'avatar'|'background')=>{
   const key=slot+'Path',value=entry[key];
   if(value===undefined||value==='')return '';
   if(typeof value!=='string'||value.length>160||!mediaPathRegex.test(value))throw Error('TAG_PRESENTATION_INVALID');
   if(mediaPathRegex.exec(value)?.[2]!==slot)throw Error('TAG_PRESENTATION_INVALID');
   return value;
  };
  return {name:clean(entry.name,80),occupation:clean(entry.occupation,90),about:clean(entry.about,320),
   ...(entry.emergencyContacts!==undefined?{emergencyContacts:normalizePromotionalSosContacts(entry.emergencyContacts)}:{}),
   ...(entry.coverPath!==undefined?{coverPath:mediaField('cover')}:{}),
   ...(entry.avatarPath!==undefined?{avatarPath:mediaField('avatar')}:{}),
   ...(entry.backgroundPath!==undefined?{backgroundPath:mediaField('background')}:{})};
}
