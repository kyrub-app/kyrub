import {ShieldCheck} from 'lucide-react';
import {hasAdminPermission,type AdminProfile} from '../../utils/adminControlPlane';
import AdminAccordionSection from './AdminAccordionSection';
import {KyrubCidEvidenceReviewHomologation} from '../KyrubCidEvidenceReviewHomologation';
import type {CidEvidenceReviewAdapter} from '../../../shared/cidEvidenceReview';
// Explicit isolated harness only. Do not mount in AdminControlPlaneApp until
// server transport, MFA, production provisioning and legal controls are approved.
// UI checks are presentation only; the server rechecks both grants every time.
export function AdminCidEvidenceReviewPilot({profile,uid,adapter}:{profile:AdminProfile|null;uid:string;adapter:CidEvidenceReviewAdapter}){
 if(!profile||profile.uid!==uid||!hasAdminPermission(profile,'manage_compliance'))return null;
 return <AdminAccordionSection id="admin-cid-evidence-review" title="Preservação de Evidências e Cooperação com Autoridades" description="Triagem privada de denúncias e pedidos de preservação — homologação." icon={ShieldCheck}>
  <KyrubCidEvidenceReviewHomologation key={uid+':'+profile.role} adapter={adapter}/>
 </AdminAccordionSection>;
}
