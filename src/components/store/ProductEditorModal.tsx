import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  CircleDollarSign,
  ImagePlus,
  Layers3,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import type {
  Product,
  ProductCategoryCollection,
} from '../../types';

interface ProductEditorModalProps {
  product: Product | null;
  products: Product[];
  keywords: string[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const splitCategoryPath = (value: string): string[] =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

const uniqueValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.flatMap(value => {
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
};

const reusableCategoryPaths = (products: Product[], root: string): string[] => {
  const normalizedRoot = normalize(root);
  const candidates = products.flatMap(product => {
    const paths = [
      product.category,
      ...(product.categoryCollections ?? []).map(collection => collection.path),
    ];
    return paths.filter(path => {
      const segments = splitCategoryPath(path);
      return segments.length > 1 && normalize(segments[0]) === normalizedRoot;
    });
  });

  return uniqueValues(candidates).sort((left, right) =>
    left.localeCompare(right, 'pt-BR')
  );
};

const collectionsForPath = (
  products: Product[],
  categoryPath: string
): ProductCategoryCollection[] => {
  const expectedSegments = splitCategoryPath(categoryPath);
  if (expectedSegments.length <= 1) return [];

  const source = products.find(candidate =>
    normalize(candidate.category) === normalize(categoryPath)
  );
  const sourceByPath = new Map(
    (source?.categoryCollections ?? []).map(collection => [
      normalize(collection.path),
      collection,
    ])
  );

  return expectedSegments.slice(1).map((name, index) => {
    const path = expectedSegments.slice(0, index + 2).join(' > ');
    const existing = sourceByPath.get(normalize(path));
    return {
      path,
      name,
      image: existing?.image ?? '',
    };
  });
};

export const ProductEditorModal: React.FC<ProductEditorModalProps> = ({
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
  const [subcategoryPath, setSubcategoryPath] = useState('');
  const [image, setImage] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [isService, setIsService] = useState(false);
  const [isComplimentary, setIsComplimentary] = useState(false);
  const [formError, setFormError] = useState('');

  const categoryOptions = useMemo(() => {
    const currentRoot = splitCategoryPath(product?.category ?? '')[0] ?? '';
    return uniqueValues([...keywords, currentRoot]);
  }, [keywords, product?.category]);

  const reusablePaths = useMemo(
    () => reusableCategoryPaths(products, categoryRoot),
    [products, categoryRoot]
  );

  useEffect(() => {
    if (!product) return;
    const segments = splitCategoryPath(product.category);
    setName(product.name);
    setDescription(product.description);
    setPrice(String(product.price));
    setStock(product.isService ? '' : String(product.stock));
    setCategoryRoot(segments[0] ?? '');
    setSubcategoryPath(segments.slice(1).join(' > '));
    setImage(product.image);
    setImageFileName('');
    setIsService(product.isService === true);
    setIsComplimentary(product.isComplimentary === true);
    setFormError('');
  }, [product]);

  if (!product) return null;

  const fullCategoryPath = [categoryRoot, subcategoryPath]
    .map(value => value.trim())
    .filter(Boolean)
    .join(' > ');

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError('');

    const parsedPrice = isComplimentary
      ? 0
      : Number.parseFloat(price.replace(',', '.'));
    const parsedStock = isService ? 0 : Number.parseInt(stock || '0', 10);

    if (!name.trim()) {
      setFormError('Informe o nome do item.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError('Informe um preço válido.');
      return;
    }
    if (!categoryRoot.trim()) {
      setFormError('Selecione a categoria da loja.');
      return;
    }
    if (!isService && (!Number.isInteger(parsedStock) || parsedStock < 0)) {
      setFormError('Informe um estoque válido.');
      return;
    }

    try {
      await onSave({
        ...product,
        name: name.trim(),
        description: description.trim(),
        price: parsedPrice,
        stock: isService ? 0 : parsedStock,
        category: fullCategoryPath,
        categoryCollections: collectionsForPath(products, fullCategoryPath),
        image: image.trim(),
        isService,
        isComplimentary,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar este item.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[135] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
      <section className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">
              Catálogo da loja
            </span>
            <h3 className="mt-1 text-xl font-black text-white">Editar item</h3>
            <p className="mt-1 text-[10px] text-slate-500">
              As alterações serão refletidas na vitrine e no estoque.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 hover:text-white disabled:opacity-40"
            aria-label="Fechar edição"
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
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500"
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
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-orange-500 disabled:opacity-45"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Estoque
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

          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
            <div>
              <span className="flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
                <Layers3 className="h-4 w-4 text-teal-400" />
                Categoria e coleção
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[9px] font-black uppercase text-slate-500">
                Categoria da loja
                <select
                  value={categoryRoot}
                  onChange={event => {
                    setCategoryRoot(event.target.value);
                    setSubcategoryPath('');
                  }}
                  disabled={isSaving}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
                >
                  <option value="">Selecione</option>
                  {categoryOptions.map(option => (
                    <option key={normalize(option)} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-[9px] font-black uppercase text-slate-500">
                Reutilizar caminho existente
                <select
                  value=""
                  onChange={event => {
                    const segments = splitCategoryPath(event.target.value);
                    setSubcategoryPath(segments.slice(1).join(' > '));
                  }}
                  disabled={isSaving || reusablePaths.length === 0}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
                >
                  <option value="">
                    {reusablePaths.length > 0 ? 'Selecione uma coleção' : 'Nenhuma coleção cadastrada'}
                  </option>
                  {reusablePaths.map(path => (
                    <option key={normalize(path)} value={path}>{path}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-[9px] font-black uppercase text-slate-500">
              Subcategorias do item
              <input
                value={subcategoryPath}
                onChange={event => setSubcategoryPath(event.target.value)}
                disabled={isSaving || !categoryRoot}
                placeholder="Ex.: Bebidas > Sucos naturais"
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
              />
            </label>
            <p className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] text-slate-500">
              Caminho: <strong className="text-slate-300">{fullCategoryPath || 'Não selecionado'}</strong>
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
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
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
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
                  className="flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remover
                </button>
              )}
            </div>
            {imageFileName && (
              <p className="text-[9px] text-slate-500">Arquivo: {imageFileName}</p>
            )}
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
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white outline-none focus:border-orange-500"
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
              <span className="text-[10px] text-slate-400">Este item é um serviço.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
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
                Item sem custo.
              </span>
            </label>
          </div>

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
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Salvando...' : 'Salvar item'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
