import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  CircleAlert,
  FileSearch,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

type FiscalBlockingReason =
  | 'accounting_decision_required'
  | 'accounting_policy_resolution_required'
  | 'fiscal_issuer_identity_required'
  | 'product_fiscal_preparation_incomplete'
  | 'commercial_confirmation_required';

interface FiscalPreflightResult {
  schemaVersion: 2;
  readAuthority: 'server_canonical_read_only';
  canonicalStoreId: string;
  evidence: {
    orderId: string;
    sourceChannel: 'kyrub' | 'mercado_livre' | '99food' | 'other';
    paymentStatus: string;
    commercialConfirmation: boolean;
    commercialConfirmationAuthority: 'canonical_order_payment_status';
    issuerIdentity: {
      status: 'ready' | 'required';
      identifierKind: 'cpf' | 'cnpj' | null;
      environment: 'sandbox' | 'production';
    };
    issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile';
    productPreparation: Array<{
      productId: string;
      kind: 'goods' | 'service';
      fiscalProfileReady: boolean;
    }>;
    accountingDecision: {
      status: 'required' | 'recorded';
      policyReference: string | null;
      recordedAt: string | null;
    };
  };
  simulation: {
    schemaVersion: 2;
    mode: 'simulation_only';
    simulationStatus: 'blocked';
    blockingReasons: FiscalBlockingReason[];
    requiredInputs: string[];
    execution: {
      fiscalTrigger: null;
      documentFamily: null;
      emissionAuthority: 'none_until_accounting_policy';
      providerCallAllowed: false;
      sefazCallAllowed: false;
    };
    artifact: {
      kind: 'fiscal_preflight_simulation';
      authoritativeDocument: false;
    };
  };
}

const BLOCKER_LABELS: Record<FiscalBlockingReason, string> = {
  accounting_decision_required: 'Registrar a orientação contábil que servirá de referência.',
  accounting_policy_resolution_required: 'Resolver uma política fiscal executável e auditável.',
  fiscal_issuer_identity_required: 'Completar nome fiscal e CPF/CNPJ do emissor.',
  product_fiscal_preparation_incomplete: 'Completar os dados fiscais dos itens indicados.',
  commercial_confirmation_required: 'Aguardar a confirmação comercial autoritativa do pedido.',
};

const channelLabel = (value: FiscalPreflightResult['evidence']['sourceChannel']): string => {
  if (value === 'mercado_livre') return 'Mercado Livre';
  if (value === '99food') return '99Food';
  if (value === 'kyrub') return 'Kyrub';
  return 'Outro canal';
};

const statusClass = (ready: boolean): string =>
  ready
    ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-100'
    : 'border-amber-500/20 bg-amber-500/[0.05] text-amber-100';

