import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  isRelationshipNotificationEnabled,
  setRelationshipNotificationEnabled,
  subscribeToRelationshipNotificationPreferences,
} from '../../utils/relationshipNotificationPreferences';

export function CustomerRelationshipNotificationPreference({ storeId }: { storeId: string }) {
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const synchronize = () => {
      const user = auth.currentUser;
      setEnabled(isRelationshipNotificationEnabled(storeId, user?.uid ?? ''));
      setReady(Boolean(user));
    };
    const unsubscribeAuth = onAuthStateChanged(auth, synchronize);
    const unsubscribePreferences = subscribeToRelationshipNotificationPreferences(synchronize);
    synchronize();
    return () => {
      unsubscribeAuth();
      unsubscribePreferences();
    };
  }, [storeId]);

  const toggle = () => {
    const user = auth.currentUser;
    if (!user) return;
    const next = !enabled;
    setRelationshipNotificationEnabled(storeId, next, user.uid);
    setEnabled(next);
  };

  const Icon = enabled ? Bell : BellOff;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-slate-300">
            <Icon className="h-4 w-4 text-violet-300" />
            <strong className="text-[10px] font-black uppercase">Avisos desta loja</strong>
          </div>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
            {enabled
              ? 'Benefícios e campanhas personalizadas podem aparecer na Central de notificações.'
              : 'Benefícios continuam em “Para você”, mas os avisos promocionais desta loja ficam silenciados.'}
          </p>
          <p className="mt-1 text-[8px] font-bold text-slate-600">
            Atualizações de pedidos e outras mensagens transacionais não são afetadas.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Receber avisos de relacionamento desta loja"
          disabled={!ready}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${enabled ? 'border-violet-400/30 bg-violet-400/20' : 'border-slate-700 bg-slate-900'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}
