import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  CircleDollarSign,
  ImagePlus,
  Save,
  ShoppingCart,
  Store,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import type {
  Product,
  ProductCategoryCollection,
} from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  joinCatalogCategoryPath,
  mergeCatalogCategoryPaths,
  parseCatalogCategoryPaths,
  splitCatalogCategoryPath,
} from '../../utils/catalogCategoryTree';
import {
  buildPublicProduct,
  parsePublicProducts,
  type PublicProduct,
} from '../../utils/publicProducts';
import { parseProductQuickNotes } from '../../utils/productCustomization';
import {
  EMPTY_PRODUCT_COMPOSITION,
  calculateProductAvailableStock,
  getProductInventoryDocumentPath,
  persistProductInventorySettings,
  readProductInventorySettings,
  type InventoryCatalogItem,
  type ProductComposition,
} from '../../utils/productInventory';
import { CatalogHierarchySelector } from './CatalogHierarchySelector';
import {
  buildProductOptionGroups,
  ProductOptionGroupsEditor,
  productOptionGroupsToDrafts,
  type ProductOptionGroupDraft,
} from './ProductOptionGroupsEditor';
import { ProductInventoryCompositionEditor } from './ProductInventoryCompositionEditor';
import { ProductPurchaseList } from './ProductPurchaseList';
import { ProductQuickNotesEditor } from './ProductQuickNotesEditor';

export type ProductModalMode = 'create' | 'edit';
type ProductModalTab = 'showcase' | 'inventory' | 'purchase';

export interface UnifiedProductModalProps {
  isOpen: boolean;
  mode: ProductModalMode;
  product: Product | null;
  products: Product[];
  keywords: string[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}

const categoryCollectionsForPath = (
  paths: ProductCategoryCollection[],
  products: Product[],
  categoryPath: string
): ProductCategoryCollection[] => {
  const segments = splitCatalogCategoryPath(categoryPath);
  if (segments.length <= 1) return [];

  const imageByPath = new Map<string, string>();
  for (const collection of paths) {
    imageByPath.set(
      collection.path.toLocaleLowerCase('pt-BR'),
      collection.image.trim()
    );
  }
  for (const candidate of products) {
    for (const collection of candidate.categoryCollections ?? []) {
      const key = collection.path.toLocaleLowerCase('pt-BR');
      if (!imageByPath.get(key) && collection.image.trim()) {
        imageByPath.set(key, collection.image.trim());
      }
    }
  }

  return segments.slice(1).map((name, index) => {
    const path = joinCatalogCategoryPath(segments.slice(0, index + 2));
    return {
      path,
      name,
      image: imageByPath.get(path.toLocaleLowerCase('pt-BR')) ?? '',
    };
  });
};

const sanitizeEditedProduct = (
  product: Product,
  patch: Omit<Product, 'id'> & { id?: string }
): Product => {
  const next: Product = {
    ...product,
    ...patch,
    id: product.id,
  };

  if (!next.categoryCollections?.length) delete next.categoryCollections;
  if (!next.optionGroups?.length) delete next.optionGroups;
  if (!next.quickNotes?.length) delete next.quickNotes;
  delete next.selectedOptions;
  delete next.selectedQuickNotes;
  delete next.customizationSummary;
  delete next.sourceProductId;
  return next;
};

const copyComposition = (
  composition: ProductComposition
): ProductComposition => ({
  ...composition,
  lines: composition.lines.map(line => ({ ...line })),
});

const TAB_OPTIONS: Array<{
  id: ProductModalTab;
  label: string;
  description: string;
  icon: typeof Store;
}> = [
  {
    id: 'showcase',
    label: 'Itens da vitrine',
    description: 'Informações públicas e personalização',
    icon: Store,
  },
  {
    id: 'inventory',
    label: 'Estoque',
    description: 'Componentes, ficha técnica e combinações',
    icon: Warehouse,
  },
  {
    id: 'purchase',
    label: 'Lista de compras',
    description: 'Reposição calculada pelo estoque mínimo',
    icon: ShoppingCart,
  },
];

export const UnifiedProductModal: React.FC<UnifiedProductModalProps> = ({
  isOpen,
  mode,
  product,
  products,
  keywords,
  isSaving,
  onClose,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<ProductModalTab>('showcase');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryRoot, setCategoryRoot] = useState('');
  const [hierarchySegments, setHierarchySegments] = useState<string[]>([]);
  const [catalogPaths, setCatalogPaths] = useState<ProductCategoryCollection[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(products);
  const [image, setImage] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [isService, setIsService] = useState(false);
  const [isComplimentary, setIsComplimentary] = useState(false);
  const [quickNotes, setQuickNotes] = useState<string[]>([]);
  const [optionGroups, setOptionGroups] = useState<ProductOptionGroupDraft[]>([]);
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryCatalogItem[]>([]);
  const [composition, setComposition] = useState<ProductComposition>({
    ...EMPTY_PRODUCT_COMPOSITION,
    lines: [],
  });
  const [initialInventoryCatalog, setInitialInventoryCatalog] = useState<InventoryCatalogItem[]>([]);
  const [initialComposition, setInitialComposition] = useState<ProductComposition>({
    ...EMPTY_PRODUCT_COMPOSITION,
    lines: [],
  });
  const [inventoryDirty, setInventoryDirty] = useState(false);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventoryLoadError, setInventoryLoadError] = useState('');
  const [formError, setFormError] = useState('');

  const fullCategoryPath = useMemo(
    () => joinCatalogCategoryPath([categoryRoot, ...hierarchySegments]),
    [categoryRoot, hierarchySegments]
  );
  const calculatedStock = useMemo(
    () => calculateProductAvailableStock(inventoryCatalog, composition),
    [composition, inventoryCatalog]
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('showcase');
    setInventoryDirty(false);
    setInventoryLoaded(false);
    setInventoryLoadError('');
    setInventoryCatalog([]);
    setInitialInventoryCatalog([]);
    setComposition({ ...EMPTY_PRODUCT_COMPOSITION, lines: [] });
    setInitialComposition({ ...EMPTY_PRODUCT_COMPOSITION, lines: [] });

    if (mode === 'edit' && product) {
      const segments = splitCatalogCategoryPath(product.category);
      setName(product.name);
      setDescription(product.description);
      setPrice(String(product.price));
      setCategoryRoot(segments[0] ?? '');
      setHierarchySegments(segments.slice(1, 5));
      setImage(product.image);
      setImageFileName('');
      setIsService(product.isService === true);
      setIsComplimentary(product.isComplimentary === true);
      setQuickNotes(parseProductQuickNotes(product.quickNotes));
      setOptionGroups(productOptionGroupsToDrafts(product.optionGroups));
    } else {
      setName('');
      setDescription('');
      setPrice('');
      setCategoryRoot('');
      setHierarchySegments([]);
      setImage('');
      setImageFileName('');
      setIsService(false);
      setIsComplimentary(false);
      setQuickNotes([]);
      setOptionGroups([]);
    }
    setFormError('');
    setCatalogProducts(products);
    setCatalogPaths(
      mergeCatalogCategoryPaths([], products as PublicProduct[])
    );
  }, [isOpen, mode, product, products]);

