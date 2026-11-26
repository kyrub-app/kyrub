import {createRoot} from 'react-dom/client';
import {startAuthentication,startRegistration,type PublicKeyCredentialCreationOptionsJSON} from '@simplewebauthn/browser';
import {KyrubCidSosHomologation,type HomologationEntry} from '../../src/components/KyrubCidSosHomologation';
import {createCidSosHomologationHttpClient} from '../../src/utils/cidSosHomologationHttpClient';
import '../../src/index.css';

const url=new URL(location.href);
const [, ,tagId,role,occurrenceId]=url.pathname.split('/');
const client=createCidSosHomologationHttpClient(tagId);
const mount=createRoot(document.getElementById('root')!);
Object.assign(window,{cidTestRegister:(optionsJSON:PublicKeyCredentialCreationOptionsJSON)=>startRegistration({optionsJSON})});
let entry:HomologationEntry|undefined;
if(role==='emitter')entry=client.emitter(false);
if(role==='owner'&&occurrenceId)entry=client.owner(occurrenceId,optionsJSON=>startAuthentication({optionsJSON}));
if(role==='contact'&&occurrenceId){
 const [id,secret]=url.hash.slice(1).split('.');
 history.replaceState(null,'',url.pathname);
 if(id&&secret)entry=client.contact(occurrenceId,{id,secret});
}
mount.render(entry?<KyrubCidSosHomologation entry={entry} privacyUrl="/privacy"/>:<p>Cadastro de chave para teste</p>);
