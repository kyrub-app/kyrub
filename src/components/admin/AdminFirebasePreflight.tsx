import { useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import { canRunFirebasePreflight, createFirebasePreflightRunner, isFirebasePreflightPreview, type PreflightStatus } from '../../utils/adminFirebasePreflight';

export default function AdminFirebasePreflight({ user, profile }: { user: Pick<User, 'uid' | 'emailVerified' | 'getIdToken'>; profile: AdminProfile }) {
  const runner = useRef(createFirebasePreflightRunner());
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreflightStatus | null>(null);
  if (!isFirebasePreflightPreview(window.location.hostname, window.location.search) || !canRunFirebasePreflight(user, profile)) return null;
  const run = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setResult(null);
    try { setResult(await runner.current(user, profile)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <section aria-label="Préflight Firebase temporário" className="rounded-2xl border border-slate-800 p-4">
    <button type="button" disabled={busy} onClick={() => void run()} className="rounded-xl bg-cyan-400 px-4 py-3 text-xs font-bold text-slate-950 disabled:opacity-50">{busy ? 'Verificando…' : 'Executar préflight Firebase'}</button>
    {result && <output role="status" className="mt-3 block text-xs">{JSON.stringify(result)}</output>}
  </section>;
}
