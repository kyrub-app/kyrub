import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { loadStoreConnectionOnboarding } from '../../utils/storeConnections';
import MercadoLivreE2ETestWorkspace from './MercadoLivreE2ETestWorkspace';

export default function MercadoLivreE2ETestBridge({
  user,
  storeId,
  notify,
}: {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [connectionId, setConnectionId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadStoreConnectionOnboarding(user, storeId)
      .then(snapshot => {
        if (cancelled) return;
        const connection = snapshot.connections.find(item =>
          item.provider === 'mercado_livre' && item.status === 'connected'
        );
        setConnectionId(connection?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setConnectionId('');
      });
    return () => { cancelled = true; };
  }, [storeId, user.uid]);

  if (!connectionId) return null;
  return (
    <MercadoLivreE2ETestWorkspace
      user={user}
      storeId={storeId}
      connectionId={connectionId}
      notify={notify}
    />
  );
}
