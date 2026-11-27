// Pure planning for synthetic exercises only; no I/O or legal decision.
export const INCIDENT_RISK_FACTORS=['sensitive','vulnerable-age-group','financial','authentication','protected-secrecy','large-scale'] as const;
type Factor=typeof INCIDENT_RISK_FACTORS[number];
type Finding='yes'|'no'|'unknown';
export type IncidentTriageInput={simulation:true;personalDataAffected:Finding;significantImpact:Finding;riskFactors:Factor[];factorAssessmentComplete:boolean;knownAt:number|null};
export type IncidentTriageResult={status:'investigate'|'urgent-notification-review'|'document-human-review'|'invalid';clockStart:number|null;simulation:true;automaticNotification:false};
const finding=(v:unknown):v is Finding=>v==='yes'||v==='no'||v==='unknown';
export function triagePrivacyIncident(input:unknown,now:number):IncidentTriageResult{
 const result=(status:IncidentTriageResult['status'],clockStart:number|null=null):IncidentTriageResult=>({status,clockStart,simulation:true,automaticNotification:false});
 if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(now)||now<=0)return result('invalid');
 const v=input as Record<string,unknown>,keys=['simulation','personalDataAffected','significantImpact','riskFactors','factorAssessmentComplete','knownAt'];
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||v.simulation!==true||!finding(v.personalDataAffected)||!finding(v.significantImpact)||!Array.isArray(v.riskFactors)||v.riskFactors.length>6||v.riskFactors.some(x=>!INCIDENT_RISK_FACTORS.some(f=>f===x))||new Set(v.riskFactors).size!==v.riskFactors.length||typeof v.factorAssessmentComplete!=='boolean')return result('invalid');
 const start=v.knownAt;
 if(start!==null&&(typeof start!=='number'||!Number.isSafeInteger(start)||start<=0||start>now))return result('invalid');
 if(v.personalDataAffected==='yes'&&start===null||v.personalDataAffected!=='yes'&&start!==null)return result('invalid');
 if(v.personalDataAffected==='unknown')return result('investigate');
 if(v.personalDataAffected==='no')return result('document-human-review');
 if(typeof start!=='number')return result('invalid');
 if(v.significantImpact==='yes'&&v.riskFactors.length>0)return result('urgent-notification-review',start);
 if(v.significantImpact==='unknown'||!v.factorAssessmentComplete)return result('investigate',start);
 return result('document-human-review',start);
}
