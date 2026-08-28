import { identityVerificationEnabled } from '../../utils/featureFlags';
import AdminControlPlaneApp from './AdminControlPlaneApp';
import AdminIdentityVerificationWorkspace from './AdminIdentityVerificationWorkspace';
import AdminPlatformEconomicsWorkspace from './AdminPlatformEconomicsWorkspace';
import AdminSystemHealthWorkspace from './AdminSystemHealthWorkspace';

export default function AdminControlPlaneRoot() {
  return (
    <div className="min-h-screen bg-slate-950">
      <AdminControlPlaneApp />
      {identityVerificationEnabled && <AdminIdentityVerificationWorkspace />}
      <div id="admin-platform-economics" className="scroll-mt-24">
        <AdminPlatformEconomicsWorkspace />
      </div>
      <div id="admin-system-health" className="scroll-mt-24">
        <AdminSystemHealthWorkspace />
      </div>
    </div>
  );
}
