import type {PrivacyOwnDataExport,PrivacyExportCategory} from '../../shared/privacyOwnDataExport.js';
const deny=():never=>{throw Error('PRIVACY_EXPORT_FORBIDDEN');};
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
type FixtureRecord={simulation:true;ownerUid:string;displayName?:unknown;createdAt?:unknown;locale?:unknown;theme?:unknown};
export function projectOwnDataFixture(input:{protocol:string;ownerUid:string;now:number;profile?:FixtureRecord;preferences?:FixtureRecord}):PrivacyOwnDataExport{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.protocol)||!/^[A-Za-z0-9_-]{1,128}$/.test(input.ownerUid)||!time(input.now))return deny();
 const data:PrivacyOwnDataExport['data']={},categories:PrivacyExportCategory[]=[];
 if(input.profile){
  const p=input.profile;
  if(p.simulation!==true||p.ownerUid!==input.ownerUid||!str(p.displayName,120)||!time(p.createdAt)||p.createdAt>input.now)return deny();
  data.profile={displayName:p.displayName,createdAt:p.createdAt};categories.push('profile');
 }
 if(input.preferences){
  const p=input.preferences;
  if(p.simulation!==true||p.ownerUid!==input.ownerUid||!str(p.locale,16)||!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(p.locale)||!['light','dark','system'].includes(String(p.theme)))return deny();
  data.preferences={locale:p.locale,theme:p.theme as 'light'|'dark'|'system'};categories.push('preferences');
 }
 return {protocol:input.protocol,formatVersion:1,generatedAt:input.now,simulation:true,completeAccessResponse:false,categories,data};
}
