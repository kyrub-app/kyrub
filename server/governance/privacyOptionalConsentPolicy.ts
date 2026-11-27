import {createHash} from 'node:crypto';
import {OPTIONAL_CONSENT_PURPOSES,normalizeOptionalConsentChoice,type OptionalConsentPurpose,type OptionalConsentRecord,type OptionalConsentView} from '../../shared/privacyOptionalConsent.js';
const deny=():never=>{throw Error('OPTIONAL_CONSENT_FORBIDDEN');};
export function optionalConsentNoticeHash(purpose:OptionalConsentPurpose){
 const d=OPTIONAL_CONSENT_PURPOSES[purpose];if(!d)return deny();
 return createHash('sha256').update(JSON.stringify({purpose,...d})).digest('hex');
}
export function projectOptionalConsent(purpose:OptionalConsentPurpose,record:OptionalConsentRecord|undefined):OptionalConsentView{
 const d=OPTIONAL_CONSENT_PURPOSES[purpose];if(!d)return deny();
 if(record&&(record.purpose!==purpose||record.simulation!==true||!Number.isSafeInteger(record.revision)||record.revision<1||!Number.isSafeInteger(record.changedAt)||record.changedAt<=0||!['granted','withdrawn'].includes(record.state)||typeof record.version!=='string'||!record.version||!(/^[a-f0-9]{64}$/).test(record.noticeHash)))return deny();
 const effective=record?.state==='granted'&&record.version===d.version&&record.noticeHash===optionalConsentNoticeHash(purpose);
 return {purpose,...d,revision:record?.revision??0,state:record?.state==='withdrawn'?'withdrawn':effective?'granted':'not-granted',effective:!!effective,canWithdraw:record?.state==='granted',simulation:true};
}
export function prepareOptionalConsent(input:unknown,prior:OptionalConsentRecord|undefined,now:number):OptionalConsentRecord{
 const choice=normalizeOptionalConsentChoice(input),view=projectOptionalConsent(choice.purpose,prior),d=OPTIONAL_CONSENT_PURPOSES[choice.purpose];
 if(!Number.isSafeInteger(now)||now<=0||prior&&prior.changedAt>now||choice.expectedRevision!==view.revision||choice.version!==d.version)return deny();
 if(choice.decision==='grant'&&view.effective||choice.decision==='withdraw'&&prior?.state!=='granted')return deny();
 return {purpose:choice.purpose,version:choice.decision==='withdraw'?prior!.version:d.version,noticeHash:choice.decision==='withdraw'?prior!.noticeHash:optionalConsentNoticeHash(choice.purpose),revision:view.revision+1,state:choice.decision==='grant'?'granted':'withdrawn',changedAt:now,simulation:true};
}
