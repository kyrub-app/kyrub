import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Calculator,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

type DocumentFamily = '' | 'nfe' | 'nfce' | 'nfse';
type TriState = '' | 'yes' | 'no';

type GoodsRuleDraft = {
  productId: string;
  cfop: string;
  icmsSituation: string;
  pisSituation: string;
  cofinsSituation: string;
  ibsCbsSituation: string;
  ibsCbsClassification: string;
  explicitTaxFactsText: string;
};

type ServiceRuleDraft = {
  productId: string;
  serviceListCode: string;
  municipalServiceCode: string;
  issRate: string;
  issWithheld: TriState;
  explicitTaxFactsText: string;
};

type TaxScalar = string | number | boolean;

type FiscalTaxExecutionPolicy = {
  schemaVersion: 1;
  policyId: string;
  storeId: string;
  version: number;
  status: 'draft' | 'approved_for_homologation';
  accountingReference: string;
  effectiveFrom: string;
  documentFamily: Exclude<DocumentFamily, ''>;
  operation: Record<string, unknown> & { kind: 'goods_operation' | 'service_operation' };
  goodsRules: Record<string, {
    productId: string;
    cfop: string;
    icmsSituation: string;
    pisSituation: string;
    cofinsSituation: string;
    ibsCbsSituation: string;
    ibsCbsClassification: string;
    explicitTaxFacts: Record<string, TaxScalar>;
  }>;
  serviceRules: Record<string, {
    productId: string;
    serviceListCode: string;
    municipalServiceCode: string;
    issRate: number | null;
    issWithheld: boolean | null;
    explicitTaxFacts: Record<string, TaxScalar>;
  }>;
  environment: 'sandbox';
  authority: 'explicit_accounting_tax_policy_for_homologation';
};

const emptyGoodsRule = (): GoodsRuleDraft => ({
  productId: '',
  cfop: '',
  icmsSituation: '',
  pisSituation: '',
  cofinsSituation: '',
  ibsCbsSituation: '',
  ibsCbsClassification: '',
  explicitTaxFactsText: '',
});

const emptyServiceRule = (): ServiceRuleDraft => ({
  productId: '',
  serviceListCode: '',
  municipalServiceCode: '',
  issRate: '',
  issWithheld: '',
  explicitTaxFactsText: '',
});

const dateInput = (value: string): string =>
  /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';

const prettyFacts = (facts: Record<string, TaxScalar>): string =>
  Object.keys(facts).length > 0 ? JSON.stringify(facts, null, 2) : '';

