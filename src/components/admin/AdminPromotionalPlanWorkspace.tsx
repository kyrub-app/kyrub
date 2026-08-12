import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import AdminPlansCouponsWorkspace from './AdminPlansCouponsWorkspace';

interface AdminPromotionalPlanWorkspaceProps {
  authenticatedUser: User;
  profile: AdminProfile;
}

// Compatibility wrapper: the first promotional Pro workspace evolved into the
// versioned Plans & Coupons control plane. Keeping this component boundary
// avoids coupling the root admin shell to a temporary campaign name.
export default function AdminPromotionalPlanWorkspace(
  props: AdminPromotionalPlanWorkspaceProps
) {
  return <AdminPlansCouponsWorkspace {...props} />;
}