  useEffect(() => {
    if (!isOpen) return;

    let unsubscribeTenant = () => undefined;
    let unsubscribeInventory = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeTenant();
      unsubscribeInventory();
      unsubscribeTenant = () => undefined;
      unsubscribeInventory = () => undefined;
      if (!user) return;

      unsubscribeTenant = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          const tenantData = snapshot.data();
          const cloudProducts = parsePublicProducts(tenantData?.publicProducts);
          const nextProducts = cloudProducts.length > 0 ? cloudProducts : products;
          setCatalogProducts(nextProducts);
          setCatalogPaths(
            mergeCatalogCategoryPaths(
              parseCatalogCategoryPaths(tenantData?.catalogCategoryPaths),
              cloudProducts
            )
          );
        },
        error => {
          console.warn('Não foi possível carregar a hierarquia do catálogo.', error);
        }
      );

      unsubscribeInventory = onSnapshot(
        doc(db, getProductInventoryDocumentPath(user.uid)),
        snapshot => {
          const inventorySettings = readProductInventorySettings(snapshot.data());
          const storedComposition = product?.id
            ? inventorySettings.compositions[product.id]
              ?? { ...EMPTY_PRODUCT_COMPOSITION, lines: [] }
            : { ...EMPTY_PRODUCT_COMPOSITION, lines: [] };

          if (!inventoryDirty) {
            const nextCatalog = inventorySettings.catalog.map(item => ({ ...item }));
            const nextComposition = copyComposition(storedComposition);
            setInventoryCatalog(nextCatalog);
            setInitialInventoryCatalog(nextCatalog.map(item => ({ ...item })));
            setComposition(nextComposition);
            setInitialComposition(copyComposition(nextComposition));
          }
          setInventoryLoaded(true);
          setInventoryLoadError('');
        },
        error => {
          console.warn('Não foi possível carregar o estoque privado da loja.', error);
          setInventoryLoaded(true);
          setInventoryLoadError(
            'O estoque privado está indisponível. Os dados públicos ainda podem ser salvos, mas composição e compras não serão alteradas.'
          );
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTenant();
      unsubscribeInventory();
    };
  }, [inventoryDirty, isOpen, product?.id, products]);

  if (!isOpen) return null;

  const updateInventoryCatalog = (nextCatalog: InventoryCatalogItem[]): void => {
    setInventoryCatalog(nextCatalog);
    setInventoryDirty(true);
  };

  const updateComposition = (nextComposition: ProductComposition): void => {
    setComposition(nextComposition);
    setInventoryDirty(true);
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError('');

    const user = auth.currentUser;
    if (!user) {
      setFormError('Faça login novamente para salvar este item.');
      return;
    }
    if (!categoryRoot.trim()) {
      setActiveTab('showcase');
      setFormError(
        keywords.length === 0
          ? 'Cadastre ao menos uma palavra-chave em Configurações da loja → Perfil.'
          : 'Selecione a categoria da loja.'
      );
      return;
    }
    if (composition.lines.some(line => line.quantity <= 0)) {
      setActiveTab('inventory');
      setFormError(
        'Revise a composição: todos os componentes precisam ter quantidade maior que zero.'
      );
      return;
    }

    try {
      const parsedOptionGroups = buildProductOptionGroups(optionGroups);
      const parsedQuickNotes = parseProductQuickNotes(quickNotes);
      const categoryCollections = categoryCollectionsForPath(
        catalogPaths,
        catalogProducts,
        fullCategoryPath
      );
      const nextStock = isService
        ? 0
        : calculatedStock
          ?? (mode === 'edit' && product ? product.stock : 0);

      let nextProduct: Product;
      if (mode === 'create') {
        nextProduct = buildPublicProduct(user, {
          name,
          description,
          price: isComplimentary ? '0' : price,
          stock: String(nextStock),
          category: fullCategoryPath,
          categoryCollections,
          optionGroups: parsedOptionGroups,
          quickNotes: parsedQuickNotes,
          image,
          isService,
          isComplimentary,
        });
      } else {
        if (!product) {
          throw new Error('O item não foi identificado para edição.');
        }

        const parsedPrice = isComplimentary
          ? 0
          : Number.parseFloat(price.replace(',', '.'));
        if (!name.trim()) throw new Error('Informe o nome do item.');
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
          throw new Error('Informe um preço válido.');
        }

        nextProduct = sanitizeEditedProduct(product, {
          ...product,
          name: name.trim(),
          description: description.trim(),
          price: parsedPrice,
          stock: nextStock,
          category: fullCategoryPath,
          categoryCollections,
          optionGroups: parsedOptionGroups,
          quickNotes: parsedQuickNotes,
          image: image.trim(),
          isService,
          isComplimentary,
        });
      }

      let privateInventoryPersisted = false;
      if (!inventoryLoadError && inventoryLoaded) {
        await persistProductInventorySettings(
          user,
          nextProduct.id,
          inventoryCatalog,
          composition
        );
        privateInventoryPersisted = true;
      }

      try {
        await onSave(nextProduct);
      } catch (saveError) {
        if (privateInventoryPersisted) {
          void persistProductInventorySettings(
            user,
            nextProduct.id,
            initialInventoryCatalog,
            initialComposition
          ).catch(rollbackError => {
            console.error(
              'Não foi possível reverter a composição após a falha do item.',
              rollbackError
            );
          });
        }
        throw saveError;
      }
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar este item.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[135] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5"
      id="unified-product-modal"
    >
      <section className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
              Catálogo, estoque e compras
            </span>
            <h3 className="mt-1 text-xl font-black text-white">
              {mode === 'create' ? 'Cadastrar novo item' : 'Editar item'}
            </h3>
            <p className="mt-1 text-[10px] text-slate-500">
              A vitrine é pública; composição, insumos e reposição permanecem privados na loja.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
            aria-label="Fechar produto"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav
          className="mt-5 grid gap-2 sm:grid-cols-3"
          aria-label="Áreas do item"
          id="unified-product-modal-tabs"
        >
          {TAB_OPTIONS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-2xl border p-3 text-left transition ${
                  active
                    ? 'border-orange-500/45 bg-orange-500/10'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-2 text-[10px] font-black uppercase text-white">
                  <Icon className={`h-4 w-4 ${active ? 'text-orange-300' : 'text-slate-500'}`} />
                  {tab.label}
                </span>
                <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">
                  {tab.description}
                </span>
              </button>
            );
          })}
        </nav>

        <form onSubmit={event => void handleSubmit(event)} className="mt-5 space-y-4">
          {activeTab === 'showcase' && (
            <div className="space-y-4" id="product-showcase-tab">
              <div>
                <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                  Nome do item
                </label>
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  disabled={isSaving}
                  placeholder="Nome do produto ou serviço"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500 disabled:opacity-45"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                    Preço de venda
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={isComplimentary ? '0' : price}
                    onChange={event => setPrice(event.target.value)}
                    disabled={isSaving || isComplimentary}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500 disabled:opacity-45"
                  />
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5">
                  <span className="block font-mono text-xs uppercase text-slate-400">
                    Estoque vendável
                  </span>
                  <strong className="mt-1 block text-sm text-cyan-300">
                    {isService
                      ? 'Serviço · não se aplica'
                      : calculatedStock === null
                        ? `${mode === 'edit' && product ? product.stock : 0} un. · sem composição`
                        : `${calculatedStock} un. · calculado`}
                  </strong>
                </div>
              </div>

              <CatalogHierarchySelector
                keywords={keywords}
                categoryRoot={categoryRoot}
                onCategoryRootChange={setCategoryRoot}
                selectedSegments={hierarchySegments}
                onSelectedSegmentsChange={setHierarchySegments}
                paths={catalogPaths}
                products={catalogProducts}
                onCatalogDataChange={(nextPaths, nextProducts) => {
                  setCatalogPaths(nextPaths);
                  if (nextProducts) setCatalogProducts(nextProducts);
                }}
                disabled={isSaving}
              />

              <section
                className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
                id="product-drive-image-control"
              >
                <span className="flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
                  <ImagePlus className="h-4 w-4 text-teal-400" />
                  Imagem do item
                </span>
                {image && (
                  <img
                    src={image}
                    alt="Prévia do item"
                    className="h-40 w-full rounded-2xl border border-slate-800 object-cover"
                    referrerPolicy="no-referrer"
                  />
                )}
                <input
                  type="url"
                  value={image}
                  onChange={event => {
                    setImage(event.target.value);
                    setImageFileName('');
                  }}
                  disabled={isSaving}
                  placeholder="URL externa da imagem"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
                />
                <div className="flex flex-wrap gap-2">
                  <GooglePhotosImagePickerButton
                    label="Galeria"
                    onSelect={selection => {
                      setImage(selection.url);
                      setImageFileName(selection.fileName);
                    }}
                  />
                  <GoogleDriveImagePickerButton
                    label="Drive"
                    onSelect={selection => {
                      setImage(selection.url);
                      setImageFileName(selection.fileName);
                    }}
                  />
                  {image && (
                    <button
                      type="button"
                      onClick={() => {
                        setImage('');
                        setImageFileName('');
                      }}
                      disabled={isSaving}
                      className="flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-300 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-slate-500">
                  {imageFileName
                    ? `Arquivo: ${imageFileName}`
                    : 'Escolha uma imagem da galeria, do Drive ou informe uma URL externa.'}
                </p>
              </section>

              <div>
                <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                  Descrição
                </label>
                <textarea
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  disabled={isSaving}
                  rows={3}
                  placeholder="Descreva o item com suas próprias informações"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white outline-none focus:border-orange-500 disabled:opacity-45"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <input
                    type="checkbox"
                    checked={isService}
                    onChange={event => setIsService(event.target.checked)}
                    disabled={isSaving}
                    className="mt-0.5 accent-teal-500"
                  />
                  <span className="text-[10px] text-slate-400">
                    Este item é um serviço.
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${
                    isComplimentary
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                  id="product-complimentary-control"
                >
                  <input
                    type="checkbox"
                    checked={isComplimentary}
                    onChange={event => {
                      setIsComplimentary(event.target.checked);
                      if (event.target.checked) setPrice('0');
                    }}
                    disabled={isSaving}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400">
                    <CircleDollarSign className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />
                    Item sem custo para reposições, rodízios ou brindes.
                  </span>
                </label>
              </div>

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
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="space-y-4" id="product-inventory-tab">
              {inventoryLoadError && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                  {inventoryLoadError}
                </p>
              )}
              {!inventoryLoaded && (
                <p className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-[10px] text-slate-500">
                  Carregando o estoque privado da loja…
                </p>
              )}
              <ProductInventoryCompositionEditor
                catalog={inventoryCatalog}
                composition={composition}
                onCatalogChange={updateInventoryCatalog}
                onCompositionChange={updateComposition}
                disabled={isSaving || !inventoryLoaded || Boolean(inventoryLoadError)}
              />
            </div>
          )}

          {activeTab === 'purchase' && (
            <ProductPurchaseList catalog={inventoryCatalog} />
          )}

          {formError && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <footer className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-[10px] font-black uppercase text-slate-950 disabled:opacity-40"
              id="save-unified-product-button"
            >
              <Save className="h-4 w-4" />
              {isSaving
                ? 'Salvando...'
                : mode === 'create'
                  ? 'Cadastrar item'
                  : 'Salvar item'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
