import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  Check,
  ChevronRight,
  Folder,
  FolderTree,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { Product, ProductCategoryCollection } from '../../types';
import { auth, db } from '../../utils/firebase';
import {
  deleteCatalogCategoryPath,
  joinCatalogCategoryPath,
  MAX_CATALOG_CATEGORY_LEVELS,
  mergeCatalogCategoryPaths,
  normalizeCatalogCategoryValue,
  parseCatalogCategoryPaths,
  reconcileCatalogCategoryPaths,
  renameCatalogCategoryPath,
  splitCatalogCategoryPath,
} from '../../utils/catalogCategoryTree';
import { parsePublicProducts } from '../../utils/publicProducts';

const normalize = normalizeCatalogCategoryValue;
const splitPath = splitCatalogCategoryPath;

type ModalMode = 'create' | 'edit';

const readLocalProducts = (): Product[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem('kyrub_products') ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as Product[]) : [];
  } catch {
    return [];
  }
};

const setReactInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const findLabel = (labelText: string): HTMLLabelElement | null =>
  Array.from(document.querySelectorAll<HTMLLabelElement>('label')).find(candidate =>
    candidate.textContent?.trim().toLocaleLowerCase('pt-BR').startsWith(
      labelText.toLocaleLowerCase('pt-BR')
    )
  ) ?? null;

const findCategorySelect = (): HTMLSelectElement | null =>
  findLabel('Categoria da loja')?.querySelector('select') ??
  findLabel('Categoria da loja')?.parentElement?.querySelector('select') ??
  null;

const findEditorCategorySection = (): HTMLElement | null => {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('span, h4')).find(
    candidate =>
      candidate.textContent?.trim().toLocaleLowerCase('pt-BR') ===
      'categoria e coleção'
  );
  const section = heading?.closest('section');
  return section instanceof HTMLElement ? section : null;
};

const findPickerButton = (text: string): HTMLButtonElement | null => {
  const control = document.getElementById('product-drive-image-control');
  if (!control) return null;
  return (
    Array.from(control.querySelectorAll<HTMLButtonElement>('button')).find(button =>
      button.textContent?.trim().toLocaleLowerCase('pt-BR').includes(
        text.toLocaleLowerCase('pt-BR')
      )
    ) ?? null
  );
};

const pathStartsWith = (value: string, prefix: string): boolean => {
  const valueSegments = splitPath(value);
  const prefixSegments = splitPath(prefix);
  return (
    valueSegments.length >= prefixSegments.length &&
    prefixSegments.every(
      (segment, index) => normalize(valueSegments[index] ?? '') === normalize(segment)
    )
  );
};

const renamePathLocally = (
  value: string,
  targetPath: string,
  nextName: string
): string => {
  if (!pathStartsWith(value, targetPath)) return value;
  const segments = splitPath(value);
  const targetSegments = splitPath(targetPath);
  segments[targetSegments.length - 1] = nextName;
  return joinCatalogCategoryPath(segments);
};

const deletePathLocally = (value: string, targetPath: string): string => {
  if (!pathStartsWith(value, targetPath)) return value;
  const segments = splitPath(value);
  const targetSegments = splitPath(targetPath);
  return joinCatalogCategoryPath(
    segments.filter((_, index) => index !== targetSegments.length - 1)
  );
};

