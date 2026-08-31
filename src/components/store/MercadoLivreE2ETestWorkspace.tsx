import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { CheckCircle2, CircleAlert, ExternalLink, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  authorizeMercadoLivreE2EPublication,
  authorizeMercadoLivreE2EStock,
  configureMercadoLivreE2ERequirements,
  createMercadoLivreE2EAvailabilitySnapshot,
  executeMercadoLivreE2EPublication,
  executeMercadoLivreE2EStock,
  inspectMercadoLivreE2ERequirements,
  loadMercadoLivreE2ECategoryOptions,
  loadMercadoLivreE2EEligibleProducts,
  proposeMercadoLivreE2EPublication,
  proposeMercadoLivreE2EStock,
  reconcileMercadoLivreE2EPublication,
  reconcileMercadoLivreE2EStock,
  setMercadoLivreE2EAvailabilityPolicy,
  validateMercadoLivreE2EConditionalRequirements,
  validateMercadoLivreE2EListing,
  type MercadoLivreAttributeInput,
  type MercadoLivreCategorySuggestion,
  type MercadoLivreE2ECategoryOptions,
  type MercadoLivreE2EEligibleProduct,
} from '../../utils/mercadoLivreE2ETest';

const money = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const errorText = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;

export default function MercadoLivreE2ETestWorkspace({
  user,
  storeId,
  connectionId,
  notify,
}: {
  user: User;
  storeId: string;
  connectionId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [products, setProducts] = useState<MercadoLivreE2EEligibleProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [proposalId, setProposalId] = useState('');
  const [suggestions, setSuggestions] = useState<MercadoLivreCategorySuggestion[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [options, setOptions] = useState<MercadoLivreE2ECategoryOptions | null>(null);
  const [listingTypeId, setListingTypeId] = useState('');
  const [condition, setCondition] = useState('');
  const [attributeValues, setAttributeValues] = useState<Record<string, { valueId?: string; valueName?: string }>>({});
  const [publicationReady, setPublicationReady] = useState(false);
  const [publicationAuthorization, setPublicationAuthorization] = useState<{ id: string; token: string } | null>(null);
  const [publicationExecution, setPublicationExecution] = useState<{ id: string; bindingId: string; externalItemId: string; permalink?: string } | null>(null);
  const [publicationReconciled, setPublicationReconciled] = useState(false);

  const [bindingId, setBindingId] = useState('');
  const [externalItemId, setExternalItemId] = useState('');
  const [policyEnabledChoice, setPolicyEnabledChoice] = useState('');
  const [safetyStock, setSafetyStock] = useState('');
  const [allocationCap, setAllocationCap] = useState('');
  const [policySaved, setPolicySaved] = useState(false);
  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<{ id: string; publishableUnits: number; availableToPromiseUnits: number } | null>(null);
  const [stockProposal, setStockProposal] = useState<{ id: string; status: string; target: number; observed: number | null; blockedReason: string } | null>(null);
  const [stockAuthorization, setStockAuthorization] = useState<{ id: string; token: string } | null>(null);
  const [stockExecutionId, setStockExecutionId] = useState('');
  const [stockReconciled, setStockReconciled] = useState(false);

  const selectedProduct = useMemo(
    () => products.find(product => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const resetFlow = (product?: MercadoLivreE2EEligibleProduct | null): void => {
    setProposalId('');
    setSuggestions([]);
    setCategoryId('');
    setOptions(null);
    setListingTypeId('');
    setCondition('');
    setAttributeValues({});
    setPublicationReady(false);
    setPublicationAuthorization(null);
    setPublicationExecution(null);
    setPublicationReconciled(false);
    setBindingId(product?.activeBindingId ?? '');
    setExternalItemId(product?.externalItemId ?? '');
    setPolicyEnabledChoice('');
    setSafetyStock('');
    setAllocationCap('');
    setPolicySaved(false);
    setAvailabilitySnapshot(null);
    setStockProposal(null);
    setStockAuthorization(null);
    setStockExecutionId('');
    setStockReconciled(false);
    setMessage('');
  };

  const loadProducts = async (): Promise<void> => {
    setLoadingProducts(true);
    setMessage('');
    try {
      const result = await loadMercadoLivreE2EEligibleProducts(user, storeId);
      setProducts(result.items);
      setSelectedProductId(previous => result.items.some(item => item.id === previous) ? previous : '');
      if (!result.items.length) setMessage('Nenhum produto canônico elegível para publicação externa foi encontrado.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível listar os produtos elegíveis.'));
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => { void loadProducts(); }, [storeId, user.uid]);

  const preparePublication = async (): Promise<void> => {
    if (!selectedProduct) return;
    setBusy(true);
    setMessage('');
    try {
      const proposal = await proposeMercadoLivreE2EPublication(user, storeId, connectionId, selectedProduct.id);
      const inspection = await inspectMercadoLivreE2ERequirements(user, storeId, proposal.id);
      setProposalId(proposal.id);
      setSuggestions(inspection.categorySuggestions);
      setMessage('Proposta criada sem publicar nada. Escolha uma das categorias sugeridas oficialmente pelo Mercado Livre.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível preparar a publicação.'));
    } finally {
      setBusy(false);
    }
  };

  const chooseCategory = async (nextCategoryId: string): Promise<void> => {
    setCategoryId(nextCategoryId);
    setOptions(null);
    setListingTypeId('');
    setCondition('');
    setAttributeValues({});
    setPublicationReady(false);
    setPublicationAuthorization(null);
    if (!nextCategoryId || !proposalId) return;
    setBusy(true);
    try {
      const result = await loadMercadoLivreE2ECategoryOptions(user, storeId, proposalId, nextCategoryId);
      setOptions(result);
      setMessage('Opções oficiais carregadas. Preencha apenas os campos necessários para esta categoria.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível carregar as opções da categoria.'));
    } finally {
      setBusy(false);
    }
  };

  const visibleAttributes = useMemo(() => {
    if (!options) return [];
    return options.attributes.filter(attribute =>
      attribute.required || attribute.conditionalRequired || (condition === 'new' && attribute.newRequired)
    );
  }, [options, condition]);

  const setAttribute = (id: string, value: { valueId?: string; valueName?: string }): void => {
    setAttributeValues(previous => ({ ...previous, [id]: value }));
    setPublicationReady(false);
    setPublicationAuthorization(null);
  };

  const validatePublication = async (): Promise<void> => {
    if (!proposalId || !categoryId || !listingTypeId || !condition) {
      setMessage('Escolha categoria, tipo de anúncio e condição antes de validar.');
      return;
    }
    const attributes: MercadoLivreAttributeInput[] = Object.entries(attributeValues).flatMap(([id, value]) =>
      value.valueId || value.valueName ? [{ id, ...value }] : []
    );
    setBusy(true);
    setMessage('');
    setPublicationReady(false);
    setPublicationAuthorization(null);
    try {
      const configured = await configureMercadoLivreE2ERequirements(user, storeId, proposalId, {
        categoryId,
        listingTypeId,
        condition,
        attributes,
      });
      if (configured.missingRequiredAttributeIds.length) {
        setMessage(`Ainda faltam atributos obrigatórios: ${configured.missingRequiredAttributeIds.join(', ')}.`);
        return;
      }
      if (configured.conditionalAttributeIds.length) {
        await validateMercadoLivreE2EConditionalRequirements(user, storeId, proposalId);
      }
      const validation = await validateMercadoLivreE2EListing(user, storeId, proposalId);
      if (validation.publicationReadiness !== 'ready_for_owner_authorization') {
        const causes = validation.causes.map(cause => cause.message || cause.code).filter(Boolean).join(' · ');
        setMessage(causes ? `O Mercado Livre pediu correções: ${causes}` : 'O anúncio ainda precisa de correções antes de publicar.');
        return;
      }
      setPublicationReady(true);
      setMessage('Validação concluída sem criar anúncio. O próximo estágio exige uma autorização explícita sua.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível validar o anúncio.'));
    } finally {
      setBusy(false);
    }
  };

  const authorizePublication = async (): Promise<void> => {
    if (!proposalId || !publicationReady) return;
    setBusy(true);
    try {
      const result = await authorizeMercadoLivreE2EPublication(user, storeId, proposalId);
      setPublicationAuthorization({ id: result.authorizationId, token: result.authorizationToken });
      setMessage('Autorização one-time criada. Ela ainda não publicou nada. Use “Publicar agora” somente quando quiser criar o anúncio real.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível autorizar a publicação.'));
    } finally {
      setBusy(false);
    }
  };

  const publishNow = async (): Promise<void> => {
    if (!publicationAuthorization) return;
    setBusy(true);
    try {
      const result = await executeMercadoLivreE2EPublication(
        user, storeId, publicationAuthorization.id, publicationAuthorization.token
      );
      setPublicationAuthorization(null);
      setPublicationExecution({
        id: result.executionId,
        bindingId: result.bindingId,
        externalItemId: result.externalItemId,
        permalink: result.permalink,
      });
      setBindingId(result.bindingId);
      setExternalItemId(result.externalItemId);
      setMessage(`Anúncio criado no Mercado Livre (${result.externalItemId}). Agora confirme o resultado por GET autoritativo.`);
      notify('Anúncio real criado no Mercado Livre. Falta reconciliar a evidência.', 'success');
    } catch (error) {
      setPublicationAuthorization(null);
      setMessage(errorText(error, 'A execução ficou sem confirmação segura. Use o fluxo de reconciliação.'));
    } finally {
      setBusy(false);
    }
  };

  const reconcilePublication = async (): Promise<void> => {
    if (!publicationExecution) return;
    setBusy(true);
    try {
      const result = await reconcileMercadoLivreE2EPublication(user, storeId, publicationExecution.id);
      setBindingId(result.bindingId);
      setExternalItemId(result.externalItemId);
      setPublicationReconciled(true);
      setMessage('Publicação reconciliada com o GET autoritativo do Mercado Livre. O binding está pronto para o teste de estoque.');
    } catch (error) {
      setMessage(errorText(error, 'Ainda não foi possível reconciliar a publicação.'));
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async (): Promise<void> => {
    if (!selectedProduct || !policyEnabledChoice || safetyStock.trim() === '') {
      setMessage('Defina explicitamente se o canal ficará habilitado e qual será o estoque de segurança.');
      return;
    }
    const safety = Number(safetyStock);
    const cap = allocationCap.trim() === '' ? null : Number(allocationCap);
    if (!Number.isSafeInteger(safety) || safety < 0 || (cap !== null && (!Number.isSafeInteger(cap) || cap < 0))) {
      setMessage('Estoque de segurança e teto precisam ser números inteiros não negativos.');
      return;
    }
    setBusy(true);
    try {
      await setMercadoLivreE2EAvailabilityPolicy(user, selectedProduct.canonicalStoreId, {
        enabled: policyEnabledChoice === 'enabled',
        safetyStockUnits: safety,
        allocationCapUnits: cap,
      });
      setPolicySaved(true);
      setAvailabilitySnapshot(null);
      setStockProposal(null);
      setMessage('Política salva. Ela define a projeção do canal; não altera o estoque físico.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível salvar a política de disponibilidade.'));
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = async (): Promise<void> => {
    if (!selectedProduct || !policySaved) return;
    setBusy(true);
    try {
      const result = await createMercadoLivreE2EAvailabilitySnapshot(user, selectedProduct.canonicalStoreId, selectedProduct.id);
      setAvailabilitySnapshot({
        id: result.snapshotId,
        publishableUnits: result.publishableUnits,
        availableToPromiseUnits: result.availableToPromiseUnits,
      });
      setStockProposal(null);
      setMessage(`Snapshot congelado: ATP ${result.availableToPromiseUnits}; publicável no Mercado Livre ${result.publishableUnits}.`);
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível calcular a disponibilidade do canal.'));
    } finally {
      setBusy(false);
    }
  };

  const proposeStock = async (): Promise<void> => {
    if (!availabilitySnapshot || !bindingId) return;
    setBusy(true);
    try {
      const result = await proposeMercadoLivreE2EStock(user, storeId, bindingId, availabilitySnapshot.id);
      setStockProposal({
        id: result.id,
        status: result.status,
        target: result.targetAvailableQuantity,
        observed: result.observedAvailableQuantity,
        blockedReason: result.blockedReason,
      });
      setMessage(result.status === 'no_changes'
        ? 'O Mercado Livre já expõe a quantidade projetada. Nenhum PUT é necessário.'
        : result.status === 'blocked_provider_stock_mode'
          ? `Atualização bloqueada com segurança: ${result.blockedReason}.`
          : 'Proposta de estoque criada. Ainda não houve PUT no Mercado Livre.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível criar a proposta de estoque.'));
    } finally {
      setBusy(false);
    }
  };

  const authorizeStock = async (): Promise<void> => {
    if (!stockProposal || stockProposal.status !== 'review_required') return;
    setBusy(true);
    try {
      const result = await authorizeMercadoLivreE2EStock(user, storeId, stockProposal.id);
      setStockAuthorization({ id: result.authorizationId, token: result.authorizationToken });
      setMessage('Autorização one-time de estoque criada. Ela ainda não alterou o Mercado Livre.');
    } catch (error) {
      setMessage(errorText(error, 'Não foi possível autorizar a atualização de estoque.'));
    } finally {
      setBusy(false);
    }
  };

  const updateStockNow = async (): Promise<void> => {
    if (!stockAuthorization) return;
    setBusy(true);
    try {
      const result = await executeMercadoLivreE2EStock(user, storeId, stockAuthorization.id, stockAuthorization.token);
      setStockAuthorization(null);
      setStockExecutionId(result.executionId);
      setMessage(`PUT executado uma vez. Alvo enviado: ${result.targetAvailableQuantity}. Agora confirme por GET autoritativo.`);
    } catch (error) {
      setStockAuthorization(null);
      setMessage(errorText(error, 'A escrita de estoque ficou sem confirmação segura. Reconcilie antes de qualquer nova tentativa.'));
    } finally {
      setBusy(false);
    }
  };

  const reconcileStock = async (): Promise<void> => {
    if (!stockExecutionId) return;
    setBusy(true);
    try {
      const result = await reconcileMercadoLivreE2EStock(user, storeId, stockExecutionId);
      setStockReconciled(true);
      setMessage(`Estoque reconciliado: Mercado Livre confirmou ${result.observedAvailableQuantity} unidade(s). E2E concluído.`);
      notify('E2E Mercado Livre concluído com publicação e estoque reconciliados.', 'success');
    } catch (error) {
      setMessage(errorText(error, 'O estoque ainda não foi confirmado pelo Mercado Livre.'));
    } finally {
      setBusy(false);
    }
  };

  const stockStageAvailable = Boolean(selectedProduct && bindingId && (selectedProduct.activeBindingId || publicationReconciled));

  return (
    <section className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">Bancada controlada</span>
          <h4 className="mt-1 text-sm font-black text-white">Teste E2E Mercado Livre</h4>
          <p className="mt-2 max-w-3xl text-[10px] leading-relaxed text-slate-400">
            Prepare e valide tudo sem escrever no canal. Os dois writes reais — criar anúncio e alterar estoque — aparecem como ações separadas e exigem autorização one-time.
          </p>
        </div>
        <button type="button" onClick={() => void loadProducts()} disabled={loadingProducts || busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loadingProducts ? 'animate-spin' : ''}`} /> Atualizar produtos
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="text-[10px] font-bold text-slate-400">
          Produto Kyrub elegível
          <select
            value={selectedProductId}
            onChange={event => {
              const id = event.target.value;
              const product = products.find(item => item.id === id) ?? null;
              setSelectedProductId(id);
              resetFlow(product);
            }}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"
          >
            <option value="">Selecione…</option>
            {products.map(product => (
              <option key={product.id} value={product.id}>
                {product.name} · {money(product.price)} · estoque {product.stock}{product.activeBindingId ? ' · já vinculado' : ''}
              </option>
            ))}
          </select>
        </label>

        {selectedProduct && !selectedProduct.activeBindingId && !bindingId && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">1. Publicação</p>
            {!proposalId && (
              <button type="button" onClick={() => void preparePublication()} disabled={busy} className="mt-3 rounded-xl bg-cyan-300 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50">
                Preparar publicação
              </button>
            )}

            {proposalId && (
              <div className="mt-3 grid gap-3">
                <label className="text-[10px] font-bold text-slate-400">
                  Categoria sugerida pelo Mercado Livre
                  <select value={categoryId} onChange={event => void chooseCategory(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
                    <option value="">Selecione…</option>
                    {suggestions.map(item => <option key={item.categoryId} value={item.categoryId}>{item.categoryName}</option>)}
                  </select>
                </label>

                {options && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[10px] font-bold text-slate-400">Tipo de anúncio
                        <select value={listingTypeId} onChange={event => { setListingTypeId(event.target.value); setPublicationReady(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
                          <option value="">Selecione…</option>
                          {options.listingTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] font-bold text-slate-400">Condição
                        <select value={condition} onChange={event => { setCondition(event.target.value); setPublicationReady(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
                          <option value="">Selecione…</option>
                          {options.conditions.map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </label>
                    </div>

                    {visibleAttributes.map(attribute => (
                      <label key={attribute.id} className="text-[10px] font-bold text-slate-400">
                        {attribute.name}{attribute.conditionalRequired ? ' · validação condicional' : ' · obrigatório'}
                        {attribute.values.length ? (
                          <select
                            value={attributeValues[attribute.id]?.valueId ?? ''}
                            onChange={event => {
                              const chosen = attribute.values.find(value => value.id === event.target.value);
                              setAttribute(attribute.id, chosen ? { valueId: chosen.id, valueName: chosen.name } : {});
                            }}
                            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                          >
                            <option value="">Selecione…</option>
                            {attribute.values.map(value => <option key={`${attribute.id}:${value.id}`} value={value.id}>{value.name}</option>)}
                          </select>
                        ) : (
                          <input
                            value={attributeValues[attribute.id]?.valueName ?? ''}
                            onChange={event => setAttribute(attribute.id, { valueName: event.target.value })}
                            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                          />
                        )}
                      </label>
                    ))}

                    <button type="button" onClick={() => void validatePublication()} disabled={busy} className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-[10px] font-black uppercase text-cyan-200 disabled:opacity-50">
                      Validar com Mercado Livre
                    </button>
                  </>
                )}

                {publicationReady && !publicationAuthorization && !publicationExecution && (
                  <button type="button" onClick={() => void authorizePublication()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[10px] font-black uppercase text-amber-200 disabled:opacity-50">
                    <ShieldCheck className="h-3.5 w-3.5" /> Autorizar publicação real
                  </button>
                )}

                {publicationAuthorization && (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
                    <p className="text-[10px] font-bold leading-relaxed text-rose-200">A próxima ação cria um anúncio REAL no Mercado Livre.</p>
                    <button type="button" onClick={() => void publishNow()} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-400 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50">
                      <Play className="h-3.5 w-3.5" /> Publicar agora
                    </button>
                  </div>
                )}

                {publicationExecution && !publicationReconciled && (
                  <button type="button" onClick={() => void reconcilePublication()} disabled={busy} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[10px] font-black uppercase text-emerald-200 disabled:opacity-50">
                    Confirmar anúncio no Mercado Livre
                  </button>
                )}
                {publicationExecution?.permalink && (
                  <a href={publicationExecution.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300">
                    Abrir anúncio <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {stockStageAvailable && selectedProduct && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">2. Estoque</p>
                <p className="mt-1 text-[9px] text-slate-600">Binding {bindingId.slice(0, 16)}… {externalItemId ? `· ${externalItemId}` : ''}</p>
              </div>
              {stockReconciled && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-[10px] font-bold text-slate-400">Canal habilitado?
                <select value={policyEnabledChoice} onChange={event => { setPolicyEnabledChoice(event.target.value); setPolicySaved(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
                  <option value="">Escolha…</option>
                  <option value="enabled">Sim</option>
                  <option value="disabled">Não</option>
                </select>
              </label>
              <label className="text-[10px] font-bold text-slate-400">Estoque de segurança
                <input type="number" min="0" step="1" value={safetyStock} onChange={event => { setSafetyStock(event.target.value); setPolicySaved(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" placeholder="Ex.: 2" />
              </label>
              <label className="text-[10px] font-bold text-slate-400">Teto do canal (opcional)
                <input type="number" min="0" step="1" value={allocationCap} onChange={event => { setAllocationCap(event.target.value); setPolicySaved(false); }} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" placeholder="Sem teto" />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void savePolicy()} disabled={busy} className="rounded-xl border border-slate-700 px-3 py-2 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50">Salvar política</button>
              <button type="button" onClick={() => void createSnapshot()} disabled={busy || !policySaved} className="rounded-xl border border-cyan-500/30 px-3 py-2 text-[9px] font-black uppercase text-cyan-200 disabled:opacity-40">Calcular snapshot</button>
              <button type="button" onClick={() => void proposeStock()} disabled={busy || !availabilitySnapshot} className="rounded-xl border border-cyan-500/30 px-3 py-2 text-[9px] font-black uppercase text-cyan-200 disabled:opacity-40">Preparar atualização</button>
            </div>

            {availabilitySnapshot && (
              <p className="mt-3 text-[10px] text-slate-400">ATP: <strong className="text-white">{availabilitySnapshot.availableToPromiseUnits}</strong> · Publicável: <strong className="text-white">{availabilitySnapshot.publishableUnits}</strong></p>
            )}
            {stockProposal && (
              <p className="mt-2 text-[10px] text-slate-400">ML observado: {stockProposal.observed ?? '—'} · alvo: {stockProposal.target} · status: {stockProposal.status}</p>
            )}

            {stockProposal?.status === 'review_required' && !stockAuthorization && !stockExecutionId && (
              <button type="button" onClick={() => void authorizeStock()} disabled={busy} className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[10px] font-black uppercase text-amber-200 disabled:opacity-50">Autorizar alteração real de estoque</button>
            )}

            {stockAuthorization && (
              <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
                <p className="text-[10px] font-bold leading-relaxed text-rose-200">A próxima ação faz um PUT REAL de available_quantity no anúncio.</p>
                <button type="button" onClick={() => void updateStockNow()} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-400 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Alterar estoque agora</button>
              </div>
            )}

            {stockExecutionId && !stockReconciled && (
              <button type="button" onClick={() => void reconcileStock()} disabled={busy} className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[10px] font-black uppercase text-emerald-200 disabled:opacity-50">Confirmar estoque no Mercado Livre</button>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" /> {message}
        </div>
      )}
    </section>
  );
}
