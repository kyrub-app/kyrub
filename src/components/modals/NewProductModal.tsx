import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import { auth, db } from '../../utils/firebase';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';
import {
  buildPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProductCreateRequest,
} from '../../utils/publicProducts';

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  handleCreateProduct: (e: React.FormEvent) => void;
  newProdName: string;
  setNewProdName: (val: string) => void;
  newProdPrice: string;
  setNewProdPrice: (val: string) => void;
  newProdCategory: string;
  setNewProdCategory: (val: string) => void;
  newProdStock: string;
  setNewProdStock: (val: string) => void;
  newProdDesc: string;
  setNewProdDesc: (val: string) => void;
  newProdIsService: boolean;
  setNewProdIsService: (val: boolean) => void;
}

const normalizeCategoryValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const readCategoryOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap(candidate => {
    if (typeof candidate !== 'string') return [];
    const keyword = candidate.trim();
    const normalized = normalizeCategoryValue(keyword);
    if (!keyword || seen.has(normalized)) return [];
    seen.add(normalized);
    return [keyword];
  });
};

export const NewProductModal: React.FC<NewProductModalProps> = ({
  isOpen,
  onClose,
  newProdName,
  setNewProdName,
  newProdPrice,
  setNewProdPrice,
  newProdCategory,
  setNewProdCategory,
  newProdStock,
  setNewProdStock,
  newProdDesc,
  setNewProdDesc,
  newProdIsService,
  setNewProdIsService,
}) => {
  const [imageUrl, setImageUrl] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [formError, setFormError] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [subcategoryDraft, setSubcategoryDraft] = useState('');
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const wasOpen = useRef(false);

  const categoryPath = useMemo(
    () => [newProdCategory, ...subcategories].filter(Boolean).join(' > '),
    [newProdCategory, subcategories]
  );

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setNewProdName('');
      setNewProdPrice('');
      setNewProdCategory('');
      setNewProdStock('');
      setNewProdDesc('');
      setNewProdIsService(false);
      setImageUrl('');
      setImageFileName('');
      setFormError('');
      setSubcategoryDraft('');
      setSubcategories([]);
    }

    wasOpen.current = isOpen;
  }, [
    isOpen,
    setNewProdCategory,
    setNewProdDesc,
    setNewProdIsService,
    setNewProdName,
    setNewProdPrice,
    setNewProdStock,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    let unsubscribeStore = () => undefined;
    setLoadingCategories(true);
    setCategoryOptions([]);

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeStore();
      unsubscribeStore = () => undefined;

      if (!user) {
        setCategoryOptions([]);
        setLoadingCategories(false);
        return;
      }

      unsubscribeStore = onSnapshot(
        doc(db, getPrimaryUserStoreDocumentPath(user.uid)),
        snapshot => {
          setCategoryOptions(readCategoryOptions(snapshot.data()?.keywords));
          setLoadingCategories(false);
        },
        error => {
          console.warn('Não foi possível carregar as categorias da loja.', error);
          setCategoryOptions([]);
          setLoadingCategories(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeStore();
    };
  }, [isOpen]);

  useEffect(() => {
    if (loadingCategories || !newProdCategory) return;

    const selectedCategoryExists = categoryOptions.some(
      option =>
        normalizeCategoryValue(option) ===
        normalizeCategoryValue(newProdCategory)
    );

    if (!selectedCategoryExists) {
      setNewProdCategory('');
      setSubcategories([]);
    }
  }, [
    categoryOptions,
    loadingCategories,
    newProdCategory,
    setNewProdCategory,
  ]);

  if (!isOpen) return null;

  const addSubcategoryLevels = (): void => {
    const candidates = subcategoryDraft
      .split(/\s*(?:>|\/)\s*/)
      .map(value => value.trim())
      .filter(Boolean);

    if (candidates.length === 0) return;

    setSubcategories(current => {
      const next = [...current];
      const normalizedValues = new Set(next.map(normalizeCategoryValue));

      for (const candidate of candidates) {
        if (next.length >= 6) break;
        const limitedCandidate = candidate.slice(0, 40);
        const normalized = normalizeCategoryValue(limitedCandidate);
        if (!normalized || normalizedValues.has(normalized)) continue;
        normalizedValues.add(normalized);
        next.push(limitedCandidate);
      }

      return next;
    });
    setSubcategoryDraft('');
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setFormError('');

    const user = auth.currentUser;
    if (!user) {
      setFormError('Faça login novamente para cadastrar o item.');
      return;
    }

    if (!newProdCategory) {
      setFormError(
        categoryOptions.length === 0
          ? 'Cadastre ao menos uma palavra-chave em Configurações da loja → Perfil.'
          : 'Selecione uma categoria para o item.'
      );
      return;
    }

    try {
      const product = buildPublicProduct(user, {
        name: newProdName,
        description: newProdDesc,
        price: newProdPrice,
        stock: newProdStock,
        category: categoryPath,
        image: imageUrl,
        isService: newProdIsService,
      });

      const request: PublicProductCreateRequest = {
        product,
        accepted: false,
      };

      window.dispatchEvent(
        new CustomEvent<PublicProductCreateRequest>(PUBLIC_PRODUCT_CREATE_EVENT, {
          detail: request,
        })
      );

      if (!request.accepted) {
        setFormError(
          request.reason ?? 'Não foi possível cadastrar o item nesta loja.'
        );
        return;
      }

      setNewProdName('');
      setNewProdPrice('');
      setNewProdCategory('');
      setNewProdStock('');
      setNewProdDesc('');
      setNewProdIsService(false);
      setImageUrl('');
      setImageFileName('');
      setSubcategoryDraft('');
      setSubcategories([]);
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Revise os dados informados.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-black text-white">
            <Plus className="h-5 w-5 text-teal-400" />
            <span>Cadastrar produto ou serviço</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-bold text-slate-500 hover:text-slate-300"
            aria-label="Fechar cadastro"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
              Nome do item
            </label>
            <input
              type="text"
              value={newProdName}
              onChange={event => setNewProdName(event.target.value)}
              placeholder="Digite o nome"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Preço de venda
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newProdPrice}
                onChange={event => setNewProdPrice(event.target.value)}
                placeholder="0,00"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Categoria da loja
              </label>
              <select
                value={newProdCategory}
                onChange={event => {
                  setNewProdCategory(event.target.value);
                  setSubcategories([]);
                  setSubcategoryDraft('');
                }}
                disabled={loadingCategories || categoryOptions.length === 0}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="">
                  {loadingCategories
                    ? 'Carregando palavras-chave…'
                    : categoryOptions.length > 0
                      ? 'Selecione uma palavra-chave'
                      : 'Nenhuma palavra-chave cadastrada'}
                </option>
                {categoryOptions.map(category => (
                  <option key={normalizeCategoryValue(category)} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Estoque inicial
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={newProdIsService ? '' : newProdStock}
                onChange={event => setNewProdStock(event.target.value)}
                placeholder={newProdIsService ? 'Não se aplica' : '0'}
                disabled={newProdIsService}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Imagem do item
              </label>
              <div className="relative">
                <ImagePlus className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  type="url"
                  value={imageUrl}
                  onChange={event => {
                    setImageUrl(event.target.value);
                    setImageFileName('');
                  }}
                  placeholder="URL externa, Drive ou Google Fotos"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-10 pr-3.5 text-sm text-white focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-3"
            id="product-subcategory-control"
          >
            <div>
              <label className="block font-mono text-xs uppercase text-slate-400">
                Subcategorias
              </label>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                Adicione um nível por vez. Exemplo: Vinhos → Branco → Italiano.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={subcategoryDraft}
                onChange={event => setSubcategoryDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSubcategoryLevels();
                  }
                }}
                disabled={!newProdCategory || subcategories.length >= 6}
                placeholder={
                  newProdCategory
                    ? 'Ex.: Branco, Italiano, Reserva…'
                    : 'Selecione primeiro a categoria'
                }
                className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
              />
              <button
                type="button"
                onClick={addSubcategoryLevels}
                disabled={
                  !newProdCategory ||
                  !subcategoryDraft.trim() ||
                  subcategories.length >= 6
                }
                className="flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-xl bg-slate-800 px-3 text-[9px] font-black uppercase text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Adicionar
              </button>
            </div>

            {subcategories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {subcategories.map((subcategory, index) => (
                  <span
                    key={`${normalizeCategoryValue(subcategory)}-${index}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-1 text-[9px] font-bold text-teal-200"
                  >
                    {index + 1}. {subcategory}
                    <button
                      type="button"
                      onClick={() =>
                        setSubcategories(current =>
                          current.filter((_, currentIndex) => currentIndex !== index)
                        )
                      }
                      className="text-teal-400 hover:text-white"
                      aria-label={`Remover subcategoria ${subcategory}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
              <span className="block text-[8px] font-black uppercase tracking-wide text-slate-600">
                Caminho do item
              </span>
              <strong className="mt-1 block text-[10px] text-slate-300">
                {categoryPath || 'Categoria ainda não selecionada'}
              </strong>
            </div>
          </div>

          {categoryOptions.length === 0 && !loadingCategories && (
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
              As categorias são as palavras-chave cadastradas em Configurações da loja → Perfil.
            </p>
          )}

          <div
            className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-3"
            id="product-drive-image-control"
          >
            {imageUrl && (
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                <img
                  src={imageUrl}
                  alt="Prévia da imagem do produto"
                  className="h-36 w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            <div className="flex flex-wrap items-start gap-2">
              <GooglePhotosImagePickerButton
                label="Selecionar da galeria"
                onSelect={selection => {
                  setImageUrl(selection.url);
                  setImageFileName(selection.fileName);
                }}
              />
              <GoogleDriveImagePickerButton
                label="Selecionar foto do Drive"
                onSelect={selection => {
                  setImageUrl(selection.url);
                  setImageFileName(selection.fileName);
                }}
              />
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setImageUrl('');
                    setImageFileName('');
                  }}
                  className="flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remover imagem
                </button>
              )}
            </div>

            <p className="text-[10px] leading-relaxed text-slate-500">
              {imageFileName
                ? `Arquivo selecionado: ${imageFileName}`
                : 'A foto escolhida no Google Fotos é copiada para seu Drive e compartilhada como somente leitura. O Firestore recebe apenas a referência.'}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
              Descrição
            </label>
            <textarea
              value={newProdDesc}
              onChange={event => setNewProdDesc(event.target.value)}
              rows={3}
              placeholder="Descreva o item com suas próprias informações"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-teal-500 focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <input
              type="checkbox"
              checked={newProdIsService}
              onChange={event => {
                setNewProdIsService(event.target.checked);
                if (event.target.checked) setNewProdStock('');
              }}
              className="accent-teal-500"
            />
            <span className="text-xs text-slate-300">
              Este item é um serviço
            </span>
          </label>

          {formError && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="flex gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-300 transition-all hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-bold text-white transition-all hover:bg-orange-500"
            >
              Cadastrar item
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
