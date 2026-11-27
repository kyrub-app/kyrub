export type FreelanceStoreRepresentation={storeId:string;displayName:string;representativeRole:'owner'};
export function readFreelanceStoreRepresentation(value:unknown):FreelanceStoreRepresentation|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3)throw Error('FREELANCE_INVALID');
 const v=value as Record<string,unknown>;
 if(typeof v.storeId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v.storeId)||typeof v.displayName!=='string'||!v.displayName.trim()||v.displayName.trim()!==v.displayName||v.displayName.length>200||v.representativeRole!=='owner')throw Error('FREELANCE_INVALID');
 return {storeId:v.storeId,displayName:v.displayName,representativeRole:'owner'};
}
export function sameFreelanceStoreRepresentation(a:unknown,b:unknown):boolean{
 try{return JSON.stringify(readFreelanceStoreRepresentation(a))===JSON.stringify(readFreelanceStoreRepresentation(b));}catch{return false;}
}
