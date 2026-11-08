import { useState } from 'react';
import type { User } from 'firebase/auth';

const EXPECTED = 'Assinatura mensal com renovação automática e acesso contínuo.';
const PLANS = [
  { planId: 'pro', productId: 'draft_1d3dfa74091747d3a3012eadd8027894', label: 'Kyrub Pro', price: 197 },
  { planId: 'business', productId: 'draft_5f46706373714839a55846e6d8cb102c', label: 'Kyrub Business', price: 397 },
] as const;
const description = (label: string): string =>
  `Plano ${label} com contratação pré-paga e pagamento único por Pix, sem renovação automática. Ao término do período contratado, a continuidade exige novo aceite e novo pagamento. Descontos conforme o período selecionado.`;

type Result = { ok: boolean; applied: boolean; planId: string; productId: string; price: number; nextAutoRenew: boolean };
const patch = async (user: User, plan: typeof PLANS[number], apply: boolean): Promise<Result> => {
  const token = await user.getIdToken(true);
  const response = await fetch('/api/plan-control?op=admin.official-plan-product.renewal-patch', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      planId: plan.planId,
      productId: plan.productId,
      expectedDescription: EXPECTED,
      nextDescription: description(plan.label),
      apply,
    }),
  });
  const data = await response.json().catch(() => null) as (Partial<Result> & { error?: string; code?: string }) | null;
  if (!response.ok || data?.ok !== true || data.planId !== plan.planId ||
      data.productId !== plan.productId || data.price !== plan.price ||
      data.nextAutoRenew !== false || data.applied !== apply) {
    throw new Error(`${plan.label}: ${data?.code ?? data?.error ?? 'Resposta administrativa inválida'}`);
  }
  return data as Result;
};

