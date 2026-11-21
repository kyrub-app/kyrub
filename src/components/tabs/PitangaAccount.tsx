import { useEffect, useRef, useState } from 'react';
import { auth } from '../../utils/firebase';
import { SemeaduraJourneyPanel } from '../SemeaduraJourneyPanel';

type Account = { pitangas: number; xp: number; initialized: boolean; entries: { id: string; unit: string; delta: number; occurredAt: string }[] };

export function PitangaAccount({ mode = 'all' }: { mode?: 'all' | 'pitangas' | 'xp' }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('Consultando recompensas…');
  const [busy, setBusy] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw Error();
        const response = await fetch('/api/pitangas', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok) throw Error();
        const data = await response.json() as Account;
        if (!Number.isSafeInteger(data.pitangas) || data.pitangas < 0 || !Number.isSafeInteger(data.xp) || data.xp < 0 || !Array.isArray(data.entries)) throw Error();
        if (active) { setAccount(data); setMessage(''); }
      } catch { if (active) { setAccount(null); setMessage('Recompensas indisponíveis. Tente atualizar novamente.'); } }
    };
    reload.current = read;
    void read();
    return () => { active = false; };
  }, []);

  const convert = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    // Preserve the key after an ambiguous network failure; retry cannot debit twice.
    requestId.current ??= crypto.randomUUID();
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw Error();
      const response = await fetch('/api/pitangas', { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, requestedXp: 1 }),
      });
      if (!response.ok) {
        setMessage(response.status === 409 ? 'Saldo insuficiente ou solicitação em conflito. Atualize o extrato.' : 'Conversão indisponível. Você pode tentar novamente com segurança.');
        return;
      }
      requestId.current = null;
      await reload.current();
      setMessage('Conversão confirmada: 1.000 Pitangas por 1 XP.');
    } catch { setMessage('Não foi possível confirmar. Tente novamente para consultar a mesma conversão.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <div className="space-y-3">
    <h3 className="text-lg font-bold text-white">
      {mode === 'xp' ? 'XP e conquistas' : mode === 'pitangas' ? 'Minhas Pitangas' : 'Pitangas e XP'}
    </h3>
    {mode !== 'pitangas' && <div className="mt-3"><SemeaduraJourneyPanel viewerId={auth.currentUser?.uid || ''} /></div>}
    {account && (
      <p className="text-sm text-slate-200">
        {mode === 'xp'
          ? `${account.xp.toLocaleString('pt-BR')} XP`
          : mode === 'pitangas'
            ? `${account.pitangas.toLocaleString('pt-BR')} Pitangas`
            : `${account.pitangas.toLocaleString('pt-BR')} Pitangas · ${account.xp.toLocaleString('pt-BR')} XP`}
      </p>
    )}
    {mode === 'xp'
      ? <p className="text-sm leading-relaxed text-slate-400">Sua experiência e a jornada de conquistas ficam aqui. Desafios personalizados ainda serão conectados; não são concedidos pontos extras nesta tela.</p>
      : <p className="text-sm leading-relaxed text-slate-400">100 Pitangas no primeiro cadastro elegível. Primeira loja publicada: 2 XP. Conversão voluntária: 1.000 Pitangas = 1 XP.</p>}
    {mode !== 'xp' && (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !account?.initialized || (account.pitangas < 1000 && !requestId.current)} onClick={() => void convert()}
          className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm disabled:opacity-50">
          {busy ? 'Confirmando…' : requestId.current ? 'Consultar / tentar novamente' : 'Converter 1.000 Pitangas em 1 XP'}
        </button>
        <button type="button" onClick={() => setShowStatement(!showStatement)} aria-expanded={showStatement}
          className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Extrato</button>
        <button type="button" disabled={busy} onClick={() => void reload.current()}
          className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Atualizar</button>
      </div>
    )}
    {mode === 'xp' && (
      <button type="button" disabled={busy} onClick={() => void reload.current()}
        className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Atualizar XP</button>
    )}
    <p role="status" className="text-sm text-slate-300">{message}</p>
    {showStatement && account && mode !== 'xp' && (
      <ul aria-label="Extrato de recompensas" className="space-y-2 text-sm">
        {account.entries.length === 0 && <li>Nenhum lançamento.</li>}
        {account.entries.map(e => (
          <li key={`${e.unit}:${e.id}`}>
            {new Date(e.occurredAt).toLocaleString('pt-BR')} · {e.delta > 0 ? '+' : ''}{e.delta} {e.unit === 'xp' ? 'XP' : 'Pitangas'}
          </li>
        ))}
      </ul>
    )}
  </div>;
}
