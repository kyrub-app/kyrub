import {
  Check,
  Folder,
  Layers3,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Product, ProductCategoryCollection } from '../../types';
import {
  deleteCatalogCategoryPath,
  joinCatalogCategoryPath,
  normalizeCatalogCategoryValue,
  renameCatalogCategoryPath,
  splitCatalogCategoryPath,
} from '../../utils/catalogCategoryTree';
import {
  CATALOG_HIERARCHY_TIERS,
  createCatalogHierarchyPath,
  getDirectCatalogHierarchyChildren,
  MAX_CATALOG_HIERARCHY_CHILDREN,
} from '../../utils/catalogHierarchy';
import { auth } from '../../utils/firebase';
import type { PublicProduct } from '../../utils/publicProducts';

interface CatalogHierarchySelectorProps {
  keywords: string[];
  categoryRoot: string;
  onCategoryRootChange: (value: string) => void;
  selectedSegments: string[];
  onSelectedSegmentsChange: (segments: string[]) => void;
  paths: ProductCategoryCollection[];
  products: Product[];
  onCatalogDataChange: (
    paths: ProductCategoryCollection[],
    products?: PublicProduct[]
  ) => void;
  disabled?: boolean;
}

const pathStartsWith = (value: string, prefix: string): boolean => {
  const valueSegments = splitCatalogCategoryPath(value);
  const prefixSegments = splitCatalogCategoryPath(prefix);
  return (
    valueSegments.length >= prefixSegments.length &&
    prefixSegments.every(
      (segment, index) =>
        normalizeCatalogCategoryValue(valueSegments[index] ?? '') ===
        normalizeCatalogCategoryValue(segment)
    )
  );
};

const uniqueRoots = (keywords: string[], currentRoot: string): string[] => {
  const seen = new Set<string>();
  return [...keywords, currentRoot].flatMap(value => {
    const clean = value.trim();
    const key = normalizeCatalogCategoryValue(clean);
    if (!clean || seen.has(key)) return [];
    seen.add(key);
    return [clean];
  });
};