export default function AdminOfficialPlanRenewalAction({ user }: { user: User }) {
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<string>('');
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const runAudit = async () => {
    if (busy) return;
    setBusy(true); setAudit(''); setMappingConfirmed(false); setError('');
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/plan-control?op=admin.official-plan-product.mapping-audit', {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; code?: string } | null;
      if (!response.ok || data?.ok !== true) throw new Error(data?.code ?? 'Auditoria indisponível');
      setAudit(JSON.stringify(data, null, 2));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Auditoria indisponível.'); }
    finally { setBusy(false); }
  };
  const assignMappings = async () => {
    if (busy || !mappingConfirmed) return;
    setBusy(true); setMappingConfirmed(false); setSimulated(false); setConfirmed(false); setError(''); setMessage('');
    const assigned: string[] = [];
    try {
      const token = await user.getIdToken(true);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const auditResponse = await fetch('/api/plan-control?op=admin.official-plan-product.mapping-audit', { headers: { authorization: headers.authorization }, cache: 'no-store' });
      const current = await auditResponse.json() as { ok?: boolean; canonicalStoreId?: string; mappingCount?: number; targets?: Array<{planId:string;productId:string;productExists:boolean;directMapping:unknown;otherActiveMappingIds:string[];safeToConsiderMissingMapping:boolean}> };
      if (!auditResponse.ok || current.ok !== true || current.canonicalStoreId !== 'store-ae53dc42e57eb9d5c3f7151c1431' ||
          current.mappingCount !== 0 || current.targets?.length !== 2 ||
          !PLANS.every(plan => current.targets?.some(target => target.planId === plan.planId && target.productId === plan.productId &&
            target.productExists && target.directMapping === null && target.otherActiveMappingIds.length === 0 && target.safeToConsiderMissingMapping))) {
        throw new Error('Auditoria atual não permite criar os vínculos. Nenhuma gravação iniciada.');
      }
      for (const plan of PLANS) {
        const response = await fetch('/api/plan-control?op=admin.official-plan-product.assign', {
          method: 'POST', headers,
          body: JSON.stringify({ planId: plan.planId, productId: plan.productId }),
        });
        const result = await response.json().catch(() => null) as {ok?:boolean;code?:string;error?:string}|null;
        if (!response.ok || result?.ok !== true) throw new Error(`${plan.label}: ${result?.code ?? result?.error ?? 'Falha ao criar vínculo'}`);
        assigned.push(plan.label);
      }
      setMessage('Vínculos criados. Execute a auditoria novamente para confirmar os registros.');
    } catch (cause) {
      setError(`Operação interrompida. Vínculos criados nesta tentativa: ${assigned.join(', ') || 'nenhum'}. ${cause instanceof Error ? cause.message : 'Erro inesperado'}`);
    } finally { setBusy(false); }
  };
  const simulate = async (scope: 'pro' | 'both') => {
    if (busy) return;
    setBusy(true); setSimulated(false); setConfirmed(false); setError(''); setMessage('');
    try {
      if (scope === 'pro') {
        await patch(user, PLANS[0], false);
        setMessage('Simulação do Kyrub Pro aprovada. Nenhum dado foi gravado.');
        return;
      }
      for (const plan of PLANS) await patch(user, plan, false);
      setSimulated(true);
      setMessage('As duas simulações foram aprovadas. Confira os produtos e confirme antes de gravar.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Simulação indisponível.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!simulated || !confirmed || busy) return;
    setBusy(true); setSimulated(false); setConfirmed(false); setError(''); setMessage('');
    const applied: string[] = [];
    try {
      // Revalidar ambos imediatamente antes da primeira escrita.
      for (const plan of PLANS) await patch(user, plan, false);
      for (const plan of PLANS) {
        await patch(user, plan, true);
        applied.push(plan.label);
      }
      setMessage('Atualização concluída nos dois produtos. Confirme os campos na API pública.');
    } catch (cause) {
      setError(`Operação interrompida. Produtos atualizados: ${applied.join(', ') || 'nenhum'}. ${cause instanceof Error ? cause.message : 'Erro inesperado.'}`);
    } finally { setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border border-amber-500/30 bg-slate-950/50 p-4 text-xs">
    <h3 className="font-bold text-white">Correção pontual de renovação — Loja Oficial</h3>
    <p className="text-slate-400">Apenas Pro e Business. Altera descrição e renovação automática; não altera preços, descontos, fiscal, contratos ou Pix.</p>
    {PLANS.map(plan => <div key={plan.planId} className="rounded-lg border border-slate-700 p-3">
      <strong className="text-white">{plan.label} — R$ {plan.price},00/mês</strong>
      <p className="mt-1 break-all text-slate-400">ID: {plan.productId}</p>
      <p className="mt-2 text-slate-300">{description(plan.label)}</p>
    </div>)}
    <button type="button" disabled={busy} onClick={() => void runAudit()} className="rounded-lg border border-slate-500 px-4 py-2 text-white disabled:opacity-50">Auditar vínculos oficiais (somente leitura)</button>
    {audit && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-slate-200">{audit}</pre>}
    <div className="rounded-lg border border-slate-600 p-3 space-y-2">
      <p className="text-slate-300">Regularização administrativa: cria somente os vínculos oficiais Pro e Business, sem enviar recompensas. Revalida a auditoria antes da gravação. Não altera produtos, contratos ou Pix.</p>
      <label className="flex items-center gap-2 text-amber-200"><input type="checkbox" checked={mappingConfirmed} disabled={busy} onChange={event => setMappingConfirmed(event.target.checked)} /> Autorizo exclusivamente os dois vínculos administrativos.</label>
      <button type="button" disabled={busy || !mappingConfirmed} onClick={() => void assignMappings()} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">Criar vínculos oficiais Pro e Business</button>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void simulate('pro')} className="rounded-lg border border-cyan-700 px-4 py-2 font-bold text-cyan-200 disabled:opacity-50">
        Simular somente Kyrub Pro (sem gravação)
      </button>
      <button type="button" disabled={busy} onClick={() => void simulate('both')} className="rounded-lg bg-cyan-700 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'Processando…' : '1. Simular os dois produtos (sem gravação)'}</button>
    </div>
    {simulated && <label className="flex items-center gap-2 text-amber-200"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmo a atualização dos dois produtos acima.</label>}
    <div><button type="button" disabled={busy || !simulated || !confirmed} onClick={() => void apply()} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">2. Aplicar atualização pontual</button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
  </section>;
}
