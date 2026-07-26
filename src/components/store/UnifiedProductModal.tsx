import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  CircleDollarSign,
  ImagePlus,
  Save,
  Trash2,
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
import { CatalogHierarchySelector } from './CatalogHierarchySelector';
import {
  buildProductOptionGroups,
  ProductOptionGroupsEditor,
  productOptionGroupsToDrafts,
  type ProductOptionGroupDraft,
} from './ProductOptionGroupsEditor';
import { ProductQuickNotesEditor } from './ProductQuickNotesEditor';

export type ProductModalMode = 'create' | 'edit';

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
    imageByPath.set(collection.path.toLocaleLowerCase('pt-BR'), collection.image.trim());
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
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
  const [formError, setFormError] = useState('');

  const fullCategoryPath = useMemo(
    () => joinCatalogCategoryPath([categoryRoot, ...hierarchySegments]),
    [categoryRoot, hierarchySegments]
  );

  useEffect(() => {
    if (!isOpen) return;

    if (mode === 'edit' && product) {
      const segments = splitCatalogCategoryPath(product.category);
      setName(product.name);
      setDescription(product.description);
      setPrice(String(product.price));
      setStock(product.isService ? '' : String(product.stock));
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
      setStock('');
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

    let unsubscribeStore = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeStore();
      unsubscribeStore = () => undefined;
      if (!user) return;

      unsubscribeStore = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          const cloudProducts = parsePublicProducts(snapshot.data()?.publicProducts);
          const nextProducts = cloudProducts.length > 0 ? cloudProducts : products;
          setCatalogProducts(nextProducts);
          setCatalogPaths(
            mergeCatalogCategoryPaths(
              parseCatalogCategoryPaths(snapshot.data()?.catalogCategoryPaths),
              cloudProducts
            )
          );
        },
        error => {
          console.warn('Não foi possível carregar a hierarquia do catálogo.', error);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeStore();
    };
  }, [isOpen, products]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError('');

    const user = auth.currentUser;
    if (!user) {
      setFormError('Faça login novamente para salvar este item.');
      return;
    }
    if (!categoryRoot.trim()) {
      setFormError(
        keywords.length === 0
          ? 'Cadastre ao menos uma palavra-chave em Configurações da loja → Perfil.'
          : 'Selecione a categoria da loja.'
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

      if (mode === 'create') {
        const created = buildPublicProduct(user, {
          name,
          description,
          price: isComplimentary ? '0' : price,
          stock,
          category: fullCategoryPath,
          categoryCollections,
          optionGroups: parsedOptionGroups,
          quickNotes: parsedQuickNotes,
          image,
          isService,
          isComplimentary,
        });
        await onSave(created);
        return;
      }

      if (!product) {
        throw new Error('O item não foi identificado para edição.');
      }

      const parsedPrice = isComplimentary
        ? 0
        : Number.parseFloat(price.replace(',', '.'));
      const parsedStock = isService ? 0 : Number.parseInt(stock || '0', 10);
      if (!name.trim()) throw new Error('Informe o nome do item.');
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        throw new Error('Informe um preço válido.');
      }
      if (!isService && (!Number.isInteger(parsedStock) || parsedStock < 0)) {
        throw new Error('Informe um estoque válido.');
      }

      await onSave(
        sanitizeEditedProduct(product, {
          ...product,
          name: name.trim(),
          description: description.trim(),
          price: parsedPrice,
          stock: parsedStock,
          category: fullCategoryPath,
          categoryCollections,
          optionGroups: parsedOptionGroups,
          quickNotes: parsedQuickNotes,
          image: image.trim(),
          isService,
          isComplimentary,
        })
      );
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
      <section className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
              Catálogo da loja
            </span>
            <h3 className="mt-1 text-xl font-black text-white">
              {mode === 'create' ? 'Cadastrar novo item' : 'Editar item'}
            </h3>
            <p className="mt-1 text-[10px] text-slate-500">
              O mesmo formulário controla estoque, vitrine, PDV e produção.
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

        <form onSubmit={event => void handleSubmit(event)} className="mt-5 space-y-4">
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
            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Estoque inicial
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={isService ? '' : stock}
                onChange={event => setStock(event.target.value)}
                disabled={isSaving || isService}
                placeholder={isService ? 'Não se aplica' : '0'}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500 disabled:opacity-45"
              />
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
                onChange={event => {
                  setIsService(event.target.checked);
                  if (event.target.checked) setStock('');
                }}
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
