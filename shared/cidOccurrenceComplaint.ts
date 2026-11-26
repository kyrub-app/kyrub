export const CID_COMPLAINT_CATEGORIES={misuse:'Possível uso indevido',coercion:'Possível ameaça ou constrangimento',harassment:'Possível assédio',privacy:'Possível violação de privacidade',other:'Outro motivo'} as const;
export type CidComplaintCategory=keyof typeof CID_COMPLAINT_CATEGORIES;
export type CidComplaintInput={category:CidComplaintCategory;reason:string;confirmed:true};
export type CidComplaintReceipt={id:string;status:'pending-review'};
export function normalizeCidComplaint(input:unknown):CidComplaintInput{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('CID_COMPLAINT_INVALID');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==3||Object.keys(v).some(k=>!['category','reason','confirmed'].includes(k))||typeof v.category!=='string'||!Object.hasOwn(CID_COMPLAINT_CATEGORIES,v.category)||v.confirmed!==true||typeof v.reason!=='string'||v.reason.length>1000)throw Error('CID_COMPLAINT_INVALID');
 const reason=v.reason.normalize('NFC').trim();
 if(!reason||reason.length>500||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(reason))throw Error('CID_COMPLAINT_INVALID');
 return {category:v.category as CidComplaintCategory,reason,confirmed:true};
}