const parseFacts = (text: string): Record<string, TaxScalar> => {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Os fatos tributários adicionais precisam ser um objeto JSON.');
  }
  const result: Record<string, TaxScalar> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      throw new Error(`Chave tributária inválida: ${key}.`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Valor tributário inválido em ${key}.`);
    }
    result[key] = value;
  }
  return result;
};

const asBoolean = (value: TriState): boolean | null =>
  value === 'yes' ? true : value === 'no' ? false : null;

export default function FiscalTaxExecutionPolicyWorkspace({
  user,
  storeId,
}: {
  user: User;
  storeId: string;
}) {
  const [family, setFamily] = useState<DocumentFamily>('');
  const [accountingReference, setAccountingReference] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [policy, setPolicy] = useState<FiscalTaxExecutionPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [operationNature, setOperationNature] = useState('');
  const [documentDirection, setDocumentDirection] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [purpose, setPurpose] = useState('');
  const [finalConsumer, setFinalConsumer] = useState<TriState>('');
  const [buyerPresence, setBuyerPresence] = useState('');
  const [freightMode, setFreightMode] = useState('');
  const [issuerTaxRegime, setIssuerTaxRegime] = useState('');
  const [recipientIeIndicator, setRecipientIeIndicator] = useState('');

  const [serviceOperationNature, setServiceOperationNature] = useState('');
  const [specialTaxRegime, setSpecialTaxRegime] = useState('');
  const [simplesNacional, setSimplesNacional] = useState<TriState>('');
  const [culturalIncentive, setCulturalIncentive] = useState<TriState>('');

  const [goodsRules, setGoodsRules] = useState<GoodsRuleDraft[]>([]);
  const [serviceRules, setServiceRules] = useState<ServiceRuleDraft[]>([]);

  const resetFields = (): void => {
    setAccountingReference('');
    setEffectiveFrom('');
    setPolicy(null);
    setOperationNature('');
    setDocumentDirection('');
    setDestinationLocation('');
    setPurpose('');
    setFinalConsumer('');
    setBuyerPresence('');
    setFreightMode('');
    setIssuerTaxRegime('');
    setRecipientIeIndicator('');
    setServiceOperationNature('');
    setSpecialTaxRegime('');
    setSimplesNacional('');
    setCulturalIncentive('');
    setGoodsRules([]);
    setServiceRules([]);
  };

  const applyPolicy = (next: FiscalTaxExecutionPolicy | null): void => {
    resetFields();
    setPolicy(next);
    if (!next) return;
    setAccountingReference(next.accountingReference ?? '');
    setEffectiveFrom(dateInput(next.effectiveFrom ?? ''));
    if (next.operation.kind === 'goods_operation') {
      setOperationNature(String(next.operation.operationNature ?? ''));
      setDocumentDirection(String(next.operation.documentDirection ?? ''));
      setDestinationLocation(String(next.operation.destinationLocation ?? ''));
      setPurpose(String(next.operation.purpose ?? ''));
      setFinalConsumer(next.operation.finalConsumer === true ? 'yes' : next.operation.finalConsumer === false ? 'no' : '');
      setBuyerPresence(String(next.operation.buyerPresence ?? ''));
      setFreightMode(String(next.operation.freightMode ?? ''));
      setIssuerTaxRegime(String(next.operation.issuerTaxRegime ?? ''));
      setRecipientIeIndicator(String(next.operation.recipientIeIndicator ?? ''));
      setGoodsRules(Object.values(next.goodsRules ?? {}).map(rule => ({
        productId: rule.productId,
        cfop: rule.cfop,
        icmsSituation: rule.icmsSituation,
        pisSituation: rule.pisSituation,
        cofinsSituation: rule.cofinsSituation,
        ibsCbsSituation: rule.ibsCbsSituation,
        ibsCbsClassification: rule.ibsCbsClassification,
        explicitTaxFactsText: prettyFacts(rule.explicitTaxFacts ?? {}),
      })));
    } else {
      setServiceOperationNature(String(next.operation.serviceOperationNature ?? ''));
      setSpecialTaxRegime(String(next.operation.specialTaxRegime ?? ''));
      setSimplesNacional(next.operation.simplesNacional === true ? 'yes' : next.operation.simplesNacional === false ? 'no' : '');
      setCulturalIncentive(next.operation.culturalIncentive === true ? 'yes' : next.operation.culturalIncentive === false ? 'no' : '');
      setServiceRules(Object.values(next.serviceRules ?? {}).map(rule => ({
        productId: rule.productId,
        serviceListCode: rule.serviceListCode,
        municipalServiceCode: rule.municipalServiceCode,
        issRate: rule.issRate === null ? '' : String(rule.issRate),
        issWithheld: rule.issWithheld === true ? 'yes' : rule.issWithheld === false ? 'no' : '',
        explicitTaxFactsText: prettyFacts(rule.explicitTaxFacts ?? {}),
      })));
    }
  };

  useEffect(() => {
    if (!family) {
      resetFields();
      setNotice(null);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setNotice(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/store-connections/fiscal-tax-policy/${encodeURIComponent(storeId)}/${family}`,
          { method: 'GET', headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }
        );
        const payload = await response.json().catch(() => ({})) as {
          policy?: FiscalTaxExecutionPolicy | null;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || `Não foi possível carregar a política (${response.status}).`);
        if (!cancelled) applyPolicy(payload.policy ?? null);
      } catch (cause) {
        if (!cancelled) {
          resetFields();
          setNotice({
            type: 'error',
            message: cause instanceof Error ? cause.message : 'Não foi possível carregar a política tributária.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [family, storeId, user]);

  const operationReady = useMemo(() => {
    if (!family || !accountingReference.trim() || !effectiveFrom) return false;
    if (family === 'nfse') {
      return Boolean(serviceOperationNature && simplesNacional && culturalIncentive);
    }
    return Boolean(
      operationNature.trim() &&
      documentDirection &&
      destinationLocation &&
      purpose &&
      finalConsumer &&
      buyerPresence &&
      freightMode &&
      issuerTaxRegime
    );
  }, [
    family,
    accountingReference,
    effectiveFrom,
    serviceOperationNature,
    simplesNacional,
    culturalIncentive,
    operationNature,
    documentDirection,
    destinationLocation,
    purpose,
    finalConsumer,
    buyerPresence,
    freightMode,
    issuerTaxRegime,
  ]);

  const persist = async (approveForHomologation: boolean): Promise<void> => {
    if (!family) {
      setNotice({ type: 'error', message: 'Selecione a família fiscal antes de continuar.' });
      return;
    }
    if (!operationReady) {
      setNotice({
        type: 'error',
        message: 'Complete os dados básicos da operação exatamente conforme a orientação fiscal antes de salvar.',
      });
      return;
    }
    if (approveForHomologation && (family === 'nfse' ? serviceRules.length === 0 : goodsRules.length === 0)) {
      setNotice({ type: 'error', message: 'Inclua pelo menos uma regra de produto/serviço antes da aprovação.' });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const goodsPayload: Record<string, unknown> = {};
      for (const rule of goodsRules) {
        if (!rule.productId.trim()) throw new Error('Informe o ID canônico de cada produto configurado.');
        goodsPayload[rule.productId.trim()] = {
          productId: rule.productId.trim(),
          cfop: rule.cfop.trim(),
          icmsSituation: rule.icmsSituation.trim(),
          pisSituation: rule.pisSituation.trim(),
          cofinsSituation: rule.cofinsSituation.trim(),
          ibsCbsSituation: rule.ibsCbsSituation.trim(),
          ibsCbsClassification: rule.ibsCbsClassification.trim(),
          explicitTaxFacts: parseFacts(rule.explicitTaxFactsText),
        };
      }

      const servicePayload: Record<string, unknown> = {};
      for (const rule of serviceRules) {
        if (!rule.productId.trim()) throw new Error('Informe o ID canônico de cada serviço configurado.');
        const parsedRate = rule.issRate.trim() ? Number(rule.issRate) : null;
        if (parsedRate !== null && !Number.isFinite(parsedRate)) throw new Error('A alíquota de ISS informada é inválida.');
        servicePayload[rule.productId.trim()] = {
          productId: rule.productId.trim(),
          serviceListCode: rule.serviceListCode.trim(),
          municipalServiceCode: rule.municipalServiceCode.trim(),
          issRate: parsedRate,
          issWithheld: asBoolean(rule.issWithheld),
          explicitTaxFacts: parseFacts(rule.explicitTaxFactsText),
        };
      }

      const operation = family === 'nfse'
        ? {
            kind: 'service_operation',
            serviceOperationNature,
            specialTaxRegime: specialTaxRegime || null,
            simplesNacional: asBoolean(simplesNacional),
            culturalIncentive: asBoolean(culturalIncentive),
          }
        : {
            kind: 'goods_operation',
            operationNature: operationNature.trim(),
            documentDirection,
            destinationLocation,
            purpose,
            finalConsumer: asBoolean(finalConsumer),
            buyerPresence,
            freightMode,
            issuerTaxRegime,
            recipientIeIndicator: recipientIeIndicator || null,
          };

      const token = await user.getIdToken();
      const response = await fetch(
        `/api/store-connections/fiscal-tax-policy/${encodeURIComponent(storeId)}/${family}`,
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            approveForHomologation,
            accountingReference: accountingReference.trim(),
            effectiveFrom,
            operation,
            goodsRules: goodsPayload,
            serviceRules: servicePayload,
          }),
        }
      );
      const payload = await response.json().catch(() => ({})) as {
        policy?: FiscalTaxExecutionPolicy;
        error?: string;
      };
      if (!response.ok || !payload.policy) {
        throw new Error(payload.error || `Não foi possível salvar a política (${response.status}).`);
      }
      applyPolicy(payload.policy);
      setNotice({
        type: 'success',
        message: approveForHomologation
          ? `Política tributária v${payload.policy.version} aprovada somente para homologação.`
          : `Rascunho tributário v${payload.policy.version} salvo. Nenhuma emissão foi autorizada.`,
      });
    } catch (cause) {
      setNotice({
        type: 'error',
        message: cause instanceof Error ? cause.message : 'Não foi possível salvar a política tributária.',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateGoodsRule = (index: number, patch: Partial<GoodsRuleDraft>): void =>
    setGoodsRules(current => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));

  const updateServiceRule = (index: number, patch: Partial<ServiceRuleDraft>): void =>
    setServiceRules(current => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));

  const approved = policy?.status === 'approved_for_homologation';

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4" id="fiscal-tax-execution-policy-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <Calculator className="h-5 w-5 text-cyan-300" />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-cyan-300">Política tributária · execução</span>
            <h4 className="mt-1 text-sm font-black uppercase text-white">Decisões fiscais explícitas</h4>
            <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-slate-400">
              Registre somente CFOP, CST, regime, IBS/CBS e demais escolhas confirmadas pelo contador ou responsável fiscal. O Kyrub não sugere nem preenche valores tributários automaticamente.
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase ${approved ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>
          {approved ? `Homologação · v${policy?.version}` : policy ? `Rascunho · v${policy.version}` : 'Não configurada'}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-[8px] font-black uppercase text-slate-500">
          Família fiscal
          <select
            id="fiscal-tax-policy-family"
            value={family}
            onChange={event => setFamily(event.target.value as DocumentFamily)}
            disabled={saving || loading}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-cyan-500 disabled:opacity-45"
          >
            <option value="">Selecione sem valor padrão</option>
            <option value="nfce">NFC-e</option>
            <option value="nfe">NF-e</option>
            <option value="nfse">NFS-e</option>
          </select>
        </label>

        {loading && (
          <div className="flex min-h-16 items-center justify-center gap-2 text-[9px] text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando política tributária...
          </div>
        )}

        {family && !loading && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[8px] font-black uppercase text-slate-500">
                Referência contábil/fiscal
                <input id="fiscal-tax-accounting-reference" value={accountingReference} onChange={event => setAccountingReference(event.target.value)} disabled={saving} maxLength={180} placeholder="Ex.: orientação do escritório / parecer interno" className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] normal-case text-white outline-none focus:border-cyan-500 disabled:opacity-45" />
              </label>
              <label className="block text-[8px] font-black uppercase text-slate-500">
                Vigência
                <input id="fiscal-tax-effective-from" type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-cyan-500 disabled:opacity-45" />
              </label>
            </div>

            {family !== 'nfse' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-[8px] font-black uppercase text-slate-500">Natureza da operação<input value={operationNature} onChange={event => setOperationNature(event.target.value)} disabled={saving} placeholder="Conforme orientação fiscal" className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] normal-case text-white outline-none focus:border-cyan-500" /></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Direção<select value={documentDirection} onChange={event => setDocumentDirection(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="outbound">Saída</option><option value="inbound">Entrada</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Destino<select value={destinationLocation} onChange={event => setDestinationLocation(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="internal">Interno</option><option value="interstate">Interestadual</option><option value="foreign">Exterior</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Finalidade<select value={purpose} onChange={event => setPurpose(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="normal">Normal</option><option value="complementary">Complementar</option><option value="adjustment">Ajuste</option><option value="return">Devolução</option><option value="credit">Crédito</option><option value="debit">Débito</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Consumidor final<select value={finalConsumer} onChange={event => setFinalConsumer(event.target.value as TriState)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Presença do comprador<select value={buyerPresence} onChange={event => setBuyerPresence(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="not_applicable">Não se aplica</option><option value="in_person">Presencial</option><option value="internet">Internet</option><option value="telesales">Televendas</option><option value="home_delivery">Entrega em domicílio</option><option value="offsite_in_person">Presencial fora do estabelecimento</option><option value="other_non_in_person">Outra não presencial</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Frete<select value={freightMode} onChange={event => setFreightMode(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="issuer">Por conta do emitente</option><option value="recipient">Por conta do destinatário</option><option value="third_party">Terceiros</option><option value="issuer_own">Transporte próprio emitente</option><option value="recipient_own">Transporte próprio destinatário</option><option value="no_freight">Sem frete</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Regime tributário<select value={issuerTaxRegime} onChange={event => setIssuerTaxRegime(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione conforme orientação</option><option value="simples_nacional">Simples Nacional</option><option value="simples_nacional_excess">Simples — excesso sublimite</option><option value="regime_normal">Regime normal</option><option value="mei">MEI</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">IE do destinatário (opcional)<select value={recipientIeIndicator} onChange={event => setRecipientIeIndicator(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Não informar</option><option value="contributor">Contribuinte</option><option value="exempt">Isento</option><option value="non_contributor">Não contribuinte</option></select></label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-[8px] font-black uppercase text-slate-500">Natureza do serviço<select value={serviceOperationNature} onChange={event => setServiceOperationNature(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="taxed_in_municipality">Tributado no município</option><option value="taxed_outside_municipality">Tributado fora do município</option><option value="exempt">Isento</option><option value="immune">Imune</option><option value="suspended_by_court">Exigibilidade suspensa judicial</option><option value="suspended_by_administration">Exigibilidade suspensa administrativa</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Regime especial (opcional)<select value={specialTaxRegime} onChange={event => setSpecialTaxRegime(event.target.value)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Não informar</option><option value="municipal_microenterprise">Microempresa municipal</option><option value="estimated">Estimativa</option><option value="professional_society">Sociedade de profissionais</option><option value="cooperative">Cooperativa</option><option value="mei_simples">MEI/Simples</option><option value="me_epp_simples">ME/EPP Simples</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Optante Simples Nacional<select value={simplesNacional} onChange={event => setSimplesNacional(event.target.value as TriState)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select></label>
                <label className="block text-[8px] font-black uppercase text-slate-500">Incentivador cultural<select value={culturalIncentive} onChange={event => setCulturalIncentive(event.target.value as TriState)} disabled={saving} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white"><option value="">Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select></label>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[8px] font-black uppercase text-slate-300">Regras por {family === 'nfse' ? 'serviço' : 'produto'}</span>
                  <p className="mt-1 text-[8px] leading-relaxed text-slate-500">Use o ID canônico do item. Nenhum CFOP/CST/classificação é sugerido pelo Kyrub.</p>
                </div>
                <button type="button" onClick={() => family === 'nfse' ? setServiceRules(current => [...current, emptyServiceRule()]) : setGoodsRules(current => [...current, emptyGoodsRule()])} disabled={saving} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 text-[8px] font-black uppercase text-cyan-100"><Plus className="h-3.5 w-3.5" /> Adicionar regra</button>
              </div>

              <div className="mt-3 space-y-3">
                {family !== 'nfse' && goodsRules.map((rule, index) => (
                  <div key={`${index}-${rule.productId}`} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <input aria-label="ID canônico do produto" value={rule.productId} onChange={event => updateGoodsRule(index, { productId: event.target.value })} placeholder="ID canônico do produto" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="CFOP" value={rule.cfop} onChange={event => updateGoodsRule(index, { cfop: event.target.value })} placeholder="CFOP" maxLength={4} inputMode="numeric" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="Situação ICMS" value={rule.icmsSituation} onChange={event => updateGoodsRule(index, { icmsSituation: event.target.value })} placeholder="CST/CSOSN ICMS" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="Situação PIS" value={rule.pisSituation} onChange={event => updateGoodsRule(index, { pisSituation: event.target.value })} placeholder="CST PIS" maxLength={2} inputMode="numeric" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="Situação COFINS" value={rule.cofinsSituation} onChange={event => updateGoodsRule(index, { cofinsSituation: event.target.value })} placeholder="CST COFINS" maxLength={2} inputMode="numeric" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="Situação IBS CBS" value={rule.ibsCbsSituation} onChange={event => updateGoodsRule(index, { ibsCbsSituation: event.target.value })} placeholder="CST IBS/CBS" maxLength={3} inputMode="numeric" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input aria-label="Classificação IBS CBS" value={rule.ibsCbsClassification} onChange={event => updateGoodsRule(index, { ibsCbsClassification: event.target.value })} placeholder="Classificação IBS/CBS" maxLength={6} inputMode="numeric" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <button type="button" onClick={() => setGoodsRules(current => current.filter((_, ruleIndex) => ruleIndex !== index))} className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-500/15 bg-red-500/[0.04] text-[8px] font-black uppercase text-red-200"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                    </div>
                    <textarea aria-label="Fatos tributários adicionais" value={rule.explicitTaxFactsText} onChange={event => updateGoodsRule(index, { explicitTaxFactsText: event.target.value })} placeholder={'Fatos adicionais opcionais em JSON, ex.: {"icms_aliquota": 18}'} className="mt-2 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 font-mono text-[9px] text-white" />
                  </div>
                ))}

                {family === 'nfse' && serviceRules.map((rule, index) => (
                  <div key={`${index}-${rule.productId}`} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <input aria-label="ID canônico do serviço" value={rule.productId} onChange={event => updateServiceRule(index, { productId: event.target.value })} placeholder="ID canônico do serviço" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input value={rule.serviceListCode} onChange={event => updateServiceRule(index, { serviceListCode: event.target.value })} placeholder="Código da lista de serviços" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input value={rule.municipalServiceCode} onChange={event => updateServiceRule(index, { municipalServiceCode: event.target.value })} placeholder="Código municipal do serviço" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <input value={rule.issRate} onChange={event => updateServiceRule(index, { issRate: event.target.value })} placeholder="Alíquota ISS (%) opcional" inputMode="decimal" className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white" />
                      <select value={rule.issWithheld} onChange={event => updateServiceRule(index, { issWithheld: event.target.value as TriState })} className="min-h-10 rounded-lg border border-slate-800 bg-slate-900 px-2 text-[9px] text-white"><option value="">ISS retido? Selecione</option><option value="yes">Sim</option><option value="no">Não</option></select>
                      <button type="button" onClick={() => setServiceRules(current => current.filter((_, ruleIndex) => ruleIndex !== index))} className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-500/15 bg-red-500/[0.04] text-[8px] font-black uppercase text-red-200"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                    </div>
                    <textarea value={rule.explicitTaxFactsText} onChange={event => updateServiceRule(index, { explicitTaxFactsText: event.target.value })} placeholder="Fatos tributários adicionais opcionais em JSON" className="mt-2 min-h-20 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 font-mono text-[9px] text-white" />
                  </div>
                ))}

                {(family === 'nfse' ? serviceRules.length === 0 : goodsRules.length === 0) && (
                  <p className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2 text-[8px] text-amber-100/80">Sem regras de item. É possível manter um rascunho da operação, mas a aprovação para homologação exige ao menos uma regra completa.</p>
                )}
              </div>
            </div>

            {notice && (
              <div role="status" className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[9px] ${notice.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-100' : 'border-red-500/20 bg-red-500/[0.05] text-red-100'}`}>
                {notice.type === 'success' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{notice.message}</span>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" id="save-fiscal-tax-policy-draft" onClick={() => void persist(false)} disabled={saving || !operationReady} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-[9px] font-black uppercase text-slate-200 disabled:opacity-45">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar rascunho</button>
              <button type="button" id="approve-fiscal-tax-policy" onClick={() => void persist(true)} disabled={saving || !operationReady} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-45">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Aprovar para homologação</button>
            </div>

            <p className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2.5 text-[8px] leading-relaxed text-amber-100/80">Esta tela apenas versiona decisões fiscais explícitas. Não chama Focus, SEFAZ ou prefeitura, não emite documento e não habilita produção.</p>
          </>
        )}

        {!family && notice && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-2.5 text-[9px] text-red-100"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{notice.message}</span></div>
        )}
      </div>
    </section>
  );
}
