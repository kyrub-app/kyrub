import { useEffect, useState } from 'react';
import { auth } from '../../utils/firebase';
import { getNinetyNineFoodConnectionStatus } from '../../utils/ninetyNineFoodIntegration';
import NinetyNineFoodE2EOrderObservationPanel from './NinetyNineFoodE2EOrderObservationPanel';
import NinetyNineFoodE2ETestWorkspace from './NinetyNineFoodE2ETestWorkspace';

export default function NinetyNineFoodE2ETestBridge({
  notify,
}: {
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
  const user = auth.currentUser;
  if (!user) return null;
  return (
    <div id="kyrub-99food-product-binding-workspace" className="space-y-4">
      <NinetyNineFoodE2ETestWorkspace notify={notify} />
      <NinetyNineFoodE2EOrderObservationPanel user={user} />
    </div>
  );
}