export function ProductCreationEnhancementBridge() {
  const [categoryHost, setCategoryHost] = useState<HTMLElement | null>(null);
  const [imageHost, setImageHost] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<Product[]>(() => readLocalProducts());
  const [catalogPaths, setCatalogPaths] = useState<ProductCategoryCollection[]>([]);
  const [selectedRoot, setSelectedRoot] = useState('');
  const [selectedReusablePath, setSelectedReusablePath] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [editingPath, setEditingPath] = useState('');
  const [editingName, setEditingName] = useState('');
  const [deletingPath, setDeletingPath] = useState('');
  const [busyPath, setBusyPath] = useState('');
  const [managerError, setManagerError] = useState('');
  const reconciledSignatureRef = useRef('');
  const activeCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const activeCategoryControlRef = useRef<HTMLElement | null>(null);

  const reusablePaths = useMemo(() => {
    const normalizedRoot = normalize(selectedRoot);
    return catalogPaths
      .filter(path => {
        const segments = splitPath(path.path);
        return segments.length > 1 && normalize(segments[0] ?? '') === normalizedRoot;
      })
      .sort((left, right) => {
        const depthDifference = splitPath(left.path).length - splitPath(right.path).length;
        return depthDifference || left.path.localeCompare(right.path, 'pt-BR');
      });
  }, [catalogPaths, selectedRoot]);

  useEffect(() => {
    let unsubscribeProducts = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeProducts();
      unsubscribeProducts = () => undefined;
      reconciledSignatureRef.current = '';

      if (!user) {
        const localProducts = readLocalProducts();
        setProducts(localProducts);
        setCatalogPaths([]);
        return;
      }

      unsubscribeProducts = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          const cloudProducts = parsePublicProducts(snapshot.data()?.publicProducts);
          const nextProducts = cloudProducts.length > 0 ? cloudProducts : readLocalProducts();
          const storedPaths = parseCatalogCategoryPaths(
            snapshot.data()?.catalogCategoryPaths
          );
          const mergedPaths = mergeCatalogCategoryPaths(storedPaths, cloudProducts);
          setProducts(nextProducts);
          setCatalogPaths(mergedPaths);

          const signature = JSON.stringify(mergedPaths);
          if (signature !== JSON.stringify(storedPaths) && signature !== reconciledSignatureRef.current) {
            reconciledSignatureRef.current = signature;
            void reconcileCatalogCategoryPaths(user).catch(error => {
              console.warn('Não foi possível registrar a árvore de categorias.', error);
            });
          }
        },
        () => {
          setProducts(readLocalProducts());
          setCatalogPaths([]);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, []);

  useEffect(() => {
    let mountedCategoryHost: HTMLDivElement | null = null;
    let mountedImageHost: HTMLDivElement | null = null;
    let categorySelect: HTMLSelectElement | null = null;
    let hiddenImageIcon: SVGElement | null = null;
    let imageInput: HTMLInputElement | null = null;
    let guardedAddButton: HTMLButtonElement | null = null;
    let guardedDraftInput: HTMLInputElement | null = null;

    const countRequestedLevels = (value: string): number =>
      value
        .split(/\s*(?:>|\/)\s*/)
        .map(segment => segment.trim())
        .filter(Boolean).length;

    const validateLevelLimit = (event: Event): void => {
      const control = activeCategoryControlRef.current;
      const draftInput = guardedDraftInput;
      if (!control || !draftInput) return;
      const existingLevels = control.querySelectorAll(
        '#product-subcategory-media-list > article'
      ).length;
      const requestedLevels = countRequestedLevels(draftInput.value);
      const availableLevels = MAX_CATALOG_CATEGORY_LEVELS - 1 - existingLevels;

      if (requestedLevels > availableLevels) {
        event.preventDefault();
        event.stopPropagation();
        setManagerError(
          `A hierarquia aceita no máximo ${MAX_CATALOG_CATEGORY_LEVELS} níveis, contando a categoria principal.`
        );
      }
    };

    const validateEnterLimit = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') validateLevelLimit(event);
    };

    const sync = (): void => {
      const createControl = document.getElementById('product-subcategory-control');
      const editorControl = findEditorCategorySection();
      const nextControl = createControl ?? editorControl;
      const nextMode: ModalMode = createControl ? 'create' : 'edit';
      const nextCategorySelect = findCategorySelect();

      if (nextCategorySelect !== categorySelect) {
        categorySelect?.removeEventListener('change', handleCategoryChange);
        categorySelect = nextCategorySelect;
        categorySelect?.addEventListener('change', handleCategoryChange);
        setSelectedRoot(categorySelect?.value ?? '');
      }

      if (nextControl && nextControl !== activeCategoryControlRef.current) {
        mountedCategoryHost?.remove();
        mountedCategoryHost = document.createElement('div');
        mountedCategoryHost.id = 'catalog-category-tree-host';
        mountedCategoryHost.className = 'mt-3';

        const insertionTarget = nextMode === 'create'
          ? nextControl.children.item(0)
          : nextControl.children.item(0);
        insertionTarget?.insertAdjacentElement('afterend', mountedCategoryHost);

        activeCategoryControlRef.current = nextControl;
        activeCategoryInputRef.current =
          nextMode === 'create'
            ? nextControl.querySelector<HTMLInputElement>('input[type="text"]')
            : findLabel('Subcategorias do item')?.querySelector('input') ?? null;
        setModalMode(nextMode);
        setCategoryHost(mountedCategoryHost);
        setSelectedReusablePath('');
        setManagerError('');
      }

      if (!nextControl && mountedCategoryHost) {
        mountedCategoryHost.remove();
        mountedCategoryHost = null;
        activeCategoryControlRef.current = null;
        activeCategoryInputRef.current = null;
        setCategoryHost(null);
        setSelectedReusablePath('');
        setEditingPath('');
        setDeletingPath('');
      }

      if (createControl) {
        const nextAddButton = Array.from(
          createControl.querySelectorAll<HTMLButtonElement>('button')
        ).find(button =>
          button.textContent?.trim().toLocaleLowerCase('pt-BR').includes('adicionar')
        ) ?? null;
        const nextDraftInput = createControl.querySelector<HTMLInputElement>(
          'input[type="text"]'
        );

        if (nextAddButton !== guardedAddButton) {
          guardedAddButton?.removeEventListener('click', validateLevelLimit, true);
          guardedAddButton = nextAddButton;
          guardedAddButton?.addEventListener('click', validateLevelLimit, true);
        }
        if (nextDraftInput !== guardedDraftInput) {
          guardedDraftInput?.removeEventListener('keydown', validateEnterLimit, true);
          guardedDraftInput = nextDraftInput;
          guardedDraftInput?.addEventListener('keydown', validateEnterLimit, true);
        }

        const existingLevels = createControl.querySelectorAll(
          '#product-subcategory-media-list > article'
        ).length;
        if (existingLevels >= MAX_CATALOG_CATEGORY_LEVELS - 1) {
          if (guardedDraftInput) guardedDraftInput.disabled = true;
          if (guardedAddButton) guardedAddButton.disabled = true;
        }
      }

      const imageInputCandidate = findLabel('Imagem do item')?.parentElement?.querySelector<HTMLInputElement>('input[type="url"]') ?? null;
      const imageWrapper = imageInputCandidate?.parentElement;
      if (imageWrapper && document.getElementById('product-drive-image-control') && !mountedImageHost) {
        imageInput = imageInputCandidate;
        hiddenImageIcon = imageWrapper.querySelector('svg');
        if (hiddenImageIcon instanceof SVGElement) hiddenImageIcon.style.display = 'none';
        imageInput.style.paddingLeft = '0.875rem';
        imageInput.style.paddingRight = '3.25rem';

        mountedImageHost = document.createElement('div');
        mountedImageHost.id = 'product-image-paperclip-host';
        imageWrapper.appendChild(mountedImageHost);
        setImageHost(mountedImageHost);
      }

      if (!imageInputCandidate && mountedImageHost) {
        mountedImageHost.remove();
        mountedImageHost = null;
        setImageHost(null);
        setImageMenuOpen(false);
      }
    };

    function handleCategoryChange(event: Event): void {
      setSelectedRoot((event.currentTarget as HTMLSelectElement).value);
      setSelectedReusablePath('');
      setEditingPath('');
      setDeletingPath('');
      setManagerError('');
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      categorySelect?.removeEventListener('change', handleCategoryChange);
      guardedAddButton?.removeEventListener('click', validateLevelLimit, true);
      guardedDraftInput?.removeEventListener('keydown', validateEnterLimit, true);
      mountedCategoryHost?.remove();
      mountedImageHost?.remove();
      if (hiddenImageIcon instanceof SVGElement) hiddenImageIcon.style.display = '';
      if (imageInput) {
        imageInput.style.paddingLeft = '';
        imageInput.style.paddingRight = '';
      }
    };
  }, []);

  const readCurrentFormPath = (): string => {
    const control = activeCategoryControlRef.current;
    if (!control || !selectedRoot) return selectedRoot;

    if (modalMode === 'edit') {
      const tail = activeCategoryInputRef.current?.value ?? '';
      return joinCatalogCategoryPath([selectedRoot, ...splitPath(tail)]);
    }

    const pathLabel = Array.from(control.querySelectorAll('strong')).find(candidate =>
      candidate.parentElement?.textContent?.toLocaleLowerCase('pt-BR').includes(
        'caminho do item'
      )
    );
    const displayedPath = pathLabel?.textContent?.trim() ?? '';
    return displayedPath && !displayedPath.includes('ainda não')
      ? displayedPath
      : selectedRoot;
  };

  const clearCreatePath = (afterClear: () => void): void => {
    const control = activeCategoryControlRef.current;
    if (!control) return;
    const removeButtons = Array.from(
      control.querySelectorAll<HTMLButtonElement>(
        '#product-subcategory-media-list button[aria-label^="Remover subcategoria"]'
      )
    ).reverse();
    removeButtons.forEach(button => button.click());
    window.requestAnimationFrame(() => window.requestAnimationFrame(afterClear));
  };

  const applyPathToForm = (path: string): void => {
    setSelectedReusablePath(path);
    setManagerError('');
    const segments = splitPath(path);
    const tailSegments = segments.slice(1, MAX_CATALOG_CATEGORY_LEVELS);
    const tail = joinCatalogCategoryPath(tailSegments);
    const input = activeCategoryInputRef.current;

    if (!input) return;

    if (modalMode === 'edit') {
      setReactInputValue(input, tail);
      return;
    }

    const control = activeCategoryControlRef.current;
    const addButton = Array.from(
      control?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ).find(button =>
      button.textContent?.trim().toLocaleLowerCase('pt-BR').includes('adicionar')
    );
    if (!addButton) return;

    clearCreatePath(() => {
      if (!tail) return;
      setReactInputValue(input, tail);
      window.requestAnimationFrame(() => addButton.click());
    });
  };

  const handleRenamePath = async (path: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setManagerError('Faça login novamente para editar esta pasta.');
      return;
    }

    const cleanName = editingName.trim();
    if (!cleanName) {
      setManagerError('Informe o novo nome da pasta.');
      return;
    }

    const currentFormPath = readCurrentFormPath();
    setBusyPath(path);
    setManagerError('');
    try {
      const result = await renameCatalogCategoryPath(user, path, cleanName);
      setProducts(result.products);
      setCatalogPaths(result.paths);
      setEditingPath('');
      setEditingName('');

      if (pathStartsWith(currentFormPath, path)) {
        applyPathToForm(renamePathLocally(currentFormPath, path, cleanName));
      } else if (selectedReusablePath && pathStartsWith(selectedReusablePath, path)) {
        setSelectedReusablePath(
          renamePathLocally(selectedReusablePath, path, cleanName)
        );
      }
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'Não foi possível renomear esta pasta.'
      );
    } finally {
      setBusyPath('');
    }
  };

  const handleDeletePath = async (path: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setManagerError('Faça login novamente para excluir esta pasta.');
      return;
    }

    const currentFormPath = readCurrentFormPath();
    setBusyPath(path);
    setManagerError('');
    try {
      const result = await deleteCatalogCategoryPath(user, path);
      setProducts(result.products);
      setCatalogPaths(result.paths);
      setDeletingPath('');

      if (pathStartsWith(currentFormPath, path)) {
        applyPathToForm(deletePathLocally(currentFormPath, path));
      } else if (selectedReusablePath && pathStartsWith(selectedReusablePath, path)) {
        setSelectedReusablePath(
          deletePathLocally(selectedReusablePath, path)
        );
      }
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'Não foi possível excluir esta pasta.'
      );
    } finally {
      setBusyPath('');
    }
  };

  const openPicker = (source: 'galeria' | 'drive'): void => {
    setImageMenuOpen(false);
    const button = findPickerButton(
      source === 'galeria' ? 'selecionar da galeria' : 'selecionar foto do drive'
    );
    button?.click();
  };

  return (
    <>
      {categoryHost &&
        createPortal(
          <section
            className="rounded-2xl border border-teal-500/20 bg-teal-500/[0.06] p-3"
            id="catalog-category-tree-manager"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="flex items-center gap-2 font-mono text-[10px] font-black uppercase text-teal-300">
                  <FolderTree className="h-4 w-4" />
                  Pastas e subpastas da categoria
                </span>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                  A palavra-chave é a pasta principal. Abaixo dela, crie ou reutilize até cinco níveis adicionais.
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[8px] font-bold text-slate-500">
                Máx. {MAX_CATALOG_CATEGORY_LEVELS} níveis
              </span>
            </div>

            {!selectedRoot ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-3 py-4 text-center text-[10px] text-slate-500">
                Selecione primeiro a categoria da loja.
              </p>
            ) : reusablePaths.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-3 py-4 text-center text-[10px] text-slate-500">
                Nenhuma subcategoria cadastrada em {selectedRoot}. Use o campo abaixo para criar a primeira pasta.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5" id="catalog-category-tree-list">
                {reusablePaths.map(collection => {
                  const segments = splitPath(collection.path);
                  const depth = Math.max(0, segments.length - 2);
                  const isEditing = editingPath === collection.path;
                  const isDeleting = deletingPath === collection.path;
                  const isBusy = busyPath === collection.path;
                  const itemCount = products.filter(product =>
                    pathStartsWith(product.category, collection.path)
                  ).length;

                  return (
                    <article
                      key={normalize(collection.path)}
                      className={`rounded-xl border p-2 ${
                        selectedReusablePath === collection.path
                          ? 'border-teal-500/40 bg-teal-500/10'
                          : 'border-slate-800 bg-slate-950/70'
                      }`}
                      style={{ marginLeft: `${depth * 14}px` }}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={event => setEditingName(event.target.value)}
                            onKeyDown={event => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleRenamePath(collection.path);
                              }
                              if (event.key === 'Escape') setEditingPath('');
                            }}
                            maxLength={40}
                            className="min-w-0 flex-1 rounded-lg border border-teal-500/40 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRenamePath(collection.path)}
                            disabled={isBusy}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-slate-950 disabled:opacity-40"
                            aria-label="Salvar nome da pasta"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPath('')}
                            disabled={isBusy}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 disabled:opacity-40"
                            aria-label="Cancelar edição da pasta"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : isDeleting ? (
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 text-[9px] leading-relaxed text-amber-200">
                            Excluir <strong>{collection.name}</strong>? Itens e subpastas serão movidos para o nível anterior.
                          </p>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDeletePath(collection.path)}
                              disabled={isBusy}
                              className="min-h-9 rounded-lg bg-red-500 px-2.5 text-[8px] font-black uppercase text-white disabled:opacity-40"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingPath('')}
                              disabled={isBusy}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400"
                              aria-label="Cancelar exclusão da pasta"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => applyPathToForm(collection.path)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            title={`Usar ${collection.path}`}
                          >
                            {depth > 0 && (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                            )}
                            <Folder className="h-4 w-4 shrink-0 text-teal-400" />
                            <span className="min-w-0">
                              <strong className="block truncate text-[10px] text-slate-200">
                                {collection.name}
                              </strong>
                              <span className="block truncate text-[8px] text-slate-600">
                                {collection.path} · {itemCount} item(ns)
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPath(collection.path);
                              setEditingName(collection.name);
                              setDeletingPath('');
                              setManagerError('');
                            }}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-teal-300"
                            aria-label={`Renomear ${collection.name}`}
                            title="Renomear pasta"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingPath(collection.path);
                              setEditingPath('');
                              setManagerError('');
                            }}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                            aria-label={`Excluir ${collection.name}`}
                            title="Excluir pasta"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {managerError && (
              <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
                {managerError}
              </p>
            )}

            <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
              Toque em uma pasta para usar o caminho no item. Renomear atualiza todos os itens e descendentes; excluir promove o conteúdo para a pasta anterior.
            </p>
          </section>,
          categoryHost
        )}

      {imageHost &&
        createPortal(
          <div className="absolute right-2 top-1/2 z-20 -translate-y-1/2">
            <button
              type="button"
              onClick={() => setImageMenuOpen(current => !current)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:border-teal-500/50 hover:text-teal-300"
              aria-label="Anexar imagem do item"
              id="product-image-paperclip-button"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {imageMenuOpen && (
              <div className="absolute right-0 top-10 w-44 space-y-1 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
                <button
                  type="button"
                  onClick={() => openPicker('galeria')}
                  className="w-full rounded-lg px-3 py-2 text-left text-[9px] font-black uppercase text-slate-300 hover:bg-slate-800"
                >
                  Google Fotos / Galeria
                </button>
                <button
                  type="button"
                  onClick={() => openPicker('drive')}
                  className="w-full rounded-lg px-3 py-2 text-left text-[9px] font-black uppercase text-slate-300 hover:bg-slate-800"
                >
                  Google Drive
                </button>
              </div>
            )}
          </div>,
          imageHost
        )}
    </>
  );
}
