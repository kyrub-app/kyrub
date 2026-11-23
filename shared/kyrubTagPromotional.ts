/**
 * Promotional Kyrub Tags are not pre-reserved to a recipient.
 * The first successfully verified e-mail identity may claim one.
 * This is a conscious product choice: knowledge of the public URI before
 * delivery can permit early claim. Never apply this policy to protected stock.
 */
export type PromotionalTagPresentation={
  name:string;
  occupation:string;
  about:string;
};
export const EMPTY_PROMOTIONAL_PRESENTATION:PromotionalTagPresentation={name:'',occupation:'',about:''};
export const PROMOTIONAL_TAG_KIND='promotional' as const;

type ProspectiveTag={
  distribution?:unknown;
  ownerId?:unknown;
  enabled?:unknown;
  activationHash?:unknown;
  reservedEmailHash?:unknown;
  blocked?:unknown;
};

export function isOpenPromotionalTag(data:ProspectiveTag|undefined):boolean{
  return data?.distribution===PROMOTIONAL_TAG_KIND &&
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

export function normalizePromotionalPresentation(input:unknown):PromotionalTagPresentation{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('TAG_PRESENTATION_INVALID');
  const entry=input as Record<string,unknown>;
  if(Object.keys(entry).some(key=>!['name','occupation','about'].includes(key)))throw Error('TAG_PRESENTATION_INVALID');
  return {name:clean(entry.name,80),occupation:clean(entry.occupation,90),about:clean(entry.about,320)};
}
