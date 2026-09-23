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
  | 'homologation_policy_required'
  | 'homologation_policy_not_effective'
  | 'homologation_policy_scope_mismatch'
  | 'fiscal_issuer_identity_required'
  | 'product_fiscal_preparation_incomplete'
  | 'operational_trigger_not_satisfied';

type DocumentFamily = 'nfe' | 'nfce' | 'nfse';
type OperationalTrigger =
  | 'payment_confirmed'
  | 'fulfillment_confirmed'
  | 'service_completed';
type OperationScope = 'goods' | 'service' | 'mixed';

interface FiscalPreflightResult {
  schemaVersion: 3;
  readAuthority: 'server_canonical_read_only';
  canonicalStoreId: string;
  evidence: {
    orderId: string;
    sourceChannel: 'kyrub' | 'mercado_livre' | '99food' | 'other';
    paymentStatus: string;
    operationScope: OperationScope;
    commercialConfirmation: boolean;
    commercialConfirmationAuthority:
      | 'canonical_payment_projection'
      | 'not_applicable_or_unresolved';
    issuerIdentity: {
      status: 'ready' | 'required';
      identifierKind: 'cpf' | 'cnpj' | null;
      environment: 'sandbox' | 'production';
    };
    issuerIdentityAuthority: 'tenant_operational_settings_fiscal_issuer_profile';
    consumerIdentity: {
      status: 'identified' | 'not_provided';
      identifierKind: 'cpf' | 'cnpj' | null;
      maskedTaxIdentifier: string | null;
    };
    consumerIdentityAuthority: 'canonical_order_fiscal_consumer_identity';
    productPreparation: Array<{
      productId: string;
      kind: 'goods' | 'service';
      fiscalProfileReady: boolean;
    }>;
    homologationPolicy: {
      status: 'missing' | 'draft' | 'approved';
      policyId: string | null;
      version: number | null;
      policyReference: string | null;
      effectiveFrom: string | null;
      operationScope: OperationScope | null;
      documentFamily: DocumentFamily | null;
      operationalTrigger: OperationalTrigger | null;
      environment: 'sandbox';
      authority: 'canonical_homologation_policy_registry';
      sourcePath: string;
    };
    operationalTrigger: {
      trigger: OperationalTrigger | null;
      satisfied: boolean;
      authority:
        | 'canonical_payment_projection'
        | 'not_implemented_fail_closed'
        | 'homologation_policy_required';
      payment: null | {
        projection: {
          expectedAmount: number;
          authoritativelyPaidAmount: number;
          outstandingAmount: number;
          pendingPaymentCount: number;
          canonicalPaymentCount: number;
          state: 'not_started' | 'pending' | 'partial' | 'paid' | 'refunded' | 'attention';
        };
        consistency:
          | 'aligned'
          | 'canonical_ahead'
          | 'line_settlement_ahead'
          | 'mixed_authority_requires_reconciliation'
          | 'payment_history_limit_reached';
        ignoredLegacyMirrorCount: number;
      };
    };
  };
  simulation: {
    schemaVersion: 3;
    mode: 'simulation_only';
    preflightStatus: 'blocked' | 'ready_for_homologation';
    blockingReasons: FiscalBlockingReason[];
    requiredInputs: string[];
    execution: {
      fiscalTrigger: OperationalTrigger | null;
      documentFamily: DocumentFamily | null;
      emissionAuthority: 'none_homologation_only';
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
  homologation_policy_required: 'Aprovar uma política fiscal de homologação completa e auditável.',
  homologation_policy_not_effective: 'Aguardar o início da vigência da política fiscal aprovada.',
  homologation_policy_scope_mismatch: 'A política aprovada não corresponde ao escopo de itens deste pedido.',
  fiscal_issuer_identity_required: 'Completar nome fiscal e CPF/CNPJ do emissor em homologação.',
  product_fiscal_preparation_incomplete: 'Completar os dados fiscais dos itens indicados.',
  operational_trigger_not_satisfied: 'Aguardar a evidência autoritativa exigida pelo gatilho da política.',
};

const channelLabel = (value: FiscalPreflightResult['evidence']['sourceChannel']): string => {
  if (value === 'mercado_livre') return 'Mercado Livre';
  if (value === '99food') return '99Food';
  if (value === 'kyrub') return 'Kyrub';
  return 'Outro canal';
};

const familyLabel = (value: DocumentFamily | null): string => {
  if (value === 'nfe') return 'NF-e';
  if (value === 'nfce') return 'NFC-e';
  if (value === 'nfse') return 'NFS-e';
  return 'Não resolvida';
};

const triggerLabel = (value: OperationalTrigger | null): string => {
  if (value === 'payment_confirmed') return 'Pagamento confirmado';
  if (value === 'fulfillment_confirmed') return 'Atendimento/entrega confirmado';
  if (value === 'service_completed') return 'Serviço concluído';
  return 'Não resolvido';
};

const scopeLabel = (value: OperationScope | null): string => {
  if (value === 'goods') return 'Mercadorias';
  if (value === 'service') return 'Serviços';
  if (value === 'mixed') return 'Misto';
  return 'Não definido';
};

const money = (value: number): string => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

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
        payload.schemaVersion !== 3 ||
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

  const ready = result?.simulation.preflightStatus === 'ready_for_homologation';
  const policy = result?.evidence.homologationPolicy ?? null;
  const triggerEvidence = result?.evidence.operationalTrigger ?? null;
  const payment = triggerEvidence?.payment ?? null;

  return (
    <div className="space-y-4" id="fiscal-homologation-preflight-workspace">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <FileSearch className="h-5 w-5 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Homologação · pré-flight canônico
            </span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Analisar pedido canônico</h4>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              O servidor relê o pedido, a política de homologação versionada, o emissor, os dados fiscais privados dos itens e a evidência financeira canônica. Esta etapa continua sem autoridade de emissão.
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
          O navegador envia somente o ID do pedido. Política, pagamento e demais evidências são relidos no servidor.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-[9px] leading-relaxed text-red-100" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && policy && triggerEvidence && (
        <div className="space-y-4" id="fiscal-preflight-result" aria-live="polite">
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${ready ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-amber-500/20 bg-amber-500/[0.04]'}`}>
            <div>
              <span className={`font-mono text-[8px] font-black uppercase tracking-wide ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                Resultado do pré-flight
              </span>
              <strong className="mt-1 block text-[11px] uppercase text-white">
                {ready ? 'Pronto para homologação · sem emissão habilitada' : 'Bloqueado para homologação'}
              </strong>
              <p className="mt-1 text-[9px] text-slate-400">
                Pedido {result.evidence.orderId} · {channelLabel(result.evidence.sourceChannel)} · escopo {scopeLabel(result.evidence.operationScope)}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[8px] font-black uppercase ${ready ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/25 bg-amber-500/10 text-amber-100'}`}>
              {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              Sem autoridade de emissão
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <article className={`rounded-2xl border p-4 ${statusClass(policy.status === 'approved')}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Política de homologação</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {policy.status === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {policy.status === 'approved' ? `Aprovada · v${policy.version}` : policy.status === 'draft' ? 'Rascunho/incompleta' : 'Não cadastrada'}
              </strong>
              {policy.policyReference && <p className="mt-1 break-words text-[8px] opacity-70">{policy.policyReference}</p>}
              <p className="mt-1 text-[8px] opacity-70">
                {familyLabel(policy.documentFamily)} · {scopeLabel(policy.operationScope)} · {triggerLabel(policy.operationalTrigger)}
              </p>
              {policy.effectiveFrom && (
                <p className="mt-1 text-[8px] opacity-70">Vigência: {new Date(policy.effectiveFrom).toLocaleString('pt-BR')}</p>
              )}
            </article>

            <article className={`rounded-2xl border p-4 ${statusClass(triggerEvidence.satisfied)}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Gatilho operacional</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {triggerEvidence.satisfied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {triggerLabel(triggerEvidence.trigger)}
              </strong>
              <p className="mt-1 text-[8px] opacity-70">
                {triggerEvidence.satisfied ? 'Evidência autoritativa satisfeita' : 'Evidência ainda não satisfeita'}
              </p>
              {payment && (
                <p className="mt-1 text-[8px] opacity-70">
                  Canônico: {payment.projection.state} · {money(payment.projection.authoritativelyPaidAmount)} / {money(payment.projection.expectedAmount)} · consistência {payment.consistency}
                </p>
              )}
            </article>

            <article className={`rounded-2xl border p-4 ${statusClass(result.evidence.issuerIdentity.status === 'ready' && result.evidence.issuerIdentity.environment === 'sandbox')}`}>
              <span className="text-[8px] font-black uppercase opacity-70">Emissor fiscal</span>
              <strong className="mt-1 flex items-center gap-1.5 text-[11px]">
                {result.evidence.issuerIdentity.status === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {result.evidence.issuerIdentity.status === 'ready'
                  ? `${result.evidence.issuerIdentity.identifierKind?.toUpperCase()} validado`
                  : 'Cadastro pendente'}
              </strong>
              <p className="mt-1 text-[8px] opacity-70">
                Ambiente: {result.evidence.issuerIdentity.environment === 'sandbox' ? 'Homologação' : 'Produção — não aceito neste pré-flight'}
              </p>
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
          </div>

          {result.simulation.blockingReasons.length > 0 && (
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
          )}

          <p className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] px-4 py-3 text-[9px] leading-relaxed text-violet-100">
            Família documental e gatilho vêm exclusivamente da política aprovada. Este pré-flight não calcula CFOP/CST/CSOSN ou alíquotas, não cria documento fiscal e não chama Focus, outro provedor, SEFAZ ou prefeitura. Mesmo quando o resultado fica pronto para homologação, a autoridade de emissão continua inexistente nesta etapa.
          </p>
        </div>
      )}
    </div>
  );
}
