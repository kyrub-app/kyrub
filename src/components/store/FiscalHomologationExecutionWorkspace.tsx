import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';

type DocumentFamily = 'nfe' | 'nfce' | 'nfse';
type AttemptState =
  | 'prepared'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'technical_failure'
  | 'manual_review_required'
  | 'reconciliation_required';

interface FocusReadiness {
  schemaVersion: 1;
  provider: 'Focus NFe';
  adapterId: 'focus-nfe';
  adapterVersion: '1';
  documentFamily: 'nfce';
  environment: 'sandbox';
  configured: boolean;
  active: boolean;
  credentialPresent: boolean;
  verificationStatus: 'not_configured' | 'configured_unverified';
}

interface PreparedResult {
  schemaVersion: 1;
  action: 'prepared_for_homologation';
  environment: 'sandbox';
  providerCallMade: false;
  sefazCallMade: false;
  attempt: {
    attemptId: string;
    reused: boolean;
    orderId: string;
    documentFamily: DocumentFamily;
    structuralPolicy: {
      policyId: string;
      version: number;
      policyReference: string;
    };
    fiscalDocument: {
      sourceSnapshotId: string;
      readySnapshotId: string;
      status: 'ready';
    };
    taxPolicy: {
      policyId: string;
      version: number;
      accountingReference: string;
    };
    state: 'prepared';
  };
}

interface ExecutionAttempt {
  attemptId: string;
  orderId: string;
  state: AttemptState;
  externalRequestId: string | null;
  providerStatus: string | null;
  providerCode: string | null;
  providerMessage: string | null;
  authorizationProtocol: string | null;
  accessKey: string | null;
  documentNumber: string | null;
  submittedAt: string | null;
  lastCheckedAt: string | null;
}

const readError = async (response: Response, fallback: string): Promise<string> => {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  const code = typeof payload.error === 'string' ? payload.error.trim() : '';
  const known: Record<string, string> = {
    FISCAL_TAX_EXECUTION_POLICY_NOT_READY: 'A política tributária explícita ainda não está aprovada/vigente para este documento.',
    FISCAL_TAX_EXECUTION_PRODUCT_RULE_REQUIRED: 'A política tributária ainda não cobre todos os produtos deste pedido.',
    FISCAL_PROVIDER_NOT_CONFIGURED: 'Conecte a Focus NFC-e em homologação antes de emitir.',
    FISCAL_PROVIDER_CONFIGURATION_INACTIVE: 'A conexão Focus está desativada. Reative-a antes de emitir.',
    FISCAL_PROVIDER_CREDENTIAL_MISSING: 'A credencial protegida da Focus não está disponível.',
    KYRUB_CREDENTIAL_VAULT_DISABLED: 'O cofre seguro de credenciais fiscais ainda não está habilitado no ambiente.',
    FISCAL_ATTEMPT_PREFLIGHT_NOT_READY: 'O pré-flight fiscal deixou de estar pronto. Analise novamente o pedido.',
    FISCAL_EXECUTABLE_DOCUMENT_NOT_READY: 'O documento fiscal executável não está pronto. Prepare novamente após revisar as configurações.',
  };
  return known[code] ?? code || fallback;
};

const attemptStateLabel = (state: AttemptState): string => {
  const labels: Record<AttemptState, string> = {
    prepared: 'Preparada',
    processing: 'Processando',
    authorized: 'Autorizada em homologação',
    rejected: 'Rejeitada em homologação',
    technical_failure: 'Falha técnica',
    manual_review_required: 'Revisão manual necessária',
    reconciliation_required: 'Reconciliação necessária',
  };
  return labels[state];
};

