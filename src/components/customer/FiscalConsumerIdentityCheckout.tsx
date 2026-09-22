import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileBadge2, Loader2, ShieldAlert } from 'lucide-react';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
} from '../../utils/brazilFiscalIdentifier';
import {
  loadFiscalConsumerIdentity,
  saveFiscalConsumerIdentity,
  type FiscalConsumerIdentitySelectionResult,
} from '../../utils/fiscalConsumerIdentity';

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
  const [result, setResult] = useState<FiscalConsumerIdentitySelectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTaxIdentifier('');
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

  const handleSave = async (): Promise<void> => {
    if (saving || normalizedOrderIds.length === 0) return;
    const kind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
    if (kind === 'unknown' || !isValidBrazilFiscalTaxIdentifier(taxIdentifier)) {
      setError('Informe um CPF ou CNPJ válido.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const next = await saveFiscalConsumerIdentity({
        storeId,
        orderIds: normalizedOrderIds,
        taxIdentifier,
      });
      setResult(next);
      setTaxIdentifier('');
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
            Documento fiscal do consumidor
          </span>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
            CPF/CNPJ opcional neste momento. Quando informado, será vinculado somente aos pedidos selecionados para este recebimento.
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
              onKeyDown={event => {
                if (event.key === 'Enter' && !saving) void handleSave();
              }}
              placeholder="CPF ou CNPJ"
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-semibold uppercase text-white outline-none focus:border-cyan-400"
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

          <p className="mt-2 text-[8px] leading-relaxed text-slate-600">
            Escopo atual: {normalizedOrderIds.length} pedido(s) selecionado(s). Para corrigir um documento já salvo, informe o novo CPF/CNPJ e vincule novamente.
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
            {result.identity.identifierKind.toUpperCase()} {result.identity.maskedTaxIdentifier} vinculado aos pedidos selecionados.
          </span>
        </div>
      )}

      {!loading && result?.status === 'mixed' && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[8px] leading-relaxed text-amber-100" role="status">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Os pedidos selecionados possuem identificações fiscais diferentes ou incompletas. Vincule um documento para uniformizar somente esta seleção.</span>
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
