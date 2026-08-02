import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileCheck2, Info, LoaderCircle, ReceiptText } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import type { Product } from '../../types';
import { auth, db } from '../../utils/firebase';
import { getProductInventoryDocumentPath } from '../../utils/productInventory';
import {
  FISCAL_UNITS,
  GOODS_ORIGIN_CODES,
  createEmptyProductFiscalProfile,
  readProductFiscalProfile,
  type ProductFiscalEditorState,
  type ProductFiscalKind,
  type ProductFiscalProfile,
} from '../../utils/productFiscal';

interface ProductFiscalFieldsBridgeProps {
  isOpen: boolean;
  product: Product | null;
  isSaving: boolean;
  onStateChange: (state: ProductFiscalEditorState) => void;
}

const ORIGIN_LABELS: Record<(typeof GOODS_ORIGIN_CODES)[number], string> = {
  '0': 'Nacional',
  '1': 'Estrangeira · importação direta',
  '2': 'Estrangeira · mercado interno',
  '3': 'Nacional · conteúdo importado acima de 40% e até 70%',
  '4': 'Nacional · processo produtivo básico',
  '5': 'Nacional · conteúdo importado até 40%',
  '6': 'Estrangeira · importação direta, sem similar nacional',
  '7': 'Estrangeira · mercado interno, sem similar nacional',
  '8': 'Nacional · conteúdo importado acima de 70%',
};

const onlyDigits = (value: string, maxLength: number): string =>
  value.replace(/\D/g, '').slice(0, maxLength);

const fiscalKindFromProduct = (product: Product | null): ProductFiscalKind =>
  product?.isService === true ? 'service' : 'goods';

