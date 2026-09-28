import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Award,
  Boxes,
  ChevronDown,
  ImagePlus,
  ReceiptText,
  Repeat2,
  SlidersHorizontal,
  Tag,
} from 'lucide-react';

type ShowcaseAccordionSection =
  | 'basic'
  | 'media'
  | 'points'
  | 'sale'
  | 'personalization'
  | 'composition'
  | 'fiscal';

interface ProductShowcaseAccordionBridgeProps {
  isOpen: boolean;
}

const SECTION_OPTIONS: Array<{
  id: ShowcaseAccordionSection;
  label: string;
  description: string;
  order: number;
  icon: typeof Tag;
}> = [
  {
    id: 'basic',
    label: 'Informações básicas',
    description: 'Nome, preço, categoria, tipo e preparo',
    order: 10,
    icon: Tag,
  },
  {
    id: 'media',
    label: 'Imagem e descrição',
    description: 'Foto, apresentação e detalhes públicos',
    order: 20,
    icon: ImagePlus,
  },
  {
    id: 'points',
    label: 'Pontos da loja',
    description: 'Pontuação recebida por unidade comprada',
    order: 30,
    icon: Award,
  },
  {
    id: 'sale',
    label: 'Forma de venda',
    description: 'Compra única ou assinatura recorrente',
    order: 40,
    icon: Repeat2,
  },
  {
    id: 'personalization',
    label: 'Personalizações',
    description: 'Observações rápidas, etapas e escolhas',
    order: 50,
    icon: SlidersHorizontal,
  },
  {
    id: 'composition',
    label: 'Composição',
    description: 'Ficha técnica, componentes, rendimento e custos',
    order: 60,
    icon: Boxes,
  },
  {
    id: 'fiscal',
    label: 'Dados fiscais',
    description: 'Classificação opcional para documentos fiscais',
    order: 70,
    icon: ReceiptText,
  },
];

const sectionForElement = (
  element: HTMLElement
): Exclude<ShowcaseAccordionSection, 'composition'> => {
  if (element.id === 'product-drive-image-control') return 'media';
  if (
    element.querySelector(
      'textarea[placeholder="Descreva o item com suas próprias informações"]'
    )
  ) {
    return 'media';
  }
  if (element.id === 'product-store-points-field-host') return 'points';
  if (element.id === 'product-sale-modality-control') return 'sale';
  if (
    element.id === 'product-quick-notes-control' ||
    element.id === 'product-option-groups-control'
  ) {
    return 'personalization';
  }
  if (element.matches('[data-kyrub-product-fiscal-host]')) return 'fiscal';

  return 'basic';
};

const openComposition = (): void => {
  const compositionButton = document.querySelector<HTMLButtonElement>(
    '[data-kyrub-product-tab="composition"]'
  );
  compositionButton?.click();
};

export function ProductShowcaseAccordionBridge({
  isOpen,
}: ProductShowcaseAccordionBridgeProps) {
  const [activeSection, setActiveSection] =
    useState<Exclude<ShowcaseAccordionSection, 'composition'>>('basic');
  const [host, setHost] = useState<HTMLElement | null>(null);

  const orderBySection = useMemo(
    () =>
      new Map(
        SECTION_OPTIONS.map(section => [section.id, section.order] as const)
      ),
    []
  );

  useEffect(() => {
    if (!isOpen) {
      setHost(null);
      return;
    }
    setActiveSection('basic');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let currentShowcase: HTMLElement | null = null;
    let currentHost: HTMLDivElement | null = null;

    const restoreShowcase = (): void => {
      if (!currentShowcase) return;
      currentShowcase.style.removeProperty('display');
      currentShowcase.style.removeProperty('flex-direction');
      currentShowcase.style.removeProperty('gap');
      currentShowcase.classList.add('space-y-4');
      currentShowcase
        .querySelectorAll<HTMLElement>('[data-kyrub-showcase-accordion-section]')
        .forEach(element => {
          element.hidden = false;
          element.style.removeProperty('order');
          delete element.dataset.kyrubShowcaseAccordionSection;
        });
    };

    const synchronize = (): void => {
      const showcase = document.getElementById('product-showcase-tab');
      if (!(showcase instanceof HTMLElement)) {
        if (currentShowcase) restoreShowcase();
        currentShowcase = null;
        currentHost = null;
        setHost(null);
        return;
      }

      if (currentShowcase && currentShowcase !== showcase) {
        restoreShowcase();
      }
      currentShowcase = showcase;
      showcase.classList.remove('space-y-4');
      showcase.style.display = 'flex';
      showcase.style.flexDirection = 'column';
      showcase.style.gap = '0.75rem';

      let nextHost = showcase.querySelector<HTMLDivElement>(
        '#product-showcase-accordion-host'
      );
      if (!nextHost) {
        nextHost = document.createElement('div');
        nextHost.id = 'product-showcase-accordion-host';
        nextHost.style.display = 'contents';
        showcase.prepend(nextHost);
      }
      currentHost = nextHost;
      setHost(previous => (previous === nextHost ? previous : nextHost));

      Array.from(showcase.children).forEach(child => {
        if (!(child instanceof HTMLElement) || child === nextHost) return;
        const section = sectionForElement(child);
        child.dataset.kyrubShowcaseAccordionSection = section;
        child.style.order = String((orderBySection.get(section) ?? 10) + 1);
        child.hidden = section !== activeSection;
      });
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      restoreShowcase();
      currentHost?.remove();
      currentHost = null;
      currentShowcase = null;
      setHost(null);
    };
  }, [activeSection, isOpen, orderBySection]);

  if (!host) return null;

  return createPortal(
    <>
      {SECTION_OPTIONS.map(section => {
        const Icon = section.icon;
        const isComposition = section.id === 'composition';
        const active = !isComposition && activeSection === section.id;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => {
              if (isComposition) {
                openComposition();
                return;
              }
              setActiveSection(section.id);
            }}
            aria-expanded={active}
            aria-controls={
              isComposition
                ? 'product-inventory-tab'
                : `product-showcase-accordion-${section.id}`
            }
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
              active
                ? 'border-orange-500/50 bg-orange-500/10'
                : isComposition
                  ? 'border-cyan-500/25 bg-cyan-500/[0.04] hover:border-cyan-500/45'
                  : 'border-slate-800 bg-slate-950/65 hover:border-slate-700'
            }`}
            style={{ order: section.order }}
            id={`product-showcase-accordion-${section.id}`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                active
                  ? 'bg-orange-500/15 text-orange-300'
                  : isComposition
                    ? 'bg-cyan-500/10 text-cyan-300'
                    : 'bg-slate-900 text-slate-500'
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[10px] font-black uppercase tracking-wide text-white">
                {section.label}
              </strong>
              <span className="mt-0.5 block text-[9px] leading-relaxed text-slate-500">
                {section.description}
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                active ? 'rotate-180 text-orange-300' : ''
              } ${isComposition ? '-rotate-90 text-cyan-300' : ''}`}
            />
          </button>
        );
      })}
    </>,
    host
  );
}
