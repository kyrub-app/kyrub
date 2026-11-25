/** Snapshot of advertised conditions, expressed in integer BRL cents.
 * No payment confirmation or inference from a free-text negotiation. */
export type FreelanceHiringTerms = {
 schemaVersion:1;
 title:string;
 description:string;
 paymentCents:number;
 currency:'BRL';
};
export function parseHiringTerms(value:unknown):FreelanceHiringTerms|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const x=value as Record<string,unknown>;
 if(x.schemaVersion!==1||x.currency!=='BRL'||typeof x.title!=='string'||!x.title.trim()||x.title!==x.title.trim()||x.title.length>120||typeof x.description!=='string'||!x.description.trim()||x.description!==x.description.trim()||x.description.length>2000||typeof x.paymentCents!=='number'||!Number.isSafeInteger(x.paymentCents)||x.paymentCents<1||x.paymentCents>100000000)return null;
 return {schemaVersion:1,title:x.title,description:x.description,paymentCents:x.paymentCents,currency:'BRL'};
}
export function termsFromVacancy(value:unknown):FreelanceHiringTerms|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const x=value as Record<string,unknown>;
 if(typeof x.payment!=='number'||!Number.isFinite(x.payment)||Math.round(x.payment*100)/100!==x.payment)return null;
 return parseHiringTerms({schemaVersion:1,title:x.title,description:x.description,paymentCents:Math.round(x.payment*100),currency:'BRL'});
}
export function sameHiringTerms(a:FreelanceHiringTerms|null,b:FreelanceHiringTerms|null):boolean{
 return !!a&&!!b&&a.title===b.title&&a.description===b.description&&a.paymentCents===b.paymentCents&&a.currency===b.currency&&a.schemaVersion===b.schemaVersion;
}