export default function FiscalHomologationExecutionWorkspace({
  user,
  storeId,
  orderId,
  enabled,
  documentFamily,
}: {
  user: User;
  storeId: string;
  orderId: string;
  enabled: boolean;
  documentFamily: DocumentFamily | null;
}) {
  const [focusReadiness, setFocusReadiness] = useState<FocusReadiness | null>(null);
  const [prepared, setPrepared] = useState<PreparedResult | null>(null);
  const [execution, setExecution] = useState<ExecutionAttempt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState(false);
  const [busy, setBusy] = useState<'prepare' | 'execute' | 'reconcile' | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const baseEndpoint = `/api/store-connections/fiscal-homologation/${encodeURIComponent(storeId)}`;

  useEffect(() => {
    setPrepared(null);
    setExecution(null);
    setConfirmed(false);
    setNotice(null);
  }, [orderId, documentFamily, enabled]);

  const loadProvider = useCallback(async (): Promise<void> => {
    if (!enabled || documentFamily !== 'nfce') {
      setFocusReadiness(null);
      return;
    }
    setLoadingProvider(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/store-connections/fiscal-provider/focus-nfce/${encodeURIComponent(storeId)}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
          credentials: 'same-origin',
        }
      );
      if (!response.ok) {
        setFocusReadiness(null);
        return;
      }
      setFocusReadiness(await response.json() as FocusReadiness);
    } finally {
      setLoadingProvider(false);
    }
  }, [documentFamily, enabled, storeId, user]);

  useEffect(() => {
    void loadProvider();
  }, [loadProvider]);

  const prepare = async (): Promise<void> => {
    setBusy('prepare');
    setNotice(null);
    setExecution(null);
    setConfirmed(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `${baseEndpoint}/orders/${encodeURIComponent(orderId)}/prepare`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
          credentials: 'same-origin',
        }
      );
      if (!response.ok) throw new Error(await readError(response, `Não foi possível preparar a homologação (${response.status}).`));
      const payload = await response.json() as PreparedResult;
      if (
        payload.schemaVersion !== 1 ||
        payload.action !== 'prepared_for_homologation' ||
        payload.environment !== 'sandbox' ||
        payload.providerCallMade !== false ||
        payload.sefazCallMade !== false ||
        payload.attempt?.state !== 'prepared' ||
        payload.attempt?.fiscalDocument?.status !== 'ready'
      ) {
        throw new Error('O servidor retornou uma preparação fiscal incompatível.');
      }
      setPrepared(payload);
      setNotice({
        type: 'success',
        message: 'Homologação preparada e congelada no servidor. Nenhum documento foi enviado à Focus.',
      });
      await loadProvider();
    } catch (cause) {
      setPrepared(null);
      setNotice({ type: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível preparar a homologação.' });
    } finally {
      setBusy(null);
    }
  };

  const execute = async (): Promise<void> => {
    const attemptId = prepared?.attempt.attemptId;
    if (!attemptId || !confirmed) return;
    setBusy('execute');
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${baseEndpoint}/attempts/${encodeURIComponent(attemptId)}/execute`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await readError(response, `Não foi possível executar a homologação (${response.status}).`));
      const payload = await response.json() as { schemaVersion: 1; action: string; environment: 'sandbox'; attempt: ExecutionAttempt };
      if (payload.schemaVersion !== 1 || payload.environment !== 'sandbox' || !payload.attempt?.attemptId) {
        throw new Error('O servidor retornou um resultado fiscal incompatível.');
      }
      setExecution(payload.attempt);
      setConfirmed(false);
      setNotice({
        type: payload.attempt.state === 'rejected' ? 'error' : 'success',
        message: payload.attempt.state === 'authorized'
          ? 'NFC-e autorizada no ambiente de homologação.'
          : payload.attempt.state === 'rejected'
            ? 'A Focus rejeitou a NFC-e de homologação. Revise o retorno antes de criar uma nova tentativa.'
            : payload.attempt.state === 'processing' || payload.attempt.state === 'reconciliation_required'
              ? 'A situação precisa ser reconciliada com a Focus antes de qualquer nova ação.'
              : `Homologação retornou o estado: ${attemptStateLabel(payload.attempt.state)}.`,
      });
    } catch (cause) {
      setNotice({ type: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível executar a homologação.' });
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async (): Promise<void> => {
    const attemptId = execution?.attemptId ?? prepared?.attempt.attemptId;
    if (!attemptId) return;
    setBusy('reconcile');
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${baseEndpoint}/attempts/${encodeURIComponent(attemptId)}/reconcile`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await readError(response, `Não foi possível reconciliar a homologação (${response.status}).`));
      const payload = await response.json() as { schemaVersion: 1; action: string; environment: 'sandbox'; resubmitted: false; attempt: ExecutionAttempt };
      if (payload.schemaVersion !== 1 || payload.environment !== 'sandbox' || payload.resubmitted !== false) {
        throw new Error('O servidor retornou uma reconciliação fiscal incompatível.');
      }
      setExecution(payload.attempt);
      setNotice({
        type: payload.attempt.state === 'rejected' ? 'error' : 'success',
        message: payload.attempt.state === 'authorized'
          ? 'A reconciliação confirmou a autorização em homologação.'
          : payload.attempt.state === 'rejected'
            ? 'A reconciliação confirmou a rejeição em homologação.'
            : `Situação reconciliada: ${attemptStateLabel(payload.attempt.state)}. Nenhum novo envio foi realizado.`,
      });
    } catch (cause) {
      setNotice({ type: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível reconciliar a homologação.' });
    } finally {
      setBusy(null);
    }
  };

  if (!enabled) return null;

  if (documentFamily !== 'nfce') {
    return (
      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.035] p-4" id="fiscal-homologation-execution-workspace">
        <div className="flex items-start gap-2 text-[9px] leading-relaxed text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>O pré-flight está pronto, mas a execução real desta fase está habilitada somente para NFC-e em homologação. NF-e e NFS-e continuam fail-closed.</span>
        </div>
      </section>
    );
  }

  const focusReady = focusReadiness?.configured === true && focusReadiness.active === true && focusReadiness.credentialPresent === true;
  const state = execution?.state ?? prepared?.attempt.state ?? null;
  const reconciliationNeeded = state === 'processing' || state === 'reconciliation_required';
  const canExecute = prepared?.attempt.state === 'prepared' && !execution && focusReady && confirmed && !busy;

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4" id="fiscal-homologation-execution-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <FileCheck2 className="h-5 w-5 text-emerald-300" />
          </span>
          <div>
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300">NFC-e · homologação controlada</span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Preparar antes de emitir</h4>
            <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-slate-400">Preparar congela pedido, pagamento e versões das políticas sem chamar a Focus. A chamada externa só acontece depois de uma segunda confirmação explícita.</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase ${focusReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>
          {loadingProvider ? 'Consultando Focus' : focusReady ? 'Focus pronta · sandbox' : 'Focus não pronta'}
        </span>
      </div>

      {!prepared && (
        <button type="button" id="prepare-fiscal-homologation" onClick={() => void prepare()} disabled={busy !== null} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 text-[9px] font-black uppercase text-emerald-100 disabled:opacity-45">
          {busy === 'prepare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="h-3.5 w-3.5" />}
          {busy === 'prepare' ? 'Preparando...' : 'Preparar homologação'}
        </button>
      )}

      {prepared && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-500">Tentativa</span><p className="mt-1 break-all font-mono text-[8px] text-white">{prepared.attempt.attemptId}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-500">Política estrutural</span><p className="mt-1 text-[9px] font-bold text-white">v{prepared.attempt.structuralPolicy.version}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><span className="text-[8px] font-black uppercase text-slate-500">Política tributária</span><p className="mt-1 text-[9px] font-bold text-white">v{prepared.attempt.taxPolicy.version}</p></div>
          </div>

          {!execution && (
            <label className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[9px] leading-relaxed text-amber-100">
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy !== null || !focusReady} className="mt-0.5" id="confirm-fiscal-homologation-submit" />
              <span>Confirmo o envio desta NFC-e exclusivamente ao ambiente de homologação da Focus. Esta ação fará uma chamada externa; não é emissão de produção.</span>
            </label>
          )}

          {!execution && (
            <button type="button" id="execute-fiscal-homologation" onClick={() => void execute()} disabled={!canExecute} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-[9px] font-black uppercase text-slate-950 disabled:opacity-45">
              {busy === 'execute' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {busy === 'execute' ? 'Enviando à homologação...' : 'Emitir NFC-e em homologação'}
            </button>
          )}

          {!focusReady && !loadingProvider && !execution && (
            <p className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2.5 text-[8px] leading-relaxed text-amber-100/80">A tentativa pode ser preparada, mas o envio permanece bloqueado até a conexão Focus NFC-e acima estar ativa e com credencial protegida.</p>
          )}
        </div>
      )}

      {execution && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <span className="text-[8px] font-black uppercase text-slate-500">Estado da tentativa</span>
            <strong className="mt-1 block text-[10px] text-white">{attemptStateLabel(execution.state)}</strong>
            {execution.providerCode && <p className="mt-1 text-[8px] text-slate-400">Código do provedor: {execution.providerCode}</p>}
            {execution.providerMessage && <p className="mt-1 break-words text-[8px] text-slate-400">{execution.providerMessage}</p>}
            {execution.documentNumber && <p className="mt-1 text-[8px] text-slate-400">Documento: {execution.documentNumber}</p>}
            {execution.accessKey && <p className="mt-1 break-all font-mono text-[8px] text-slate-400">Chave: {execution.accessKey}</p>}
          </div>

          {reconciliationNeeded && (
            <button type="button" id="reconcile-fiscal-homologation" onClick={() => void reconcile()} disabled={busy !== null} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-45">
              {busy === 'reconcile' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy === 'reconcile' ? 'Reconciliando...' : 'Reconciliar com a Focus'}
            </button>
          )}
        </div>
      )}

      {notice && (
        <div role="status" className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[9px] leading-relaxed ${notice.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-100' : 'border-red-500/20 bg-red-500/[0.05] text-red-100'}`}>
          {notice.type === 'success' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}
    </section>
  );
}
