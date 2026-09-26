import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { FileText, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import FiscalHomologationExecutionWorkspace from './FiscalHomologationExecutionWorkspace';

type DocumentFamily = 'nfe' | 'nfce' | 'nfse';

type HistoricalFiscalPreflight = {
  schemaVersion: 3;
  readAuthority: 'server_canonical_read_only';
  evidence: {
    orderId: string;
    sourceChannel: 'kyrub' | 'mercado_livre' | '99food' | 'other';
    commercialConfirmation: boolean;
    consumerIdentity: {
      status: 'identified' | 'not_provided';
      identifierKind: 'cpf' | 'cnpj' | null;
      maskedTaxIdentifier: string | null;
    };
    issuerIdentity: {
      status: 'ready' | 'required';
      identifierKind: 'cpf' | 'cnpj' | null;
      environment: 'sandbox' | 'production';
    };
    homologationPolicy: {
      status: 'missing' | 'draft' | 'approved';
      documentFamily: DocumentFamily | null;
      policyReference: string | null;
      version: number | null;
    };
  };
  simulation: {
    preflightStatus: 'blocked' | 'ready_for_homologation';
    blockingReasons: string[];
    requiredInputs: string[];
    execution: {
      documentFamily: DocumentFamily | null;
      emissionAuthority: 'none_homologation_only';
    };
  };
};

const channelLabel = (channel: HistoricalFiscalPreflight['evidence']['sourceChannel']): string => {
  if (channel === 'mercado_livre') return 'Mercado Livre';
  if (channel === '99food') return '99Food';
  if (channel === 'kyrub') return 'Kyrub';
  return 'Outro canal';
};

const familyLabel = (family: DocumentFamily | null): string => {
  if (family === 'nfce') return 'NFC-e';
  if (family === 'nfe') return 'NF-e';
  if (family === 'nfse') return 'NFS-e';
  return 'Não definida';
};

const blockerLabel = (reason: string): string => {
  const labels: Record<string, string> = {
    homologation_policy_required: 'Política fiscal de homologação ainda não está pronta.',
    homologation_policy_not_effective: 'A política fiscal ainda não entrou em vigência.',
    homologation_policy_scope_mismatch: 'A política fiscal não corresponde ao escopo desta venda.',
    fiscal_issuer_identity_required: 'Cadastro fiscal do emissor ainda está incompleto.',
    product_fiscal_preparation_incomplete: 'Há itens da venda sem preparo fiscal completo.',
    operational_trigger_not_satisfied: 'A evidência operacional exigida pela política ainda não está satisfeita.',
  };
  return labels[reason] ?? reason;
};

export default function HistoricalFiscalSaleWorkspace({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [result, setResult] = useState<HistoricalFiscalPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => auth.onAuthStateChanged(setUser), []);

  const load = useCallback(async (): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError('Faça login novamente para consultar o documento fiscal desta venda.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `/api/store-connections/${encodeURIComponent(currentUser.uid)}/fiscal-preflight/${encodeURIComponent(orderId)}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      );
      const payload = await response.json().catch(() => ({})) as Partial<HistoricalFiscalPreflight> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Não foi possível abrir o pedido fiscal (${response.status}).`);
      }
      if (
        payload.schemaVersion !== 3 ||
        payload.readAuthority !== 'server_canonical_read_only' ||
        !payload.evidence ||
        !payload.simulation
      ) {
        throw new Error('O servidor retornou um diagnóstico fiscal incompatível.');
      }
      setResult(payload as HistoricalFiscalPreflight);
      setUser(currentUser);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o pedido fiscal agora.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = result?.simulation.preflightStatus === 'ready_for_homologation';
  const documentFamily = result?.simulation.execution.documentFamily ?? null;

  return (
    <section className="mt-4 min-w-0 max-w-full overflow-hidden rounded-2xl border border-violet-500/25 bg-violet-500/[0.04] p-4" data-kyrub-historical-fiscal-order={orderId}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
            <FileText className="h-4 w-4 text-violet-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.14em] text-violet-300">Documento fiscal · venda histórica</span>
            <h5 className="mt-1 text-[11px] font-black uppercase text-white">Pedido original preservado</h5>
            <p className="mt-1 break-words text-[9px] leading-relaxed text-slate-400 [overflow-wrap:anywhere]">{orderId}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar documento fiscal" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-400 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[9px] text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Relendo pedido, pagamento e evidências fiscais canônicas…
        </div>
      )}

      {error && !loading && (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-3 text-[9px] leading-relaxed text-rose-200">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-500/25 px-3 text-[8px] font-black uppercase">
            <RefreshCw className="h-3 w-3" /> Tentar novamente
          </button>
        </div>
      )}

      {result && !loading && (
        <div className="mt-4 space-y-3">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Venda</span>
              <strong className="mt-1 block text-[10px] text-white">{channelLabel(result.evidence.sourceChannel)}</strong>
              <span className="mt-1 block text-[8px] text-slate-500">{result.evidence.commercialConfirmation ? 'Pagamento confirmado' : 'Confirmação comercial pendente'}</span>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Documento previsto</span>
              <strong className="mt-1 block text-[10px] text-white">{familyLabel(documentFamily)}</strong>
              <span className="mt-1 block text-[8px] text-violet-300">Homologação / sandbox</span>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Consumidor</span>
              <strong className="mt-1 block text-[10px] text-white">
                {result.evidence.consumerIdentity.status === 'identified'
                  ? `${result.evidence.consumerIdentity.identifierKind?.toUpperCase()} ${result.evidence.consumerIdentity.maskedTaxIdentifier ?? ''}`.trim()
                  : 'CPF/CNPJ não informado'}
              </strong>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <span className="text-[8px] font-black uppercase text-slate-600">Situação fiscal</span>
              <strong className={`mt-1 flex items-center gap-1.5 text-[10px] ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                <ShieldCheck className="h-3.5 w-3.5" />
                {ready ? 'Pronta para homologação' : 'Revisão necessária'}
              </strong>
            </div>
          </div>

          {!ready && result.simulation.blockingReasons.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <span className="text-[8px] font-black uppercase text-amber-300">Antes de preparar o documento</span>
              <div className="mt-2 space-y-1.5">
                {result.simulation.blockingReasons.map(reason => (
                  <p key={reason} className="text-[9px] leading-relaxed text-amber-100">• {blockerLabel(reason)}</p>
                ))}
              </div>
            </div>
          )}

          <p className="rounded-xl border border-violet-500/15 bg-slate-950/50 px-3 py-2 text-[8px] leading-relaxed text-slate-400">
            Este acesso nasce do pagamento histórico, mas toda decisão fiscal é relida do pedido canônico original. A execução disponível hoje permanece somente em homologação; nenhuma emissão de produção é feita automaticamente.
          </p>

          {user && (
            <FiscalHomologationExecutionWorkspace
              user={user}
              storeId={user.uid}
              orderId={orderId}
              enabled={ready === true}
              documentFamily={documentFamily}
            />
          )}
        </div>
      )}
    </section>
  );
}
