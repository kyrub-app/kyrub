export type PrivacyFixtureCorrection={expectedDisplayName:string;displayName:string};
export type PrivacyFixtureCorrectionReceipt={protocol:string;field:'displayName';corrected:true;simulation:true;completeCorrectionResponse:false};
export type PrivacyFixtureConfirmation={protocol:string;simulation:true;completeConfirmationResponse:false;categories:('profile'|'preferences')[]};
export function normalizePrivacyFixtureCorrection(input:unknown):PrivacyFixtureCorrection{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PRIVACY_CORRECTION_INVALID');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==2||Object.keys(v).some(k=>!['expectedDisplayName','displayName'].includes(k))||typeof v.expectedDisplayName!=='string'||typeof v.displayName!=='string'||v.expectedDisplayName.length>120||v.displayName.length>240)throw Error('PRIVACY_CORRECTION_INVALID');
 const displayName=v.displayName.trim().normalize('NFC');
 if(!v.expectedDisplayName||!displayName||displayName.length>120||displayName===v.expectedDisplayName||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(displayName))throw Error('PRIVACY_CORRECTION_INVALID');
 return {expectedDisplayName:v.expectedDisplayName,displayName};
}
