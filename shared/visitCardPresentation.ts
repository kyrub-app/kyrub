export type VisitCardPresentation={name:string;occupation:string;about:string};
export const EMPTY_VISIT_CARD_PRESENTATION:VisitCardPresentation={name:'',occupation:'',about:''};
export function normalizeVisitCardPresentation(value:unknown):VisitCardPresentation{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CARD');
 const source=value as Record<string,unknown>;
 if(Object.keys(source).length!==3||Object.keys(source).some(k=>!['name','occupation','about'].includes(k)))throw Error('INVALID_CARD');
 const clean=(key:keyof VisitCardPresentation,limit:number)=>{
  const text=source[key];if(typeof text!=='string'||text.length>limit)throw Error('INVALID_CARD');
  return text.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');
 };
 return {name:clean('name',80),occupation:clean('occupation',90),about:clean('about',320)};
}
export function readVisitCardPresentation(value:unknown):VisitCardPresentation|undefined{
 try{return normalizeVisitCardPresentation(value);}catch{return undefined;}
}
export function hasVisitCardPresentation(value:VisitCardPresentation|undefined):boolean{
 return !!(value?.name||value?.occupation||value?.about);
}
