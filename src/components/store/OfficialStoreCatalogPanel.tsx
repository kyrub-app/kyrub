import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { subscribeToAdminProfile } from '../../utils/adminControlPlane';
import OfficialStoreIdentityPanel from './OfficialStoreIdentityPanel';

/** Reuses the protected mapping UI alongside the store's existing product catalog. */
export default function OfficialStoreCatalogPanel({ storeId }: { storeId: string }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authorizedUid, setAuthorizedUid] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    setAuthorizedUid('');
    if (!user) return;
    return subscribeToAdminProfile(user, profile => {
      setAuthorizedUid(profile?.status === 'active' && profile.role === 'super_admin' ? user.uid : '');
    }, () => setAuthorizedUid(''));
  }, [user]);

  if (!user || authorizedUid !== user.uid) return null;
  return <details className="mb-4 rounded-2xl border border-cyan-800 bg-slate-900 p-4">
    <summary className="cursor-pointer text-xs font-bold text-cyan-300">Loja Oficial — vínculos dos planos Kyrub</summary>
    <p className="mt-3 text-xs text-slate-400">Use os produtos já cadastrados nesta área. O vínculo administrativo não cria nem publica produtos.</p>
    <OfficialStoreIdentityPanel key={`${user.uid}:${storeId}`} authenticatedUser={user} storeId={storeId} />
  </details>;
}
