import { useState } from 'react';
import type { User } from 'firebase/auth';

type Result = { ok?: boolean; accountMatched?: boolean; receiverId?: string; checkoutEnabled?: boolean; code?: string; error?: string };

export default function AdminOfficialBillingPreflight({ user }: { user: User }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const run = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/plan-control?op=admin.official-store.billing-preflight', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json() as Result;
      if (!response.ok) {
        setError(data.code || data.error || `HTTP ${response.status}`);
        return;
      }
      setResult(data);
    } catch {
      setError('Não foi possível consultar o servidor. Nenhuma cobrança foi realizada.');
    } finally {
      setLoading(false);
    }
  };
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
    <h3 className="text-sm font-bold text-white">Conta recebedora dos planos Kyrub</h3>
    <p className="mt-2 text-xs text-slate-400">Compara a identidade OAuth da Loja Oficial à conta do token de cobrança, sem revelar credenciais ou gerar Pix.</p>
    <button type="button" onClick={() => void run()} disabled={loading} className="mt-4 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Verificando...' : 'Validar conta de cobrança dos planos'}</button>
    {error && <p role="alert" className="mt-3 text-xs text-amber-300">Verificação não concluída: {error}. Pix não foi habilitado.</p>}
    {result && <div role="status" className="mt-3 text-xs text-slate-200">
      <p>{result.ok && result.accountMatched ? 'Contas Mercado Pago correspondem.' : 'Correspondência não confirmada.'}</p>
      <p>Conta recebedora: {result.receiverId || 'Não informada'}</p>
      <p>Pix dos planos: {result.checkoutEnabled ? 'Configuração habilitada' : 'Desativado'}</p>
    </div>}
  </section>;
}
