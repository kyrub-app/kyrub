import AdminControlPlaneApp from './AdminControlPlaneApp';
import AdminSystemHealthWorkspace from './AdminSystemHealthWorkspace';

export default function AdminControlPlaneRoot() {
  return (
    <div className="min-h-screen bg-slate-950">
      <AdminControlPlaneApp />
      <AdminSystemHealthWorkspace />
    </div>
  );
}
