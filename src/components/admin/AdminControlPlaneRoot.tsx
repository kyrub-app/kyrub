import { identityVerificationEnabled } from '../../utils/featureFlags';
import AdminControlPlaneApp from './AdminControlPlaneApp';
import AdminIdentityVerificationWorkspace from './AdminIdentityVerificationWorkspace';
import AdminPlatformEconomyWorkspace from './AdminPlatformEconomyWorkspace';
import AdminSystemHealthWorkspace from './AdminSystemHealthWorkspace';

export default function AdminControlPlaneRoot() {
  return (
    <div className="min-h-screen bg-slate-950">
      <AdminControlPlaneApp />
      <div id="admin-platform-economy" className="scroll-mt-24">
        <AdminPlatformEconomyWorkspace />
      </div>
      {identityVerificationEnabled && <AdminIdentityVerificationWorkspace />}
      <div id="admin-system-health" className="scroll-mt-24">
        <AdminSystemHealthWorkspace />
      </div>
    </div>
  );
}