export function CatalogHierarchySelector({
  keywords,
  categoryRoot,
  onCategoryRootChange,
  selectedSegments,
  onSelectedSegmentsChange,
  paths,
  products,
  onCatalogDataChange,
  disabled = false,
}: CatalogHierarchySelectorProps) {
  const [creatingTier, setCreatingTier] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [editingPath, setEditingPath] = useState('');
  const [editingName, setEditingName] = useState('');
  const [deletingPath, setDeletingPath] = useState('');
  const [busyPath, setBusyPath] = useState('');
  const [error, setError] = useState('');

  const categoryOptions = useMemo(
    () => uniqueRoots(keywords, categoryRoot),
    [categoryRoot, keywords]
  );

  const updateTierSelection = (tierIndex: number, value: string): void => {
    const next = selectedSegments.slice(0, tierIndex);
    if (value) next[tierIndex] = value;
    onSelectedSegmentsChange(next);
    setCreatingTier(null);
    setNewName('');
    setEditingPath('');
    setDeletingPath('');
    setError('');
  };

  const handleCreate = async (tierIndex: number): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para criar este nível.');
      return;
    }

    const parentPath = joinCatalogCategoryPath([
      categoryRoot,
      ...selectedSegments.slice(0, tierIndex),
    ]);
    const cleanName = newName.trim();
    if (!cleanName) {
      setError(`Informe o nome de ${CATALOG_HIERARCHY_TIERS[tierIndex].toLowerCase()}.`);
      return;
    }

    setBusyPath(`${parentPath}::new`);
    setError('');
    try {
      const nextPaths = await createCatalogHierarchyPath(
        user,
        parentPath,
        cleanName
      );
      onCatalogDataChange(nextPaths);
      updateTierSelection(tierIndex, cleanName.slice(0, 40));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Não foi possível criar este nível.'
      );
    } finally {
      setBusyPath('');
    }
  };

  const handleRename = async (
    tierIndex: number,
    path: string
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para editar este nível.');
      return;
    }

    const cleanName = editingName.trim();
    if (!cleanName) {
      setError('Informe o novo nome.');
      return;
    }

    setBusyPath(path);
    setError('');
    try {
      const result = await renameCatalogCategoryPath(user, path, cleanName);
      onCatalogDataChange(result.paths, result.products);
      const currentPath = joinCatalogCategoryPath([
        categoryRoot,
        ...selectedSegments,
      ]);
      if (pathStartsWith(currentPath, path)) {
        const next = [...selectedSegments];
        next[tierIndex] = cleanName.slice(0, 40);
        onSelectedSegmentsChange(next);
      }
      setEditingPath('');
      setEditingName('');
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : 'Não foi possível renomear este nível.'
      );
    } finally {
      setBusyPath('');
    }
  };

  const handleDelete = async (
    tierIndex: number,
    path: string
  ): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      setError('Faça login novamente para excluir este nível.');
      return;
    }

    setBusyPath(path);
    setError('');
    try {
      const result = await deleteCatalogCategoryPath(user, path);
      onCatalogDataChange(result.paths, result.products);
      onSelectedSegmentsChange(selectedSegments.slice(0, tierIndex));
      setDeletingPath('');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Não foi possível excluir este nível.'
      );
    } finally {
      setBusyPath('');
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
      id="product-category-hierarchy-control"
    >
      <div>
        <h4 className="flex items-center gap-2 font-mono text-xs uppercase text-slate-400">
          <Layers3 className="h-4 w-4 text-teal-400" />
          Categorias e grupos
        </h4>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          A categoria principal vem das palavras-chave do perfil. Depois, organize o item em Subcategoria, Grupo, Subgrupo e Pasta. Cada pasta-pai aceita até cinco opções.
        </p>
      </div>

      <label className="block text-[9px] font-black uppercase text-slate-500">
        Categoria da loja
        <select
          value={categoryRoot}
          onChange={event => {
            onCategoryRootChange(event.target.value);
            onSelectedSegmentsChange([]);
            setCreatingTier(null);
            setEditingPath('');
            setDeletingPath('');
            setError('');
          }}
          disabled={disabled}
          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-45"
          id="product-store-category-select"
        >
          <option value="">
            {categoryOptions.length > 0
              ? 'Selecione uma categoria'
              : 'Cadastre palavras-chave no perfil da loja'}
          </option>
          {categoryOptions.map(option => (
            <option key={normalizeCatalogCategoryValue(option)} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-3" id="product-category-hierarchy-levels">
        {CATALOG_HIERARCHY_TIERS.map((tierLabel, tierIndex) => {
          const hasParent =
            Boolean(categoryRoot) &&
            (tierIndex === 0 || Boolean(selectedSegments[tierIndex - 1]));
          const parentPath = hasParent
            ? joinCatalogCategoryPath([
                categoryRoot,
                ...selectedSegments.slice(0, tierIndex),
              ])
            : '';
          const children = parentPath
            ? getDirectCatalogHierarchyChildren(paths, parentPath)
            : [];
          const selectedName = selectedSegments[tierIndex] ?? '';
          const selectedPath = selectedName
            ? joinCatalogCategoryPath([
                categoryRoot,
                ...selectedSegments.slice(0, tierIndex + 1),
              ])
            : '';
          const selectedNode = children.find(
            child =>
              normalizeCatalogCategoryValue(child.name) ===
              normalizeCatalogCategoryValue(selectedName)
          );
          const isCreating = creatingTier === tierIndex;
          const isEditing = selectedPath && editingPath === selectedPath;
          const isDeleting = selectedPath && deletingPath === selectedPath;
          const isBusy = Boolean(selectedPath && busyPath === selectedPath);
          const itemCount = selectedPath
            ? products.filter(product => pathStartsWith(product.category, selectedPath)).length
            : 0;

          return (
            <article
              key={tierLabel}
              className={`rounded-2xl border p-3 ${
                selectedName
                  ? 'border-teal-500/25 bg-teal-500/[0.06]'
                  : 'border-slate-800 bg-slate-900/65'
              }`}
              id={`product-hierarchy-tier-${tierIndex + 1}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-[9px] font-black uppercase text-teal-300">
                    {tierLabel}
                  </span>
                  <span className="ml-2 text-[8px] text-slate-600">
                    {children.length}/{MAX_CATALOG_HIERARCHY_CHILDREN}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingTier(isCreating ? null : tierIndex);
                    setNewName('');
                    setEditingPath('');
                    setDeletingPath('');
                    setError('');
                  }}
                  disabled={
                    disabled ||
                    !hasParent ||
                    children.length >= MAX_CATALOG_HIERARCHY_CHILDREN
                  }
                  className="flex min-h-8 items-center gap-1 rounded-lg border border-teal-500/25 bg-teal-500/10 px-2.5 text-[8px] font-black uppercase text-teal-300 disabled:opacity-35"
                  aria-label={`Criar ${tierLabel.toLowerCase()}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Novo
                </button>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <select
                  value={selectedName}
                  onChange={event =>
                    updateTierSelection(tierIndex, event.target.value)
                  }
                  disabled={disabled || !hasParent}
                  className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:opacity-40"
                  aria-label={tierLabel}
                >
                  <option value="">
                    {!hasParent
                      ? `Selecione primeiro ${tierIndex === 0 ? 'a categoria' : CATALOG_HIERARCHY_TIERS[tierIndex - 1].toLowerCase()}`
                      : children.length > 0
                        ? `Selecione ${tierLabel.toLowerCase()}`
                        : `Nenhum ${tierLabel.toLowerCase()} cadastrado`}
                  </option>
                  {children.map(child => (
                    <option
                      key={normalizeCatalogCategoryValue(child.path)}
                      value={child.name}
                    >
                      {child.name}
                    </option>
                  ))}
                </select>

                {selectedNode && !isEditing && !isDeleting && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPath(selectedPath);
                        setEditingName(selectedNode.name);
                        setDeletingPath('');
                        setCreatingTier(null);
                        setError('');
                      }}
                      disabled={disabled}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400 hover:text-teal-300 disabled:opacity-40"
                      aria-label={`Editar ${tierLabel.toLowerCase()} ${selectedNode.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingPath(selectedPath);
                        setEditingPath('');
                        setCreatingTier(null);
                        setError('');
                      }}
                      disabled={disabled}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 disabled:opacity-40"
                      aria-label={`Excluir ${tierLabel.toLowerCase()} ${selectedNode.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              {selectedNode && !isEditing && !isDeleting && (
                <p className="mt-2 flex items-center gap-1.5 truncate text-[8px] text-slate-600">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                  {selectedPath} · {itemCount} item(ns)
                </p>
              )}

              {isCreating && (
                <div className="mt-3 flex gap-2 rounded-xl border border-teal-500/20 bg-slate-950 p-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={event => setNewName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleCreate(tierIndex);
                      }
                      if (event.key === 'Escape') setCreatingTier(null);
                    }}
                    maxLength={40}
                    placeholder={`Nome de ${tierLabel.toLowerCase()}`}
                    className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreate(tierIndex)}
                    disabled={!newName.trim() || Boolean(busyPath)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-slate-950 disabled:opacity-40"
                    aria-label={`Salvar ${tierLabel.toLowerCase()}`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingTier(null)}
                    disabled={Boolean(busyPath)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400"
                    aria-label="Cancelar criação"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {isEditing && (
                <div className="mt-3 flex gap-2 rounded-xl border border-teal-500/20 bg-slate-950 p-2">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={event => setEditingName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleRename(tierIndex, selectedPath);
                      }
                      if (event.key === 'Escape') setEditingPath('');
                    }}
                    maxLength={40}
                    className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRename(tierIndex, selectedPath)}
                    disabled={!editingName.trim() || isBusy}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-slate-950 disabled:opacity-40"
                    aria-label="Salvar novo nome"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPath('')}
                    disabled={isBusy}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400"
                    aria-label="Cancelar edição"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {isDeleting && (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3">
                  <p className="text-[9px] leading-relaxed text-red-100">
                    Excluir <strong>{selectedNode?.name}</strong>? Os produtos não serão apagados; itens e níveis internos serão promovidos para a pasta anterior.
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeletingPath('')}
                      disabled={isBusy}
                      className="min-h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(tierIndex, selectedPath)}
                      disabled={isBusy}
                      className="min-h-9 rounded-lg bg-red-500 px-3 text-[8px] font-black uppercase text-white disabled:opacity-40"
                    >
                      Excluir nível
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
        <span className="block text-[8px] font-black uppercase tracking-wide text-slate-600">
          Caminho do item
        </span>
        <strong className="mt-1 block break-words text-[10px] text-slate-300">
          {joinCatalogCategoryPath([categoryRoot, ...selectedSegments]) ||
            'Categoria ainda não selecionada'}
        </strong>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
