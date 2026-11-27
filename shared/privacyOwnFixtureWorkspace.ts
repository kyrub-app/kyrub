import type {PrivacyOwnDataExport} from './privacyOwnDataExport';
import type {PrivacyFixtureConfirmation,PrivacyFixtureCorrection,PrivacyFixtureCorrectionReceipt} from './privacyOwnDataCorrection';
export type PrivacyOwnFixtureAdapter={
 exportOwn:(protocol:string,code:string)=>Promise<PrivacyOwnDataExport>;
 confirmOwn:(protocol:string,code:string)=>Promise<PrivacyFixtureConfirmation>;
 correctOwn:(protocol:string,code:string,change:PrivacyFixtureCorrection)=>Promise<PrivacyFixtureCorrectionReceipt>;
};
