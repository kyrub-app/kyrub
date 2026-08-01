import { identityVerificationEnabled } from '../../utils/featureFlags';
import AdminControlPlaneApp from './AdminControlPlaneApp';
import AdminIdentityVerificationWorkspace from './AdminIdentityVerificationWorkspace';
import AdminSystemHealthWorkspace from './AdminSystemHealthWorkspace';

export default function AdminControlPlaneRoot() {
  return (
    <div className="min-h-screen bg-slate-950">
      <AdminControlPlaneApp />
      {identityVerificationEnabled && <AdminIdentityVerificationWorkspace />}
      <AdminSystemHealthWorkspace />
    </div>
  );
}
