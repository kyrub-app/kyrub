import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import StoreSubscriptionsWorkspace from './StoreSubscriptionsWorkspace';

type ToastType = 'success' | 'error' | 'info';

interface StoreSubscriptionsRuntimeProps {
  storeId: string;
  triggerToast: (message: string, type?: ToastType) => void;
}

export default function StoreSubscriptionsRuntime({
  storeId,
  triggerToast,
}: StoreSubscriptionsRuntimeProps) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));

  useEffect(() => onAuthStateChanged(auth, nextUser => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);

  if (!authReady) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-[10px] text-slate-400">
        Confirmando sua sessão para carregar as assinaturas da loja…
      </section>
    );
  }

  if (!user || user.uid !== storeId) {
    return (
      <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-[10px] leading-relaxed text-amber-100">
        Entre novamente com a conta proprietária desta loja para consultar os assinantes.
      </section>
    );
  }

  return (
    <StoreSubscriptionsWorkspace
      user={user}
      storeId={storeId}
      notify={triggerToast}
    />
  );
}
