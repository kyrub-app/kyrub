import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import type { InPersonCatalogProduct } from '../../../shared/inPersonOrder';
import type { ServiceLocation } from '../../../shared/serviceLocation';
import {
  createInPersonOrder,
  loadInPersonOrderCatalog,
} from '../../utils/inPersonOrders';
import { loadServiceLocations } from '../../utils/serviceLocations';

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

interface InPersonOrderComposerProps {
  storeId: string;
  lockedServiceLocationId?: string;
  heading?: string;
  embedded?: boolean;
}

export const InPersonOrderComposer = ({
  storeId,
  lockedServiceLocationId = '',
  heading = 'Novo pedido presencial',
  embedded = false,
}: InPersonOrderComposerProps) => {
  const lockedLocationId = lockedServiceLocationId.trim();
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [products, setProducts] = useState<InPersonCatalogProduct[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const refresh = useCallback(async (silent = false): Promise<void> => {
    if (!storeId) return;
    if (!silent) setLoading(true);
    try {
      const [nextLocations, nextProducts] = await Promise.all([
        loadServiceLocations(storeId, { activeOnly: true }),
        loadInPersonOrderCatalog(storeId),
      ]);
      setLocations(nextLocations);
      setProducts(nextProducts);
      setSelectedLocationId(current => {
        if (lockedLocationId) {
          return nextLocations.some(location => location.id === lockedLocationId)
            ? lockedLocationId
            : '';
        }
        return nextLocations.some(location => location.id === current)
          ? current
          : nextLocations[0]?.id ?? '';
      });
      setErrorMessage(
        lockedLocationId && !nextLocations.some(location => location.id === lockedLocationId)
          ? 'Este local não está mais ativo para novos pedidos.'
          : ''
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar o PDV presencial.'
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, [lockedLocationId, storeId]);

  useEffect(() => {
    void refresh();
    const handleLocationsChanged = () => void refresh(true);
    window.addEventListener('kyrub-service-locations-changed', handleLocationsChanged);
    return () =>
      window.removeEventListener('kyrub-service-locations-changed', handleLocationsChanged);
  }, [refresh]);

  const selectedLocation = useMemo(
    () => locations.find(location => location.id === selectedLocationId) ?? null,
    [locations, selectedLocationId]
  );

  const visibleProducts = useMemo(() => {
    const expected = search.trim().toLocaleLowerCase('pt-BR');
    if (!expected) return products;
    return products.filter(product =>
      product.name.toLocaleLowerCase('pt-BR').includes(expected)
    );
  }, [products, search]);

  const selectedItems = useMemo(
    () => products.flatMap(product => {
      const quantity = quantities[product.id] ?? 0;
      return quantity > 0 ? [{ product, quantity }] : [];
    }),
    [products, quantities]
  );

  const previewTotal = useMemo(
    () => selectedItems.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    ),
    [selectedItems]
  );

  const adjustQuantity = (product: InPersonCatalogProduct, delta: number): void => {
    setQuantities(current => {
      const before = current[product.id] ?? 0;
      const next = Math.max(0, Math.min(999, before + delta));
      if (next === before) return current;
      return { ...current, [product.id]: next };
    });
  };

  const handleCreate = async (): Promise<void> => {
    if (!selectedLocationId || selectedItems.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const order = await createInPersonOrder({
        storeId,
        serviceLocationId: selectedLocationId,
        customerLabel: customerLabel.trim(),
        customerNote: customerNote.trim(),
        items: selectedItems.map(({ product, quantity }) => ({
          productId: product.id,
          quantity,
          note: itemNotes[product.id]?.trim() ?? '',
        })),
      });
      setQuantities({});
      setItemNotes({});
      setCustomerLabel('');
      setCustomerNote('');
      setSuccessMessage(
        `Pedido ${order.id.slice(-8)} criado no PDV e enviado ao fluxo operacional.`
      );
      window.dispatchEvent(
        new CustomEvent('kyrub-in-person-order-created', {
          detail: { orderId: order.id, serviceLocationId: selectedLocationId },
        })
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar o pedido presencial.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      id={embedded ? 'kyrub-service-location-order-composer' : 'kyrub-in-person-order-composer'}
      className={`${embedded ? '' : 'mt-4'} space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-orange-400" />
            <h3 className="text-[11px] font-black uppercase text-white">
              {heading}
            </h3>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            {lockedLocationId
              ? 'O pedido será criado neste local. Nome, preço e identidade do local são reconfirmados pelo servidor antes da gravação.'
              : 'Selecione um local gerenciado e os produtos. Nome, preço e local são reconfirmados pelo servidor antes da gravação; o estoque é decidido pela autoridade operacional ao avançar o pedido.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || submitting}
          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-500 hover:text-white disabled:opacity-50"
          aria-label="Atualizar catálogo do PDV"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300" role="alert">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[9px] text-emerald-200" role="status">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {successMessage}
        </div>
      )}

      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-[9px] leading-relaxed text-slate-500">
          Cadastre e ative ao menos um local em Configurações da Loja → Ambientes antes de abrir um pedido presencial.
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {lockedLocationId ? (
              <div className="space-y-1 text-[8px] font-black uppercase text-slate-500">
                Local do atendimento
                <div
                  id="locked-service-location"
                  className="flex min-h-10 items-center rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 text-[10px] font-bold normal-case text-orange-100"
                >
                  {selectedLocation?.label ?? 'Local indisponível'}
                </div>
              </div>
            ) : (
              <label className="space-y-1 text-[8px] font-black uppercase text-slate-500">
                Local do atendimento
                <select
                  value={selectedLocationId}
                  onChange={event => setSelectedLocationId(event.target.value)}
                  className="min-h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-bold normal-case text-white outline-none"
                >
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>{location.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1 text-[8px] font-black uppercase text-slate-500">
              Identificação local opcional
              <input
                value={customerLabel}
                maxLength={120}
                onChange={event => setCustomerLabel(event.target.value)}
                placeholder="Nome, senha ou referência local"
                className="min-h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] font-medium normal-case text-white outline-none"
              />
            </label>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar produto do catálogo"
              className="min-h-10 w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 text-[10px] text-white outline-none"
            />
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {visibleProducts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-6 text-center text-[9px] text-slate-600">
                Nenhum produto publicado disponível para o PDV.
              </div>
            ) : visibleProducts.map(product => {
              const quantity = quantities[product.id] ?? 0;
              return (
                <article key={product.id} className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[10px] text-white">{product.name}</strong>
                      <div className="mt-1 flex flex-wrap gap-2 text-[8px] text-slate-500">
                        <span>{money(product.price)}</span>
                        <span>{product.isService ? 'Serviço' : `Estoque exibido: ${product.stock}`}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
                      <button
                        type="button"
                        onClick={() => adjustQuantity(product, -1)}
                        disabled={quantity === 0 || submitting}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                        aria-label={`Remover ${product.name}`}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-6 text-center text-[10px] font-black text-white">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => adjustQuantity(product, 1)}
                        disabled={submitting || quantity >= 999}
                        className="rounded-lg p-1.5 text-orange-300 hover:text-orange-200 disabled:opacity-30"
                        aria-label={`Adicionar ${product.name}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {quantity > 0 && (
                    <input
                      value={itemNotes[product.id] ?? ''}
                      maxLength={240}
                      onChange={event => setItemNotes(current => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))}
                      placeholder="Observação deste item (opcional)"
                      className="mt-2 min-h-9 w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 text-[9px] text-white outline-none"
                    />
                  )}
                </article>
              );
            })}
          </div>

          <textarea
            value={customerNote}
            maxLength={500}
            onChange={event => setCustomerNote(event.target.value)}
            placeholder="Observação geral do pedido (opcional)"
            className="min-h-16 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-white outline-none"
          />

          <div className="flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong className="text-sm text-white">{money(previewTotal)}</strong>
              <p className="text-[8px] text-slate-600">
                Prévia local. O servidor recalcula o total com o preço canônico antes de salvar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting || !selectedLocationId || selectedItems.length === 0}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-[9px] font-black uppercase text-white disabled:bg-slate-800 disabled:text-slate-600"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Criar pedido
            </button>
          </div>

          <p className="text-[8px] leading-relaxed text-slate-600">
            O pedido nasce pendente e não confirma pagamento, emissão fiscal, identidade do cliente ou pontos. O avanço de status continua no fluxo operacional existente.
          </p>
        </>
      )}
    </section>
  );
};