export function ProductFiscalFieldsBridge({
  isOpen,
  product,
  isSaving,
  onStateChange,
}: ProductFiscalFieldsBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<ProductFiscalProfile>(() =>
    createEmptyProductFiscalProfile(fiscalKindFromProduct(product))
  );
  const [initialProfile, setInitialProfile] =
    useState<ProductFiscalProfile | null>(null);
  const serviceCheckboxRef = useRef<HTMLInputElement | null>(null);
  const serviceCheckboxHandlerRef = useRef<EventListener | null>(null);

  useEffect(() => {
    onStateChange({ ready, draft, initialProfile });
  }, [draft, initialProfile, onStateChange, ready]);

  useEffect(() => {
    if (!isOpen) {
      setHost(null);
      setReady(false);
      return;
    }

    const fallbackKind = fiscalKindFromProduct(product);
    let cancelled = false;
    let authResolved = false;
    setReady(false);
    setInitialProfile(null);
    setDraft(createEmptyProductFiscalProfile(fallbackKind));

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (authResolved || cancelled) return;
      authResolved = true;

      if (!user || !product?.id) {
        setReady(true);
        return;
      }

      void getDoc(doc(db, getProductInventoryDocumentPath(user.uid)))
        .then(snapshot => {
          if (cancelled) return;
          const stored = readProductFiscalProfile(
            snapshot.data(),
            product.id,
            fallbackKind
          );
          setInitialProfile(stored);
          setDraft(
            stored
              ? { ...stored, kind: fallbackKind }
              : createEmptyProductFiscalProfile(fallbackKind)
          );
          setReady(true);
        })
        .catch(error => {
          console.warn('Não foi possível carregar os dados fiscais do item.', error);
          if (cancelled) return;
          setReady(true);
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isOpen, product?.id, product?.isService]);

  useEffect(() => {
    if (!isOpen) return;

    const unbindServiceCheckbox = () => {
      if (serviceCheckboxRef.current && serviceCheckboxHandlerRef.current) {
        serviceCheckboxRef.current.removeEventListener(
          'change',
          serviceCheckboxHandlerRef.current
        );
      }
      serviceCheckboxRef.current = null;
      serviceCheckboxHandlerRef.current = null;
    };

    const decorate = () => {
      const modal = document.getElementById('unified-product-modal');
      const showcase = modal?.querySelector<HTMLElement>('#product-showcase-tab');
      if (!modal || !showcase) {
        setHost(current => (current?.isConnected ? current : null));
        return;
      }

      let nextHost = showcase.querySelector<HTMLElement>(
        '[data-kyrub-product-fiscal-host]'
      );
      if (!nextHost) {
        nextHost = document.createElement('div');
        nextHost.dataset.kyrubProductFiscalHost = 'true';
        showcase.appendChild(nextHost);
      }
      setHost(current => (current === nextHost ? current : nextHost));

      const serviceLabel = Array.from(
        showcase.querySelectorAll<HTMLLabelElement>('label')
      ).find(label => label.textContent?.includes('Este item é um serviço'));
      const serviceCheckbox = serviceLabel?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );

      if (serviceCheckbox && serviceCheckbox !== serviceCheckboxRef.current) {
        unbindServiceCheckbox();
        const handler: EventListener = () => {
          const kind: ProductFiscalKind = serviceCheckbox.checked
            ? 'service'
            : 'goods';
          setDraft(current => ({ ...current, kind }));
        };
        serviceCheckbox.addEventListener('change', handler);
        serviceCheckboxRef.current = serviceCheckbox;
        serviceCheckboxHandlerRef.current = handler;
        setDraft(current => ({
          ...current,
          kind: serviceCheckbox.checked ? 'service' : 'goods',
        }));
      }
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      unbindServiceCheckbox();
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-product-fiscal-host]')
        .forEach(element => element.remove());
    };
  }, [isOpen]);

  const update = <Key extends keyof ProductFiscalProfile>(
    key: Key,
    value: ProductFiscalProfile[Key]
  ) => setDraft(current => ({ ...current, [key]: value }));

  const fieldClass =
    'w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-base text-white outline-none focus:border-cyan-500 disabled:opacity-45 sm:text-xs';

  if (!host) return null;

  return createPortal(
    <details
      id="product-fiscal-data-section"
      className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-cyan-500/5"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
          <ReceiptText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[10px] font-black uppercase tracking-wide text-cyan-200">
            Dados fiscais e nota
          </strong>
          <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
            Classificação privada para preparar NF-e, NFC-e ou NFS-e no futuro.
          </span>
        </span>
        <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${
          draft.enabled
            ? 'bg-emerald-500/15 text-emerald-300'
            : 'bg-slate-800 text-slate-400'
        }`}>
          {ready ? (draft.enabled ? 'Configurado' : 'Opcional') : 'Carregando'}
        </span>
      </summary>

      <div className="space-y-4 border-t border-cyan-500/15 p-4">
        {!ready ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-[10px] text-slate-400">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Carregando a classificação fiscal deste item…
          </div>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={event => update('enabled', event.target.checked)}
                disabled={isSaving}
                className="mt-0.5 h-4 w-4 accent-cyan-500"
              />
              <span>
                <strong className="block text-[10px] font-black uppercase text-slate-200">
                  Preparar este item para emissão fiscal
                </strong>
                <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">
                  O cadastro não emite nota sozinho. Ele guarda os dados necessários para uma futura integração fiscal.
                </span>
              </span>
            </label>

            {draft.enabled && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                    Descrição fiscal
                  </label>
                  <input
                    value={draft.fiscalDescription}
                    onChange={event =>
                      update(
                        'fiscalDescription',
                        event.target.value.slice(0, 200)
                      )
                    }
                    disabled={isSaving}
                    placeholder="Descrição objetiva usada no documento fiscal"
                    className={fieldClass}
                  />
                </div>

                {draft.kind === 'goods' ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                          NCM · 8 dígitos
                        </label>
                        <input
                          value={draft.ncm}
                          onChange={event =>
                            update('ncm', onlyDigits(event.target.value, 8))
                          }
                          disabled={isSaving}
                          inputMode="numeric"
                          placeholder="00000000"
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                          CEST · quando aplicável
                        </label>
                        <input
                          value={draft.cest}
                          onChange={event =>
                            update('cest', onlyDigits(event.target.value, 7))
                          }
                          disabled={isSaving}
                          inputMode="numeric"
                          placeholder="0000000"
                          className={fieldClass}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                        Origem da mercadoria
                      </label>
                      <select
                        value={draft.origin}
                        onChange={event =>
                          update(
                            'origin',
                            event.target.value as ProductFiscalProfile['origin']
                          )
                        }
                        disabled={isSaving}
                        className={fieldClass}
                      >
                        {GOODS_ORIGIN_CODES.map(code => (
                          <option key={code} value={code}>
                            {code} · {ORIGIN_LABELS[code]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                      <label className="flex cursor-pointer items-center gap-2 text-[10px] font-black uppercase text-slate-300">
                        <input
                          type="checkbox"
                          checked={draft.noGtin}
                          onChange={event =>
                            update('noGtin', event.target.checked)
                          }
                          disabled={isSaving}
                          className="h-4 w-4 accent-cyan-500"
                        />
                        Este item não possui GTIN/EAN
                      </label>
                      {!draft.noGtin && (
                        <input
                          value={draft.gtin}
                          onChange={event =>
                            update('gtin', onlyDigits(event.target.value, 14))
                          }
                          disabled={isSaving}
                          inputMode="numeric"
                          placeholder="Código de barras com 8, 12, 13 ou 14 dígitos"
                          className={`${fieldClass} mt-3`}
                        />
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                          Unidade comercial
                        </label>
                        <select
                          value={draft.commercialUnit}
                          onChange={event =>
                            update(
                              'commercialUnit',
                              event.target
                                .value as ProductFiscalProfile['commercialUnit']
                            )
                          }
                          disabled={isSaving}
                          className={fieldClass}
                        >
                          {FISCAL_UNITS.map(unit => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                          Unidade tributável
                        </label>
                        <select
                          value={draft.taxUnit}
                          onChange={event =>
                            update(
                              'taxUnit',
                              event.target.value as ProductFiscalProfile['taxUnit']
                            )
                          }
                          disabled={isSaving}
                          className={fieldClass}
                        >
                          {FISCAL_UNITS.map(unit => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                          Fator de conversão
                        </label>
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={draft.conversionFactor}
                          onChange={event =>
                            update(
                              'conversionFactor',
                              Number(event.target.value)
                            )
                          }
                          disabled={isSaving}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                        Item da lista de serviços
                      </label>
                      <input
                        value={draft.serviceListCode}
                        onChange={event =>
                          update(
                            'serviceListCode',
                            event.target.value.slice(0, 20)
                          )
                        }
                        disabled={isSaving}
                        placeholder="Ex.: 01.01"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                        Código municipal do serviço
                      </label>
                      <input
                        value={draft.municipalServiceCode}
                        onChange={event =>
                          update(
                            'municipalServiceCode',
                            event.target.value.slice(0, 30)
                          )
                        }
                        disabled={isSaving}
                        placeholder="Conforme a prefeitura"
                        className={fieldClass}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block font-mono text-[10px] uppercase text-slate-400">
                        NBS · opcional
                      </label>
                      <input
                        value={draft.nbs}
                        onChange={event =>
                          update('nbs', event.target.value.slice(0, 20))
                        }
                        disabled={isSaving}
                        placeholder="Preencha apenas quando a integração exigir"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-100">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>
                    O Kyrub valida formato, mas não escolhe NCM, CEST ou código
                    de serviço por conta própria. A classificação deve ser
                    confirmada pelo responsável fiscal da loja.
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[9px] text-emerald-300">
                  <FileCheck2 className="h-4 w-4" />
                  Estes dados ficam privados e não aparecem na vitrine pública.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </details>,
    host
  );
}
