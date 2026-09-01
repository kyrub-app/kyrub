import { useEffect, useMemo, useState } from 'react';
import {
  authorizeNinetyNineFoodE2EAvailability,
  bindNinetyNineFoodE2EProduct,
  createNinetyNineFoodE2EAvailabilitySnapshot,
  discoverNinetyNineFoodE2EMenuCapability,
  executeNinetyNineFoodE2EAvailability,
  listNinetyNineFoodE2EBindings,
  proposeNinetyNineFoodE2EAvailability,
  reconcileNinetyNineFoodE2EAvailability,
  resolveNinetyNineFoodE2ECatalogIdentity,
  setNinetyNineFoodE2EAvailabilityPolicy,
  type NinetyNineFoodE2EBinding,
  type NinetyNineFoodE2ECatalogIdentity,
  type NinetyNineFoodE2EReconciliation,
} from '../../utils/ninetyNineFoodE2ETest';

interface Props {
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const numberOrZero = (value: string): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

export default function NinetyNineFoodE2ETestWorkspace({ notify }: Props) {
  const [bindings, setBindings] = useState<NinetyNineFoodE2EBinding[]>([]);
  const [selectedBindingId, setSelectedBindingId] = useState('');
  const [externalProductId, setExternalProductId] = useState('');
  const [canonicalProductId, setCanonicalProductId] = useState('');
  const [identity, setIdentity] = useState<NinetyNineFoodE2ECatalogIdentity | null>(null);
  const [capabilityReady, setCapabilityReady] = useState(false);
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [safetyStock, setSafetyStock] = useState('0');
  const [allocationCap, setAllocationCap] = useState('');
  const [policyRevision, setPolicyRevision] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<{
    snapshotId: string;
    availableToPromiseUnits: number;
    publishableUnits: number;
    policyRevision: number;
  } | null>(null);
  const [proposal, setProposal] = useState<{ id: string; targetAvailableQuantity: number } | null>(null);
  const [authorization, setAuthorization] = useState<{
    id: string;
    targetAvailableQuantity: number;
    expiresAt: string;
  } | null>(null);
  // Deliberately memory-only. Never persist a raw one-time authorization token.
  const [authorizationToken, setAuthorizationToken] = useState('');
  const [execution, setExecution] = useState<{
    id: string;
    status: 'provider_write_accepted' | 'provider_rejected' | 'reconciliation_required';
    providerHttpStatus: number | null;
  } | null>(null);
  const [reconciliation, setReconciliation] = useState<NinetyNineFoodE2EReconciliation | null>(null);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  const selected = useMemo(
    () => bindings.find(item => item.id === selectedBindingId && item.status === 'active') ?? null,
    [bindings, selectedBindingId]
  );

  const resetFlow = (): void => {
    setIdentity(null);
    setCapabilityReady(false);
    setPolicyRevision(null);
    setSnapshot(null);
    setProposal(null);
    setAuthorization(null);
    setAuthorizationToken('');
    setExecution(null);
    setReconciliation(null);
    setFeedback('');
  };

  const loadBindings = async (preferredId = ''): Promise<void> => {
    const result = await listNinetyNineFoodE2EBindings();
    const active = result.items.filter(item => item.status === 'active');
    setBindings(active);
    setSelectedBindingId(current => {
      if (preferredId && active.some(item => item.id === preferredId)) return preferredId;
      if (active.some(item => item.id === current)) return current;
      return active[0]?.id ?? '';
    });
  };

  useEffect(() => {
    let cancelled = false;
    void listNinetyNineFoodE2EBindings()
      .then(result => {
        if (cancelled) return;
        const active = result.items.filter(item => item.status === 'active');
        setBindings(active);
        setSelectedBindingId(active[0]?.id ?? '');
      })
      .catch(error => {
        if (!cancelled) setFeedback(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, []);

  const run = async (key: string, task: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setFeedback('');
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      notify(message, 'error');
    } finally {
      setBusy('');
    }
  };

  const handleBind = () => run('bind', async () => {
    const externalId = externalProductId.trim();
    const canonicalId = canonicalProductId.trim();
    if (!externalId || !canonicalId) throw new Error('Informe o ID externo 99Food e o ID do produto canônico Kyrub.');
    const result = await bindNinetyNineFoodE2EProduct(externalId, canonicalId);
    await loadBindings(result.binding.id);
    resetFlow();
    setExternalProductId('');
    setCanonicalProductId('');
    setFeedback('Binding 99Food → produto Kyrub confirmado.');
  });

  const handleCapability = () => run('capability', async () => {
    const result = await discoverNinetyNineFoodE2EMenuCapability();
    const status = String(result.capability?.status ?? '');
    if (status !== 'merchant_v2_candidate') {
      throw new Error(`A conexão não declarou Merchant V2 utilizável (${status || 'sem capability'}).`);
    }
    setCapabilityReady(true);
    setFeedback('Capability Merchant V2 confirmada pelo Discovery.');
  });

  const handleIdentity = () => run('identity', async () => {
    if (!selected) throw new Error('Selecione uma binding ativa.');
    const result = await resolveNinetyNineFoodE2ECatalogIdentity(selected.externalProductId);
    setIdentity(result);
    if (result.status !== 'resolved') {
      throw new Error(`Identidade do ItemOffer não resolvida: ${result.status}.`);
    }
    setFeedback(`ItemOffer exato resolvido: ${result.providerItemOfferId}.`);
  });

  const handlePolicy = () => run('policy', async () => {
    if (!selected) throw new Error('Selecione uma binding ativa.');
    const cap = allocationCap.trim() ? numberOrZero(allocationCap) : null;
    const result = await setNinetyNineFoodE2EAvailabilityPolicy(selected.canonicalStoreId, {
      enabled: policyEnabled,
      safetyStockUnits: numberOrZero(safetyStock),
      allocationCapUnits: cap,
    });
    setPolicyRevision(result.revision);
    setSnapshot(null);
    setProposal(null);
    setAuthorization(null);
    setAuthorizationToken('');
    setExecution(null);
    setReconciliation(null);
    setFeedback(`Política 99Food salva na revisão ${result.revision}.`);
  });

  const handleSnapshot = () => run('snapshot', async () => {
    if (!selected) throw new Error('Selecione uma binding ativa.');
    const result = await createNinetyNineFoodE2EAvailabilitySnapshot(
      selected.canonicalStoreId,
      selected.canonicalProductId
    );
    setSnapshot(result);
    setProposal(null);
    setAuthorization(null);
    setAuthorizationToken('');
    setExecution(null);
    setReconciliation(null);
    setFeedback(`Snapshot criado: ATP ${result.availableToPromiseUnits}, publicável ${result.publishableUnits}.`);
  });

  const handleProposal = () => run('proposal', async () => {
    if (!selected || !snapshot) throw new Error('Crie primeiro o snapshot de disponibilidade.');
    const result = await proposeNinetyNineFoodE2EAvailability(
      selected.externalProductId,
      snapshot.snapshotId
    );
    setProposal({ id: result.proposal.id, targetAvailableQuantity: result.proposal.targetAvailableQuantity });
    setAuthorization(null);
    setAuthorizationToken('');
    setExecution(null);
    setReconciliation(null);
    setFeedback(`Proposta criada para quantityAvailable = ${result.proposal.targetAvailableQuantity}.`);
  });

  const handleAuthorize = () => run('authorize', async () => {
    if (!proposal) throw new Error('Crie primeiro a proposta de disponibilidade.');
    const result = await authorizeNinetyNineFoodE2EAvailability(proposal.id);
    setAuthorization({
      id: result.authorization.id,
      targetAvailableQuantity: result.authorization.targetAvailableQuantity,
      expiresAt: result.authorization.expiresAt,
    });
    setAuthorizationToken(result.authorizationToken);
    setExecution(null);
    setReconciliation(null);
    setFeedback('Alteração autorizada. O token one-time está somente na memória desta tela.');
  });

  const handleExecute = () => run('execute', async () => {
    if (!authorization || !authorizationToken) {
      throw new Error('A autorização one-time não está disponível. Autorize novamente.');
    }
    const result = await executeNinetyNineFoodE2EAvailability(authorization.id, authorizationToken);
    setAuthorizationToken('');
    setExecution({
      id: result.execution.id,
      status: result.execution.status,
      providerHttpStatus: result.execution.providerHttpStatus,
    });
    setReconciliation(null);
    setFeedback(
      result.execution.status === 'provider_write_accepted'
        ? 'A 99Food aceitou a alteração. Ainda falta confirmar por leitura autoritativa.'
        : `Execução terminou em ${result.execution.status}. Nenhum retry automático será feito.`
    );
  });

  const handleReconcile = () => run('reconcile', async () => {
    if (!execution || execution.status === 'provider_rejected') {
      throw new Error('Não há uma execução elegível para reconciliação.');
    }
    const result = await reconcileNinetyNineFoodE2EAvailability(execution.id);
    setReconciliation(result);
    setFeedback(
      result.status === 'reconciled'
        ? `Confirmado na 99Food: quantityAvailable = ${result.observedQuantityAvailable}.`
        : `A 99Food ainda informa ${result.observedQuantityAvailable}; target autorizado era ${result.targetAvailableQuantity}.`
    );
  });

  return (
    <section className="space-y-4 rounded-2xl border border-orange-500/20 bg-orange-500/[0.035] p-4">
      <div>
        <strong className="block text-[10px] font-black uppercase tracking-wide text-orange-200">
          99Food · bancada E2E controlada
        </strong>
        <p className="mt-1 text-[8px] leading-relaxed text-slate-400">
          Teste o caminho binding → ItemOffer → ATP → autorização → disponibilidade 99Food → reconciliação. O write real só acontece no botão destacado abaixo.
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:grid-cols-[1fr_1fr_auto]">
        <input
          value={externalProductId}
          onChange={event => setExternalProductId(event.target.value)}
          placeholder="ID externo / externalCode 99Food"
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-white outline-none focus:border-orange-500"
        />
        <input
          value={canonicalProductId}
          onChange={event => setCanonicalProductId(event.target.value)}
          placeholder="ID do produto canônico Kyrub"
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-white outline-none focus:border-orange-500"
        />
        <button type="button" onClick={() => void handleBind()} disabled={!!busy}
          className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-[8px] font-black uppercase text-orange-200 disabled:opacity-40">
          Vincular produto
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[8px] font-black uppercase text-slate-500">Bindings ativas</span>
          <button type="button" onClick={() => void run('refresh', () => loadBindings())} disabled={!!busy}
            className="text-[8px] font-black uppercase text-cyan-300 disabled:opacity-40">Atualizar</button>
        </div>
        {bindings.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[8px] text-slate-500">
            Nenhum produto 99Food está vinculado ainda.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {bindings.map(binding => (
              <button key={binding.id} type="button" onClick={() => { setSelectedBindingId(binding.id); resetFlow(); }}
                className={`rounded-xl border p-3 text-left ${selectedBindingId === binding.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-slate-800 bg-slate-950/60'}`}>
                <strong className="block break-all text-[9px] text-slate-200">99Food: {binding.externalProductId}</strong>
                <span className="mt-1 block break-all text-[8px] text-slate-500">Kyrub: {binding.canonicalProductId} · rev. {binding.revision}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void handleCapability()} disabled={!!busy}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40">
              1. Descobrir capability Menu
            </button>
            <button type="button" onClick={() => void handleIdentity()} disabled={!!busy || !capabilityReady}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40">
              2. Resolver ItemOffer exato
            </button>
          </div>

          {identity?.status === 'resolved' && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[8px] text-emerald-200">
              Menu {identity.providerMenuId} · ItemOffer {identity.providerItemOfferId}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[8px] font-black uppercase text-slate-500">
              Reserva de segurança
              <input value={safetyStock} onChange={event => setSafetyStock(event.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-white" />
            </label>
            <label className="text-[8px] font-black uppercase text-slate-500">
              Teto do canal (opcional)
              <input value={allocationCap} onChange={event => setAllocationCap(event.target.value)} inputMode="numeric" placeholder="sem teto"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-white" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-[8px] font-black uppercase text-slate-400">
              <input type="checkbox" checked={policyEnabled} onChange={event => setPolicyEnabled(event.target.checked)} />
              Canal habilitado
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" onClick={() => void handlePolicy()} disabled={!!busy || identity?.status !== 'resolved'}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40">
              3. Salvar política
            </button>
            <button type="button" onClick={() => void handleSnapshot()} disabled={!!busy || policyRevision === null}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40">
              4. Criar snapshot ATP
            </button>
            <button type="button" onClick={() => void handleProposal()} disabled={!!busy || !snapshot}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40">
              5. Criar proposta
            </button>
            <button type="button" onClick={() => void handleAuthorize()} disabled={!!busy || !proposal}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[8px] font-black uppercase text-cyan-200 disabled:opacity-40">
              6. Autorizar alteração
            </button>
          </div>

          {snapshot && (
            <p className="text-[8px] text-slate-400">
              Snapshot: ATP <strong className="text-slate-200">{snapshot.availableToPromiseUnits}</strong> · publicável <strong className="text-slate-200">{snapshot.publishableUnits}</strong> · política r{snapshot.policyRevision}
            </p>
          )}
          {proposal && (
            <p className="text-[8px] text-slate-400">Target congelado: <strong className="text-slate-200">quantityAvailable = {proposal.targetAvailableQuantity}</strong></p>
          )}

          <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-3">
            <strong className="text-[8px] font-black uppercase text-rose-200">Write real no provedor</strong>
            <p className="mt-1 text-[8px] leading-relaxed text-rose-200/70">
              O próximo botão executa um PATCH real no ItemOffer exato da 99Food. Não há retry automático.
            </p>
            <button type="button" onClick={() => void handleExecute()} disabled={!!busy || !authorization || !authorizationToken}
              className="mt-2 w-full rounded-lg bg-rose-500 px-3 py-2.5 text-[8px] font-black uppercase text-white disabled:opacity-35">
              7. Alterar disponibilidade na 99Food agora
            </button>
          </div>

          {execution && (
            <div className="space-y-2">
              <p className="text-[8px] text-slate-400">Execução: <strong className="text-slate-200">{execution.status}</strong>{execution.providerHttpStatus ? ` · HTTP ${execution.providerHttpStatus}` : ''}</p>
              <button type="button" onClick={() => void handleReconcile()} disabled={!!busy || execution.status === 'provider_rejected'}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[8px] font-black uppercase text-emerald-200 disabled:opacity-35">
                8. Reconciliar com a 99Food
              </button>
            </div>
          )}

          {reconciliation && (
            <div className={`rounded-lg border p-3 text-[8px] ${reconciliation.status === 'reconciled' ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/25 bg-amber-500/5 text-amber-200'}`}>
              {reconciliation.status === 'reconciled' ? 'Reconciliado' : 'Ainda divergente'} · target {reconciliation.targetAvailableQuantity} · observado {reconciliation.observedQuantityAvailable}
            </div>
          )}
        </div>
      )}

      {(feedback || busy) && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[8px] text-cyan-200">
          {busy ? `Executando ${busy}...` : feedback}
        </div>
      )}
    </section>
  );
}