export default function FiscalPreflightWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [orderId, setOrderId] = useState('');
  const [result, setResult] = useState<FiscalPreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const productSummary = useMemo(() => {
    const items = result?.evidence.productPreparation ?? [];
    return {
      total: items.length,
      ready: items.filter(item => item.fiscalProfileReady).length,
      missing: items.filter(item => !item.fiscalProfileReady),
    };
  }, [result]);

  const analyze = async (): Promise<void> => {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId) {
      setError('Informe o ID do pedido canônico que deseja analisar.');
      setResult(null);
      return;
    }
    if (!/^[a-zA-Z0-9:_-]{1,240}$/.test(normalizedOrderId)) {
      setError('O ID do pedido contém caracteres inválidos.');
      setResult(null);
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/store-connections/${encodeURIComponent(storeId)}/fiscal-preflight/${encodeURIComponent(normalizedOrderId)}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      );
      const payload = await response.json().catch(() => ({})) as Partial<FiscalPreflightResult> & { error?: string };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `Não foi possível analisar o pedido (${response.status}).`
        );
      }
      if (
        payload.schemaVersion !== 2 ||
        payload.readAuthority !== 'server_canonical_read_only' ||
        !payload.evidence ||
        !payload.simulation
      ) {
        throw new Error('O servidor retornou um diagnóstico fiscal incompatível.');
      }
      setResult(payload as FiscalPreflightResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível analisar o pedido agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4" id="fiscal-homologation-preflight-workspace">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <FileSearch className="h-5 w-5 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Homologação · pré-flight
            </span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Analisar pedido canônico</h4>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Esta análise relê o pedido, o cadastro CPF/CNPJ do emissor, os dados fiscais privados dos itens e a evidência contábil. É somente simulação e não concede autoridade de emissão.
            </p>
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
        <label className="block text-[8px] font-black uppercase tracking-wide text-slate-500" htmlFor="fiscal-preflight-order-id">
          ID do pedido canônico
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="fiscal-preflight-order-id"
            type="text"
            value={orderId}
            onChange={event => setOrderId(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !loading) void analyze();
            }}
            placeholder="Ex.: order-..."
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={loading}
            id="run-fiscal-preflight-analysis"
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-45"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
            {loading ? 'Analisando...' : 'Analisar pedido'}
          </button>
        </div>
        <p className="mt-2 text-[8px] leading-relaxed text-slate-500">
          O navegador envia somente o ID do pedido. A evidência fiscal e comercial é relida pelo servidor.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-[9px] leading-relaxed text-red-100" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4" id="fiscal-preflight-result" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
            <div>
              <span className="font-mono text-[8px] font-black uppercase tracking-wide text-amber-300">
                Resultado da simulação
              </span>
              <strong className="mt-1 block text-[11px] uppercase text-white">Sem autoridade de emissão</strong>
              <p className="mt-1 text-[9px] text-slate-400">
                Pedido {result.evidence.orderId} · {channelLabel(result.evidence.sourceChannel)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase text-amber-100">
              <ShieldAlert className="h-3.5 w-3.5" /> Bloqueado para emissão
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <article className={`rounded-2xl border p-4 ${statusClass(result.evidence.issuerIdentity.status === 'ready')}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Emissor fiscal</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {result.evidence.issuerIdentity.status === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {result.evidence.issuerIdentity.status === 'ready'
                  ? `${result.evidence.issuerIdentity.identifierKind?.toUpperCase()} validado`
                  : 'Cadastro pendente'}
              </strong>
              <p className="mt-1 text-[8px] opacity-70">
                Ambiente: {result.evidence.issuerIdentity.environment === 'sandbox' ? 'Homologação' : 'Produção'}
              </p>
            </article>

            <article className={`rounded-2xl border p-4 ${statusClass(result.evidence.commercialConfirmation)}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Confirmação comercial</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {result.evidence.commercialConfirmation ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {result.evidence.commercialConfirmation ? 'Pagamento confirmado' : 'Ainda não confirmada'}
              </strong>
              <p className="mt-1 text-[8px] opacity-70">Status canônico: {result.evidence.paymentStatus || 'não informado'}</p>
            </article>

            <article className={`rounded-2xl border p-4 ${statusClass(productSummary.total > 0 && productSummary.ready === productSummary.total)}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Preparo fiscal dos itens</span>
              <strong className="mt-1 block text-[11px]">{productSummary.ready} de {productSummary.total} preparado(s)</strong>
              {productSummary.missing.length > 0 && (
                <p className="mt-1 break-words text-[8px] opacity-70">
                  Pendentes: {productSummary.missing.map(item => item.productId).join(', ')}
                </p>
              )}
            </article>

            <article className={`rounded-2xl border p-4 ${statusClass(result.evidence.accountingDecision.status === 'recorded')}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Evidência contábil</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {result.evidence.accountingDecision.status === 'recorded' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {result.evidence.accountingDecision.status === 'recorded' ? 'Referência registrada' : 'Orientação pendente'}
              </strong>
              {result.evidence.accountingDecision.policyReference && (
                <p className="mt-1 break-words text-[8px] opacity-70">{result.evidence.accountingDecision.policyReference}</p>
              )}
            </article>
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <span className="font-mono text-[8px] font-black uppercase tracking-wide text-slate-500">O que ainda falta</span>
            <div className="mt-3 space-y-2">
              {result.simulation.blockingReasons.map(reason => (
                <div key={reason} className="flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2 text-[9px] leading-relaxed text-amber-100">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{BLOCKER_LABELS[reason]}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] px-4 py-3 text-[9px] leading-relaxed text-violet-100">
            O pré-flight não escolhe NF-e, NFC-e ou NFS-e, não define CFOP/CST/CSOSN ou alíquotas e não chama SEFAZ/provedor. Gatilho fiscal e família do documento permanecem nulos até existir política contábil executável.
          </p>
        </div>
      )}
    </div>
  );
}
