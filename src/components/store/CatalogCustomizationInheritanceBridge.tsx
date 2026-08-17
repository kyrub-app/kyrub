import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Layers3, Save } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { OptionInventoryImpactRecord } from '../../../shared/optionInventoryImpact';
import type { ProductOptionGroup } from '../../types';
import {
  parseCatalogCustomizationDefaults,
  resolveCatalogCustomization,
  type CatalogCustomizationDefaults,
} from '../../utils/catalogCustomizationInheritance';
import { saveCatalogCustomizationDefaults } from '../../utils/catalogCustomizationStore';
import {
  joinCatalogCategoryPath,
  normalizeCatalogCategoryValue,
} from '../../utils/catalogCategoryTree';
import { auth, db } from '../../utils/firebase';
import {
  getProductInventoryDocumentPath,
  readProductInventorySettings,
  type InventoryCatalogItem,
} from '../../utils/productInventory';
import { readOptionInventoryImpacts } from '../../utils/productOptionInventory';
import { parseProductQuickNotes } from '../../utils/productCustomization';
import { OptionInventoryImpactEditor } from './OptionInventoryImpactEditor';
import {
  buildProductOptionGroups,
  ProductOptionGroupsEditor,
  productOptionGroupsToDrafts,
  type ProductOptionGroupDraft,
} from './ProductOptionGroupsEditor';
import { ProductQuickNotesEditor } from './ProductQuickNotesEditor';

const normalizePath = (value: string): string =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => normalizeCatalogCategoryValue(segment))
    .filter(Boolean)
    .join(' > ');

const readHierarchyPaths = (): string[] => {
  const root = document.querySelector<HTMLSelectElement>(
    '#product-store-category-select'
  )?.value.trim() ?? '';
  if (!root) return [];

  const levelSelects = Array.from(
    document.querySelectorAll<HTMLSelectElement>(
      '#product-category-hierarchy-levels select'
    )
  );
  const selected = levelSelects.map(select => select.value.trim()).filter(Boolean);
  const paths: string[] = [];
  if (selected[0]) paths.push(joinCatalogCategoryPath([root, selected[0]]));
  if (selected[0] && selected[1]) {
    paths.push(joinCatalogCategoryPath([root, selected[0], selected[1]]));
  }
  return paths;
};

const exactDefaultsFor = (
  defaults: CatalogCustomizationDefaults[],
  path: string
): CatalogCustomizationDefaults | null => {
  const key = normalizePath(path);
  return defaults.find(entry => normalizePath(entry.path) === key) ?? null;
};

export function CatalogCustomizationInheritanceBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [defaults, setDefaults] = useState<CatalogCustomizationDefaults[]>([]);
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryCatalogItem[]>([]);
  const [inventoryImpacts, setInventoryImpacts] = useState<
    OptionInventoryImpactRecord[]
  >([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [targetPath, setTargetPath] = useState('');
  const [quickNotes, setQuickNotes] = useState<string[]>([]);
  const [optionGroups, setOptionGroups] = useState<ProductOptionGroupDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let unsubscribeTenant = () => undefined;
    let unsubscribeInventory = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTenant();
      unsubscribeInventory();
      unsubscribeTenant = () => undefined;
      unsubscribeInventory = () => undefined;
      setDefaults([]);
      setInventoryCatalog([]);
      setInventoryImpacts([]);
      if (!user) return;

      unsubscribeTenant = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          setDefaults(
            parseCatalogCustomizationDefaults(
              snapshot.data()?.catalogCustomizationDefaults
            )
          );
        },
        error => {
          console.warn('Padrões herdáveis do catálogo indisponíveis.', error);
        }
      );

      unsubscribeInventory = onSnapshot(
        doc(db, getProductInventoryDocumentPath(user.uid)),
        snapshot => {
          setInventoryCatalog(readProductInventorySettings(snapshot.data()).catalog);
          setInventoryImpacts(readOptionInventoryImpacts(snapshot.data()));
        },
        error => {
          console.warn('Impactos privados das opções indisponíveis.', error);
          setInventoryCatalog([]);
          setInventoryImpacts([]);
        }
      );
    });
    return () => {
      unsubscribeAuth();
      unsubscribeTenant();
      unsubscribeInventory();
    };
  }, []);

  useEffect(() => {
    let mountedHost: HTMLDivElement | null = null;
    const synchronize = (): void => {
      const hierarchy = document.getElementById('product-category-hierarchy-control');
      if (!(hierarchy instanceof HTMLElement)) {
        mountedHost?.remove();
        mountedHost = null;
        setHost(null);
        setPaths([]);
        return;
      }

      if (!mountedHost?.isConnected) {
        mountedHost = document.createElement('div');
        mountedHost.id = 'catalog-customization-inheritance-host';
        hierarchy.insertAdjacentElement('afterend', mountedHost);
        setHost(mountedHost);
      }

      const nextPaths = readHierarchyPaths();
      setPaths(current =>
        JSON.stringify(current) === JSON.stringify(nextPaths) ? current : nextPaths
      );
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value'],
    });
    document.addEventListener('change', synchronize, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('change', synchronize, true);
      mountedHost?.remove();
    };
  }, []);

  useEffect(() => {
    const nextTarget = paths.at(-1) ?? '';
    setTargetPath(nextTarget);
  }, [paths]);

  useEffect(() => {
    if (!targetPath) {
      setQuickNotes([]);
      setOptionGroups([]);
      return;
    }
    const exact = exactDefaultsFor(defaults, targetPath);
    setQuickNotes(parseProductQuickNotes(exact?.quickNotes));
    setOptionGroups(productOptionGroupsToDrafts(exact?.optionGroups));
    setMessage('');
  }, [defaults, targetPath]);

  const inheritedBeforeTarget = useMemo(() => {
    if (!targetPath) return { quickNotes: [], optionGroups: [] as ProductOptionGroup[] };
    const ancestors = defaults.filter(entry => {
      const entryKey = normalizePath(entry.path);
      const targetKey = normalizePath(targetPath);
      return entryKey !== targetKey && targetKey.startsWith(`${entryKey} > `);
    });
    return resolveCatalogCustomization(
      { category: targetPath, quickNotes: [], optionGroups: [] },
      ancestors
    );
  }, [defaults, targetPath]);

  if (!host) return null;

  const handleSave = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user || !targetPath) return;
    setIsSaving(true);
    setMessage('');
    try {
      const parsedGroups = buildProductOptionGroups(optionGroups);
      await saveCatalogCustomizationDefaults(user, targetPath, {
        quickNotes,
        optionGroups: parsedGroups,
      });
      setMessage('Padrões salvos. Produtos deste caminho herdarão essas opções.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Não foi possível salvar os padrões.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <section
      className="space-y-4 rounded-2xl border border-teal-500/20 bg-teal-500/[0.04] p-4"
      id="catalog-customization-inheritance-control"
    >
      <div>
        <h4 className="flex items-center gap-2 font-mono text-xs uppercase text-slate-300">
          <Layers3 className="h-4 w-4 text-teal-400" />
          Padrões herdados do catálogo
        </h4>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Configure uma vez no Grupo ou Subgrupo. O produto herda essas opções e ainda pode ter personalizações próprias.
        </p>
      </div>

      {paths.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-[10px] text-slate-600">
          Selecione ao menos um Grupo para configurar padrões herdáveis.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Níveis configuráveis">
            {paths.map(path => (
              <button
                key={path}
                type="button"
                onClick={() => setTargetPath(path)}
                className={`min-h-9 rounded-xl border px-3 text-[9px] font-black uppercase ${
                  normalizePath(path) === normalizePath(targetPath)
                    ? 'border-teal-400/50 bg-teal-500/15 text-teal-200'
                    : 'border-slate-800 bg-slate-950 text-slate-500'
                }`}
              >
                {path.split(' > ').at(-1)}
              </button>
            ))}
          </div>

          {inheritedBeforeTarget.quickNotes.length > 0 ||
          inheritedBeforeTarget.optionGroups.length > 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-3">
              <span className="flex items-center gap-1.5 text-[9px] font-black uppercase text-slate-400">
                <Check className="h-3.5 w-3.5 text-teal-400" />
                Já herdado do nível anterior
              </span>
              {inheritedBeforeTarget.quickNotes.length > 0 && (
                <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                  Observações: {inheritedBeforeTarget.quickNotes.join(' · ')}
                </p>
              )}
              {inheritedBeforeTarget.optionGroups.length > 0 && (
                <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                  Opções: {inheritedBeforeTarget.optionGroups.map(group => group.name).join(' · ')}
                </p>
              )}
            </div>
          ) : null}

          <ProductQuickNotesEditor
            value={quickNotes}
            onChange={setQuickNotes}
            disabled={isSaving}
          />
          <ProductOptionGroupsEditor
            value={optionGroups}
            onChange={setOptionGroups}
            disabled={isSaving}
          />
          <OptionInventoryImpactEditor
            path={targetPath}
            groups={optionGroups}
            inventoryCatalog={inventoryCatalog}
            impacts={inventoryImpacts}
            onImpactsChange={setInventoryImpacts}
            disabled={isSaving}
          />

          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[9px] text-slate-500">
              Editando padrões de <strong className="text-slate-300">{targetPath}</strong>.
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !targetPath}
              className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-teal-500 px-3 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
              id="save-catalog-customization-defaults"
            >
              <Save className="h-4 w-4" />
              Salvar padrões
            </button>
          </div>
        </>
      )}

      {message && (
        <p className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[9px] text-slate-300">
          {message}
        </p>
      )}
    </section>,
    host
  );
}
