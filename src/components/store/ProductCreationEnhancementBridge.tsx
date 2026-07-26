import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Images, Paperclip } from 'lucide-react';
import type { Product } from '../../types';
import { auth, db } from '../../utils/firebase';
import { parsePublicProducts } from '../../utils/publicProducts';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const splitPath = (value: string): string[] =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);

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

const findLabelControl = <T extends HTMLElement>(labelText: string): T | null => {
  const label = Array.from(document.querySelectorAll('label')).find(candidate =>
    candidate.textContent?.trim().toLocaleLowerCase('pt-BR').startsWith(
      labelText.toLocaleLowerCase('pt-BR')
    )
  );
  const control = label?.parentElement?.querySelector(
    labelText === 'Categoria da loja' ? 'select' : 'input'
  );
  return (control as unknown as T | null) ?? null;
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

export function ProductCreationEnhancementBridge() {
  const [subcategoryHost, setSubcategoryHost] = useState<HTMLElement | null>(null);
  const [imageHost, setImageHost] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<Product[]>(() => readLocalProducts());
  const [selectedRoot, setSelectedRoot] = useState('');
  const [selectedReusablePath, setSelectedReusablePath] = useState('');
  const [imageMenuOpen, setImageMenuOpen] = useState(false);

  const reusablePaths = useMemo(() => {
    const seen = new Set<string>();
    const normalizedRoot = normalize(selectedRoot);

    return products
      .flatMap(product => [
        product.category,
        ...(product.categoryCollections ?? []).map(collection => collection.path),
      ])
      .flatMap(path => {
        const segments = splitPath(path);
        const normalizedPath = normalize(path);
        if (
          segments.length <= 1 ||
          normalize(segments[0]) !== normalizedRoot ||
          seen.has(normalizedPath)
        ) {
          return [];
        }
        seen.add(normalizedPath);
        return [segments.join(' > ')];
      })
      .sort((left, right) => left.localeCompare(right, 'pt-BR'));
  }, [products, selectedRoot]);

  useEffect(() => {
    let unsubscribeProducts = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeProducts();
      unsubscribeProducts = () => undefined;

      if (!user) {
        setProducts(readLocalProducts());
        return;
      }

      unsubscribeProducts = onSnapshot(
        doc(db, 'tenants', user.uid),
        snapshot => {
          const cloudProducts = parsePublicProducts(snapshot.data()?.publicProducts);
          setProducts(cloudProducts.length > 0 ? cloudProducts : readLocalProducts());
        },
        () => setProducts(readLocalProducts())
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, []);

  useEffect(() => {
    let mountedSubcategoryHost: HTMLDivElement | null = null;
    let mountedImageHost: HTMLDivElement | null = null;
    let categorySelect: HTMLSelectElement | null = null;
    let hiddenImageIcon: SVGElement | null = null;
    let imageInput: HTMLInputElement | null = null;

    const sync = (): void => {
      const subcategoryControl = document.getElementById('product-subcategory-control');
      const nextCategorySelect = findLabelControl<HTMLSelectElement>('Categoria da loja');

      if (nextCategorySelect !== categorySelect) {
        categorySelect?.removeEventListener('change', handleCategoryChange);
        categorySelect = nextCategorySelect;
        categorySelect?.addEventListener('change', handleCategoryChange);
        setSelectedRoot(categorySelect?.value ?? '');
      }

      if (subcategoryControl && !mountedSubcategoryHost) {
        mountedSubcategoryHost = document.createElement('div');
        mountedSubcategoryHost.id = 'reusable-product-category-host';
        mountedSubcategoryHost.className = 'mt-3';
        subcategoryControl.children.item(0)?.insertAdjacentElement(
          'afterend',
          mountedSubcategoryHost
        );
        setSubcategoryHost(mountedSubcategoryHost);
      }

      const imageInputCandidate = findLabelControl<HTMLInputElement>('Imagem do item');
      const imageWrapper = imageInputCandidate?.parentElement;
      if (imageWrapper && !mountedImageHost) {
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

      if (!subcategoryControl && mountedSubcategoryHost) {
        mountedSubcategoryHost.remove();
        mountedSubcategoryHost = null;
        setSubcategoryHost(null);
        setSelectedReusablePath('');
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
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      categorySelect?.removeEventListener('change', handleCategoryChange);
      mountedSubcategoryHost?.remove();
      mountedImageHost?.remove();
      if (hiddenImageIcon instanceof SVGElement) hiddenImageIcon.style.display = '';
      if (imageInput) {
        imageInput.style.paddingLeft = '';
        imageInput.style.paddingRight = '';
      }
    };
  }, []);

  const applyReusablePath = (path: string): void => {
    setSelectedReusablePath(path);
    if (!path) return;

    const segments = splitPath(path);
    const tail = segments.slice(1).join(' > ');
    const control = document.getElementById('product-subcategory-control');
    const input = control?.querySelector<HTMLInputElement>('input[type="text"]');
    const addButton = Array.from(
      control?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ).find(button =>
      button.textContent?.trim().toLocaleLowerCase('pt-BR').includes('adicionar')
    );

    if (!input || !addButton || !tail) return;
    setReactInputValue(input, tail);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        addButton.click();
        setSelectedReusablePath('');
      });
    });
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
      {subcategoryHost &&
        createPortal(
          <div className="rounded-2xl border border-teal-500/20 bg-teal-500/[0.06] p-3">
            <label className="flex items-center gap-2 font-mono text-[10px] font-black uppercase text-teal-300">
              <Images className="h-4 w-4" />
              Reutilizar subcategoria ou coleção
            </label>
            <select
              value={selectedReusablePath}
              onChange={event => applyReusablePath(event.target.value)}
              disabled={!selectedRoot || reusablePaths.length === 0}
              className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
              id="reusable-product-category-select"
            >
              <option value="">
                {!selectedRoot
                  ? 'Selecione primeiro a categoria da loja'
                  : reusablePaths.length > 0
                    ? 'Selecione um caminho já cadastrado'
                    : 'Nenhuma subcategoria cadastrada nesta categoria'}
              </option>
              {reusablePaths.map(path => (
                <option key={normalize(path)} value={path}>{path}</option>
              ))}
            </select>
            <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
              Ao selecionar, o caminho existente é inserido no novo item. Você ainda pode acrescentar ou remover níveis antes de cadastrar.
            </p>
          </div>,
          subcategoryHost
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
