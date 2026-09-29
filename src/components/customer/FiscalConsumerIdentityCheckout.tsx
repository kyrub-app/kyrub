import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, FileBadge2, Loader2, ShieldAlert } from 'lucide-react';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
} from '../../utils/brazilFiscalIdentifier';
import {
  loadFiscalConsumerIdentity,
  saveFiscalConsumerIdentity,
  type FiscalConsumerIdentitySelectionResult,
  type FiscalRecipientProfileInput,
} from '../../utils/fiscalConsumerIdentity';

const EMPTY_RECIPIENT: FiscalRecipientProfileInput = {
  name: '',
  stateRegistration: '',
  email: '',
  phone: '',
  address: {
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  },
};

const fieldClass = 'min-h-10 min-w-0 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-cyan-400';

export const FiscalConsumerIdentityCheckout = ({
  storeId,
  orderIds,
}: {
  storeId: string;
  orderIds: string[];
}) => {
  const normalizedOrderIds = useMemo(
    () => Array.from(new Set(orderIds.map(orderId => orderId.trim()).filter(Boolean))).sort(),
    [orderIds.join('|')]
  );
  const scopeKey = `${storeId}:${normalizedOrderIds.join('|')}`;
  const [taxIdentifier, setTaxIdentifier] = useState('');
  const [recipient, setRecipient] = useState<FiscalRecipientProfileInput>(EMPTY_RECIPIENT);
  const [showNfeRecipient, setShowNfeRecipient] = useState(false);
  const [result, setResult] = useState<FiscalConsumerIdentitySelectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTaxIdentifier('');
    setRecipient(EMPTY_RECIPIENT);
    setShowNfeRecipient(false);
    setError('');
    if (!storeId.trim() || normalizedOrderIds.length === 0) {
      setResult(null);
      return () => { cancelled = true; };
    }

    setLoading(true);
    void loadFiscalConsumerIdentity({ storeId, orderIds: normalizedOrderIds })
      .then(next => {
        if (!cancelled) setResult(next);
      })
      .catch(cause => {
        if (!cancelled) {
          setResult(null);
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível consultar o documento fiscal do consumidor.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [scopeKey]);

  const nfeProfileComplete = Boolean(
    recipient.name.trim() &&
    recipient.address.street.trim() &&
    recipient.address.number.trim() &&
    recipient.address.district.trim() &&
    recipient.address.city.trim() &&
    /^[A-Za-z]{2}$/.test(recipient.address.state.trim()) &&
    /^\d{8}$/.test(recipient.address.postalCode.replace(/\D/g, '')) &&
    recipient.address.country.trim()
  );

  const updateRecipient = (key: keyof Omit<FiscalRecipientProfileInput, 'address'>, value: string) =>
    setRecipient(current => ({ ...current, [key]: value }));

  const updateAddress = (key: keyof FiscalRecipientProfileInput['address'], value: string) =>
    setRecipient(current => ({ ...current, address: { ...current.address, [key]: value } }));

  const handleSave = async (): Promise<void> => {
    if (saving || normalizedOrderIds.length === 0) return;
    const kind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
    if (kind === 'unknown' || !isValidBrazilFiscalTaxIdentifier(taxIdentifier)) {
      setError('Informe um CPF ou CNPJ válido.');
      return;
    }
    if (showNfeRecipient && !nfeProfileComplete) {
      setError('Para NF-e, informe nome, logradouro, número, bairro, cidade, UF, CEP e país do destinatário.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const next = await saveFiscalConsumerIdentity({
        storeId,
        orderIds: normalizedOrderIds,
        taxIdentifier,
        ...(showNfeRecipient ? { recipientProfile: recipient } : {}),
      });
      setResult(next);
      setTaxIdentifier('');
      setRecipient(EMPTY_RECIPIENT);
      setShowNfeRecipient(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível salvar o documento fiscal do consumidor.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="staff-checkout-fiscal-consumer-identity"
      className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.045] p-3"
    >
      <div className="flex items-start gap-2.5">
        <FileBadge2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase text-cyan-100">
            Identificação fiscal do destinatário
          </span>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
            CPF/CNPJ continua opcional para o fluxo atual. Dados completos de destinatário só são exigidos quando a operação precisar preparar uma NF-e.
          </p>
        </div>
      </div>

      {normalizedOrderIds.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-700 px-3 py-2 text-[8px] leading-relaxed text-slate-500">
          Selecione ao menos um item da conta para definir quais pedidos receberão a identificação fiscal.
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <input
              id="staff-checkout-consumer-tax-identifier"
              type="text"
              value={taxIdentifier}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              onChange={event => {
                setTaxIdentifier(event.target.value.toUpperCase());
                setError('');
              }}
              placeholder="CPF ou CNPJ"
              className={`${fieldClass} flex-1 font-semibold uppercase`}
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading || !taxIdentifier.trim()}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileBadge2 className="h-3.5 w-3.5" />}
              {saving ? 'Salvando' : 'Vincular'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowNfeRecipient(value => !value);
              setError('');
            }}
            className="mt-2 flex min-h-9 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 text-left text-[8px] font-black uppercase text-slate-400"
          >
            <span>Dados para NF-e</span>
            {showNfeRecipient ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showNfeRecipient && (
            <div className="mt-2 grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-2">
              <input className={`${fieldClass} sm:col-span-2`} value={recipient.name} onChange={event => updateRecipient('name', event.target.value)} placeholder="Nome / razão social" />
              <input className={fieldClass} value={recipient.stateRegistration} onChange={event => updateRecipient('stateRegistration', event.target.value)} placeholder="Inscrição estadual (quando aplicável)" />
              <input className={fieldClass} value={recipient.email} onChange={event => updateRecipient('email', event.target.value)} placeholder="E-mail (opcional)" />
              <input className={fieldClass} value={recipient.phone} onChange={event => updateRecipient('phone', event.target.value)} placeholder="Telefone (opcional)" />
              <input className={fieldClass} value={recipient.address.postalCode} onChange={event => updateAddress('postalCode', event.target.value)} placeholder="CEP" inputMode="numeric" />
              <input className={`${fieldClass} sm:col-span-2`} value={recipient.address.street} onChange={event => updateAddress('street', event.target.value)} placeholder="Logradouro" />
              <input className={fieldClass} value={recipient.address.number} onChange={event => updateAddress('number', event.target.value)} placeholder="Número" />
              <input className={fieldClass} value={recipient.address.complement} onChange={event => updateAddress('complement', event.target.value)} placeholder="Complemento (opcional)" />
              <input className={fieldClass} value={recipient.address.district} onChange={event => updateAddress('district', event.target.value)} placeholder="Bairro" />
              <input className={fieldClass} value={recipient.address.city} onChange={event => updateAddress('city', event.target.value)} placeholder="Município" />
              <input className={fieldClass} value={recipient.address.state} onChange={event => updateAddress('state', event.target.value.toUpperCase())} placeholder="UF" maxLength={2} />
              <input className={fieldClass} value={recipient.address.country} onChange={event => updateAddress('country', event.target.value)} placeholder="País" />
              <p className="sm:col-span-2 text-[8px] leading-relaxed text-slate-600">
                Nenhum dado é inferido. A Inscrição Estadual continua opcional aqui e será validada contra a política fiscal explícita antes de qualquer NF-e em homologação.
              </p>
            </div>
          )}

          <p className="mt-2 text-[8px] leading-relaxed text-slate-600">
            Escopo atual: {normalizedOrderIds.length} pedido(s) selecionado(s). Para corrigir dados já salvos, informe novamente a identificação e vincule.
          </p>
        </>
      )}

      {loading && (
        <div className="mt-2 flex items-center gap-2 text-[8px] text-slate-500" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando identificação fiscal…
        </div>
      )}

      {!loading && result?.status === 'uniform' && result.identity && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[8px] leading-relaxed text-emerald-100" role="status">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {result.identity.identifierKind.toUpperCase()} {result.identity.maskedTaxIdentifier} vinculado. {result.identity.recipientProfileStatus === 'complete_for_nfe' ? 'Dados completos de destinatário registrados para o gate de NF-e.' : 'Dados completos de destinatário ainda não foram registrados.'}
          </span>
        </div>
      )}

      {!loading && result?.status === 'mixed' && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[8px] leading-relaxed text-amber-100" role="status">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Os pedidos selecionados possuem identificações fiscais diferentes ou incompletas. Vincule novamente para uniformizar somente esta seleção.</span>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[8px] leading-relaxed text-red-200" role="alert">
          {error}
        </p>
      )}
    </section>
  );
};