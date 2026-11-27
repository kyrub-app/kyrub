import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {KyrubPrivacyRightsPilot} from './KyrubPrivacyRightsPilot';
import {KyrubPrivacyTrackingPilot,type PrivacyTrackingAdapter} from './KyrubPrivacyTrackingPilot';
import {KyrubOptionalConsentPilot} from './KyrubOptionalConsentPilot';
import type {PrivacyRightsAdapter,PrivacyContext} from '../../shared/privacyRights';
import type {OptionalConsentAdapter} from '../../shared/privacyOptionalConsent';
type Tab='request'|'track'|'consents';
type Props={context:PrivacyContext;sessionKey:string;rights?:PrivacyRightsAdapter;tracking?:PrivacyTrackingAdapter;consents?:OptionalConsentAdapter};
// Only mounted by an explicit test harness. No Firebase client, persistence or default mock success.
// sessionKey is an opaque harness session label, not an authentication secret.
export function KyrubPrivacyCentralPilot(props:Props){
 return <Central key={props.context+':'+props.sessionKey} {...props}/>;
}
function Central({context,rights,tracking,consents}:Props){
 const [tab,setTab]=useState<Tab>('request');
 const tabs:{id:Tab;label:string}[]=[{id:'request',label:'Solicitar direito'},{id:'track',label:'Acompanhar'}];
 if(context==='ecosystem')tabs.push({id:'consents',label:'Meus consentimentos'});
 return <section aria-label="Central de Privacidade" className="mx-auto max-w-lg space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]">
  <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-[#F47825]"/><h2 className="text-base font-bold">Central de Privacidade</h2></div>
  <p className="text-xs text-amber-200">Homologação isolada. Não utilize dados reais. Os serviços oficiais ainda não estão disponíveis nesta central.</p>
  <nav aria-label="Seções de privacidade" className="flex flex-wrap gap-2">{tabs.map(t=><button key={t.id} type="button" aria-pressed={tab===t.id} className={'min-h-11 rounded-xl border px-3 py-2 text-sm '+(tab===t.id?'border-[#F47825]':'border-[#34443B]')} onClick={()=>setTab(t.id)}>{t.label}</button>)}</nav>
  {tab==='request'&&<KyrubPrivacyRightsPilot adapter={rights} initialContext={context}/>}
  {tab==='track'&&<KyrubPrivacyTrackingPilot adapter={tracking}/>}
  {tab==='consents'&&context==='ecosystem'&&<KyrubOptionalConsentPilot adapter={consents}/>}
  <p className="text-xs">Termos de Uso e Política de Privacidade continuam separados das escolhas facultativas.</p>
 </section>;
}
