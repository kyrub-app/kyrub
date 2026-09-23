import type { User } from 'firebase/auth';
import FiscalHomologationStructuralPolicyWorkspace from './FiscalHomologationStructuralPolicyWorkspace';
import FiscalTaxExecutionPolicyWorkspace from './FiscalTaxExecutionPolicyWorkspace';
import FocusNfceProviderWorkspace from './FocusNfceProviderWorkspace';

export default function FiscalHomologationPolicyWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  return (
    <div className="space-y-4" id="fiscal-homologation-workspace-stack">
      <FiscalHomologationStructuralPolicyWorkspace user={user} storeId={storeId} />
      <FiscalTaxExecutionPolicyWorkspace user={user} storeId={storeId} />
      <FocusNfceProviderWorkspace user={user} storeId={storeId} />
    </div>
  );
}
