import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';

type OperationScope = '' | 'goods' | 'service' | 'mixed';
type DocumentFamily = '' | 'nfe' | 'nfce' | 'nfse';
type OperationalTrigger =
  | ''
  | 'payment_confirmed'
  | 'fulfillment_confirmed'
  | 'service_completed';

type MissingInput =
  | 'policy_reference'
  | 'effective_from'
  | 'operation_scope'
  | 'document_family'
  | 'operational_trigger';

interface HomologationPolicyRecord {
  schemaVersion: 1;
  canonicalStoreId: string;
  updatedByUserId: string;
  updatedAt: string;
  resolution: {
    schemaVersion: 1;
    resolutionStatus: 'draft_incomplete' | 'ready_for_homologation';
    missingInputs: MissingInput[];
    executableInProduction: false;
    emissionAuthority: 'none_homologation_only';
    providerCallAllowed: false;
    sefazCallAllowed: false;
    policy: {
      schemaVersion: 1;
      policyId: string;
      storeId: string;
      version: number;
      status: 'draft' | 'approved_for_homologation';
      policyReference: string;
      effectiveFrom: string | null;
      operationScope: Exclude<OperationScope, ''> | null;
      documentFamily: Exclude<DocumentFamily, ''> | null;
      operationalTrigger: Exclude<OperationalTrigger, ''> | null;
      environment: 'sandbox';
      authority: 'explicit_accounting_policy_for_homologation';
      emissionAuthority: 'none_homologation_only';
      providerCallAllowed: false;
      sefazCallAllowed: false;
    };
  };
}

const EMPTY_MISSING: MissingInput[] = [
  'policy_reference',
  'effective_from',
  'operation_scope',
  'document_family',
  'operational_trigger',
];

const MISSING_LABELS: Record<MissingInput, string> = {
  policy_reference: 'Referência da orientação contábil',
  effective_from: 'Data de vigência',
  operation_scope: 'Escopo da operação',
  document_family: 'Família do documento',
  operational_trigger: 'Gatilho operacional',
};

const asDateInput = (value: string | null): string =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';

export default function FiscalHomologationPolicyWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [policyReference, setPolicyReference] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [operationScope, setOperationScope] = useState<OperationScope>('');
  const [documentFamily, setDocumentFamily] = useState<DocumentFamily>('');
  const [operationalTrigger, setOperationalTrigger] = useState<OperationalTrigger>('');
  const [record, setRecord] = useState<HomologationPolicyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const missingInputs = useMemo<MissingInput[]>(() => {
    const missing: MissingInput[] = [];
    if (!policyReference.trim()) missing.push('policy_reference');
    if (!effectiveFrom) missing.push('effective_from');
    if (!operationScope) missing.push('operation_scope');
    if (!documentFamily) missing.push('document_family');
    if (!operationalTrigger) missing.push('operational_trigger');
    return missing;
  }, [policyReference, effectiveFrom, operationScope, documentFamily, operationalTrigger]);

  const applyRecord = (next: HomologationPolicyRecord | null): void => {
    setRecord(next);
    const policy = next?.resolution.policy;
    setPolicyReference(policy?.policyReference ?? '');
    setEffectiveFrom(asDateInput(policy?.effectiveFrom ?? null));
    setOperationScope(policy?.operationScope ?? '');
    setDocumentFamily(policy?.documentFamily ?? '');
    setOperationalTrigger(policy?.operationalTrigger ?? '');
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setNotice(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/store-connections/${encodeURIComponent(storeId)}/fiscal-policy/homologation`,
          {
            method: 'GET',
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const payload = await response.json().catch(() => ({})) as {
          policy?: HomologationPolicyRecord | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `Não foi possível carregar a política (${response.status}).`);
        }
        if (!cancelled) applyRecord(payload.policy ?? null);
      } catch (cause) {
        if (!cancelled) {
          setNotice({
            type: 'error',
            message: cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar a política de homologação.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [storeId, user]);

  const persist = async (approveForHomologation: boolean): Promise<void> => {
    if (approveForHomologation && missingInputs.length > 0) {
      setNotice({
        type: 'error',
        message: `Complete antes da aprovação: ${missingInputs.map(item => MISSING_LABELS[item]).join(', ')}.`,
      });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/store-connections/${encodeURIComponent(storeId)}/fiscal-policy/homologation`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          cache: 'no-store',
          body: JSON.stringify({
            policyReference: policyReference.trim(),
            effectiveFrom,
            operationScope: operationScope || null,
            documentFamily: documentFamily || null,
            operationalTrigger: operationalTrigger || null,
            approveForHomologation,
          }),
        }
      );
      const payload = await response.json().catch(() => ({})) as {
        policy?: HomologationPolicyRecord;
        error?: string;
      };
      if (!response.ok || !payload.policy) {
        throw new Error(
          payload.error || `Não foi possível salvar a política (${response.status}).`
        );
      }
      applyRecord(payload.policy);
      setNotice({
        type: 'success',
        message: approveForHomologation
          ? 'Política aprovada somente para homologação. Produção e emissão continuam bloqueadas.'
          : 'Rascunho fiscal salvo. Nenhuma autoridade de emissão foi concedida.',
      });
    } catch (cause) {
      setNotice({
        type: 'error',
        message: cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar a política de homologação.',
      });
    } finally {
      setSaving(false);
    }
  };

  const approved = record?.resolution.resolutionStatus === 'ready_for_homologation';
  const serverMissing = record?.resolution.missingInputs ?? EMPTY_MISSING;

  return (
    <section
      className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.035] p-4"
      id="fiscal-homologation-policy-workspace"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10">
            <BookOpenCheck className="h-5 w-5 text-violet-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-violet-300">
              Política fiscal · homologação
            </span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Orientação contábil explícita</h4>
            <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              Registre aqui apenas escolhas confirmadas pela orientação contábil da loja. O Kyrub não preenche família do documento, escopo ou gatilho automaticamente.
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase ${
          approved
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
        }`}>
          {approved ? 'Pronta para homologação' : 'Rascunho'}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex min-h-20 items-center justify-center gap-2 text-[9px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando política fiscal...
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {record && (
            <div className="flex flex-wrap gap-2 text-[8px] text-slate-500">
              <span className="rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1">
                Versão {record.resolution.policy.version}
              </span>
              <span className="rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1">
                Ambiente: homologação
              </span>
              <span className="rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1">
                Produção bloqueada
              </span>
            </div>
          )}

          <label className="block text-[8px] font-black uppercase text-slate-500">
            Referência da orientação contábil
            <input
              type="text"
              value={policyReference}
              onChange={event => setPolicyReference(event.target.value)}
              disabled={saving}
              maxLength={160}
              placeholder="Ex.: parecer-contabil-2026-10 ou referência do escritório"
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] normal-case text-white outline-none focus:border-violet-500 disabled:opacity-45"
              id="fiscal-policy-reference"
            />
          </label>

          <label className="block text-[8px] font-black uppercase text-slate-500">
            Vigência indicada
            <input
              type="date"
              value={effectiveFrom}
              onChange={event => setEffectiveFrom(event.target.value)}
              disabled={saving}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-violet-500 disabled:opacity-45"
              id="fiscal-policy-effective-from"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[8px] font-black uppercase text-slate-500">
              Escopo da operação
              <select
                value={operationScope}
                onChange={event => setOperationScope(event.target.value as OperationScope)}
                disabled={saving}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-violet-500 disabled:opacity-45"
                id="fiscal-policy-operation-scope"
              >
                <option value="">Selecione conforme orientação</option>
                <option value="goods">Mercadorias</option>
                <option value="service">Serviços</option>
                <option value="mixed">Operação mista</option>
              </select>
            </label>

            <label className="block text-[8px] font-black uppercase text-slate-500">
              Família do documento
              <select
                value={documentFamily}
                onChange={event => setDocumentFamily(event.target.value as DocumentFamily)}
                disabled={saving}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-violet-500 disabled:opacity-45"
                id="fiscal-policy-document-family"
              >
                <option value="">Selecione conforme orientação</option>
                <option value="nfe">NF-e</option>
                <option value="nfce">NFC-e</option>
                <option value="nfse">NFS-e</option>
              </select>
            </label>

            <label className="block text-[8px] font-black uppercase text-slate-500">
              Gatilho operacional
              <select
                value={operationalTrigger}
                onChange={event => setOperationalTrigger(event.target.value as OperationalTrigger)}
                disabled={saving}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-violet-500 disabled:opacity-45"
                id="fiscal-policy-operational-trigger"
              >
                <option value="">Selecione conforme orientação</option>
                <option value="payment_confirmed">Pagamento confirmado</option>
                <option value="fulfillment_confirmed">Atendimento/entrega confirmado</option>
                <option value="service_completed">Serviço concluído</option>
              </select>
            </label>
          </div>

          {serverMissing.length > 0 && (
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2.5">
              <span className="text-[8px] font-black uppercase text-amber-200">Campos ainda pendentes</span>
              <p className="mt-1 text-[8px] leading-relaxed text-amber-100/80">
                {serverMissing.map(item => MISSING_LABELS[item]).join(' · ')}
              </p>
            </div>
          )}

          {notice && (
            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[9px] leading-relaxed ${
              notice.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-100'
                : 'border-red-500/20 bg-red-500/[0.05] text-red-100'
            }`} role="status">
              {notice.type === 'success'
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{notice.message}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void persist(false)}
              disabled={saving}
              id="save-fiscal-homologation-policy-draft"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-[9px] font-black uppercase text-slate-200 disabled:opacity-45"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={() => void persist(true)}
              disabled={saving}
              id="approve-fiscal-homologation-policy"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 text-[9px] font-black uppercase text-violet-100 disabled:opacity-45"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Aprovar para homologação
            </button>
          </div>

          <p className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2.5 text-[8px] leading-relaxed text-amber-100/80">
            Aprovar aqui não habilita produção, não chama SEFAZ e não emite nota. Esta versão apenas registra, de forma auditável, as escolhas recebidas da orientação contábil para testes de homologação.
          </p>
        </div>
      )}
    </section>
  );
}
