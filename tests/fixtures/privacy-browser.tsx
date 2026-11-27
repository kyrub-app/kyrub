import {createRoot} from 'react-dom/client';
import {startAuthentication,startRegistration,type PublicKeyCredentialCreationOptionsJSON} from '@simplewebauthn/browser';
import {KyrubPrivacyCentralPilot} from '../../src/components/KyrubPrivacyCentralPilot';
import {createPrivacyHomologationHttpClient} from '../../src/utils/privacyHomologationHttpClient';
import {AdminPrivacyGovernancePilot} from '../../src/components/admin/AdminPrivacyGovernancePilot';
import type {AdminProfile} from '../../src/utils/adminControlPlanePermissions';
import '../../src/index.css';
const root=createRoot(document.getElementById('root')!);
const client=createPrivacyHomologationHttpClient();
root.render(<p>Ambiente fictício de privacidade</p>);
Object.assign(window,{
 privacyTestMountAdmin:(profile:AdminProfile,token:string)=>root.render(<AdminPrivacyGovernancePilot key={profile.uid} profile={profile} uid={profile.uid} adapter={client.admin(async()=>token)}/>),
 privacyTestRegister:(optionsJSON:PublicKeyCredentialCreationOptionsJSON)=>startRegistration({optionsJSON}),
 privacyTestMount:(credential?:{id:string;secret:string})=>root.render(<KyrubPrivacyCentralPilot context="cid" sessionKey="cid-fixture" rights={credential?client.intake(credential):undefined} tracking={client.tracking(undefined,optionsJSON=>startAuthentication({optionsJSON}))}/>)
});
