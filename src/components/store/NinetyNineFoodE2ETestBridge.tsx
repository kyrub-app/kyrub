import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getNinetyNineFoodConnectionStatus } from '../../utils/ninetyNineFoodIntegration';
import NinetyNineFoodE2EOrderObservationPanel from './NinetyNineFoodE2EOrderObservationPanel';
import NinetyNineFoodE2ETestWorkspace from './NinetyNineFoodE2ETestWorkspace';

export default function NinetyNineFoodE2ETestBridge({
  user,
  notify,
}: {
  user: User;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getNinetyNineFoodConnectionStatus()
      .then(status => {
        if (!cancelled) setConnected(status.status === 'connected');
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (!connected) return null;
  return (
    <div id="kyrub-99food-product-binding-workspace" className="space-y-4">
      <NinetyNineFoodE2ETestWorkspace notify={notify} />
      <NinetyNineFoodE2EOrderObservationPanel user={user} />
    </div>
  );
}
