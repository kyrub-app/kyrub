import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { GuidedWizardStep } from '../wizard/GuidedWizard';

interface ProductCreateWizardBridgeProps {
  isOpen: boolean;
  isSaving: boolean;
}

const STEPS: GuidedWizardStep[] = [
  {
    id: 'identity',
    label: 'Etapa 1',
    title: 'Identificação',
    prompt: 'Vamos começar pelo básico: nome do item e onde ele ficará organizado no seu catálogo.',
  },
  {
    id: 'presentation',
    label: 'Etapa 2',
    title: 'Apresentação',
    prompt: 'Agora deixe o item fácil de reconhecer: imagem e uma descrição curta para a vitrine.',
  },
  {
    id: 'sales',
    label: 'Etapa 3',
    title: 'Preço e venda',
    prompt: 'Defina como este item será vendido, incluindo preço, observações e opcionais.',
  },
  {
    id: 'production',
    label: 'Etapa 4',
    title: 'Produção',
    prompt: 'Escolha para qual estação de preparo este item deve ser encaminhado quando houver um pedido.',
  },
  {
    id: 'inventory',
    label: 'Etapa 5',
    title: 'Estoque e ficha técnica',
    prompt: 'Se o item consumir insumos, monte aqui a composição. Para serviços ou itens sem composição, você pode apenas continuar.',
  },
  {
    id: 'fiscal',
    label: 'Etapa 6',
    title: 'Dados fiscais',
    prompt: 'Esta etapa é opcional. Preencha a classificação fiscal se quiser preparar este item para emissão de documentos no futuro.',
  },
  {
    id: 'review',
    label: 'Etapa 7',
    title: 'Revisão',
    prompt: 'Confira o essencial antes de cadastrar. Você pode voltar a qualquer etapa para ajustar alguma informação.',
  },
];

const setElementVisible = (element: Element | null, visible: boolean): void => {
  if (!(element instanceof HTMLElement)) return;
  if (visible) {
    element.style.removeProperty('display');
    element.removeAttribute('aria-hidden');
  } else {
    element.style.setProperty('display', 'none', 'important');
    element.setAttribute('aria-hidden', 'true');
  }
};

const findTabButton = (modal: HTMLElement, label: string): HTMLButtonElement | null =>
  Array.from(
    modal.querySelectorAll<HTMLButtonElement>('#unified-product-modal-tabs button')
  ).find(button =>
    button.textContent?.toLocaleLowerCase('pt-BR').includes(label)
  ) ?? null;

const readValue = (root: ParentNode, selector: string): string => {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  return field?.value?.trim() ?? '';
};

export function ProductCreateWizardBridge({
  isOpen,
  isSaving,
}: ProductCreateWizardBridgeProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [topHost, setTopHost] = useState<HTMLElement | null>(null);
  const [reviewHost, setReviewHost] = useState<HTMLElement | null>(null);
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);
  const [revision, setRevision] = useState(0);

  const activeStep = STEPS[activeIndex];
  const progress = Math.round(((activeIndex + 1) / STEPS.length) * 100);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      setTopHost(null);
      setReviewHost(null);
      setFooterHost(null);
      return;
    }

    setActiveIndex(0);
    let observer: MutationObserver | null = null;
    let formListener: EventListener | null = null;
    let boundForm: HTMLFormElement | null = null;

    const decorate = (): void => {
      const modal = document.getElementById('unified-product-modal');
      const section = modal?.querySelector<HTMLElement>(':scope > section');
      const form = section?.querySelector<HTMLFormElement>('form');
      const header = section?.querySelector<HTMLElement>(':scope > header');
      const tabs = section?.querySelector<HTMLElement>('#unified-product-modal-tabs');
      const originalFooter = form?.querySelector<HTMLElement>(':scope > footer');
      if (!modal || !section || !form || !header || !tabs || !originalFooter) return;

      modal.dataset.productCreateWizard = 'true';
      tabs.style.setProperty('display', 'none', 'important');
      header.style.setProperty('display', 'none', 'important');
      originalFooter.style.setProperty('display', 'none', 'important');

      let nextTopHost = section.querySelector<HTMLElement>('[data-product-create-wizard-top]');
      if (!nextTopHost) {
        nextTopHost = document.createElement('div');
        nextTopHost.dataset.productCreateWizardTop = 'true';
        section.insertBefore(nextTopHost, form);
      }

      let nextReviewHost = form.querySelector<HTMLElement>('[data-product-create-wizard-review]');
      if (!nextReviewHost) {
        nextReviewHost = document.createElement('div');
        nextReviewHost.dataset.productCreateWizardReview = 'true';
        form.insertBefore(nextReviewHost, originalFooter);
      }

      let nextFooterHost = section.querySelector<HTMLElement>('[data-product-create-wizard-footer]');
      if (!nextFooterHost) {
        nextFooterHost = document.createElement('div');
        nextFooterHost.dataset.productCreateWizardFooter = 'true';
        section.appendChild(nextFooterHost);
      }

      setTopHost(current => current === nextTopHost ? current : nextTopHost);
      setReviewHost(current => current === nextReviewHost ? current : nextReviewHost);
      setFooterHost(current => current === nextFooterHost ? current : nextFooterHost);

      if (boundForm !== form) {
        if (boundForm && formListener) {
          boundForm.removeEventListener('input', formListener, true);
          boundForm.removeEventListener('change', formListener, true);
        }
        formListener = () => setRevision(current => current + 1);
        form.addEventListener('input', formListener, true);
        form.addEventListener('change', formListener, true);
        boundForm = form;
      }
    };

    decorate();
    observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      if (boundForm && formListener) {
        boundForm.removeEventListener('input', formListener, true);
        boundForm.removeEventListener('change', formListener, true);
      }
      document.querySelectorAll<HTMLElement>('[data-product-create-wizard-top], [data-product-create-wizard-review], [data-product-create-wizard-footer]')
        .forEach(element => element.remove());
      const modal = document.getElementById('unified-product-modal');
      if (modal) delete modal.dataset.productCreateWizard;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const modal = document.getElementById('unified-product-modal');
    if (!modal) return;

    const needsInventory = activeStep.id === 'inventory';
    const tabButton = findTabButton(modal, needsInventory ? 'estoque' : 'itens da vitrine');
    tabButton?.click();

    window.setTimeout(() => {
      const showcase = modal.querySelector<HTMLElement>('#product-showcase-tab');
      const inventory = modal.querySelector<HTMLElement>('#product-inventory-tab');
      const fiscal = modal.querySelector<HTMLElement>('#product-fiscal-data-section');
      const review = modal.querySelector<HTMLElement>('[data-product-create-wizard-review]');

      if (inventory) {
        setElementVisible(inventory, activeStep.id === 'inventory');
      }
      if (review) {
        setElementVisible(review, activeStep.id === 'review');
      }
      if (!showcase) return;

      const children = Array.from(showcase.children).filter(
        child => !(child instanceof HTMLElement && child.dataset.kyrubProductFiscalHost === 'true')
      );

      children.forEach((child, index) => {
        let visible = false;
        if (activeStep.id === 'identity') visible = index === 0 || index === 2;
        if (activeStep.id === 'presentation') visible = index === 4 || index === 5;
        if (activeStep.id === 'sales') visible = index === 1 || index === 6 || index >= 7;
        if (activeStep.id === 'production') visible = index === 3;
        setElementVisible(child, visible);
      });

      const fiscalHost = showcase.querySelector<HTMLElement>('[data-kyrub-product-fiscal-host]');
      setElementVisible(fiscalHost, activeStep.id === 'fiscal');
      if (fiscal) fiscal.open = activeStep.id === 'fiscal';
    }, 0);
  }, [activeIndex, activeStep.id, isOpen, revision]);

  const reviewData = useMemo(() => {
    void revision;
    const modal = document.getElementById('unified-product-modal');
    if (!modal) return { name: '', price: '', category: '', description: '', station: '' };
    const showcase = modal.querySelector<HTMLElement>('#product-showcase-tab');
    if (!showcase) return { name: '', price: '', category: '', description: '', station: '' };
    const inputs = Array.from(showcase.querySelectorAll<HTMLInputElement>('input'));
    const name = inputs.find(input => input.placeholder?.includes('Nome do produto'))?.value.trim() ?? '';
    const price = inputs.find(input => input.type === 'number')?.value.trim() ?? '';
    const categorySelect = showcase.querySelector<HTMLSelectElement>('select');
    const description = showcase.querySelector<HTMLTextAreaElement>('textarea')?.value.trim() ?? '';
    const station = showcase.querySelector<HTMLElement>('#product-preparation-station-control')
      ?.querySelector<HTMLSelectElement>('select')?.value.trim() ?? '';
    return {
      name,
      price,
      category: categorySelect?.selectedOptions[0]?.textContent?.trim() ?? '',
      description,
      station,
    };
  }, [revision, activeIndex]);

  const canContinue = useMemo(() => {
    void revision;
    if (!isOpen) return false;
    const modal = document.getElementById('unified-product-modal');
    if (!modal) return false;
    const showcase = modal.querySelector<HTMLElement>('#product-showcase-tab');
    if (!showcase) return activeStep.id === 'inventory';

    if (activeStep.id === 'identity') {
      const name = Array.from(showcase.querySelectorAll<HTMLInputElement>('input'))
        .find(input => input.placeholder?.includes('Nome do produto'))?.value.trim() ?? '';
      const categorySelect = showcase.querySelector<HTMLSelectElement>('select');
      return Boolean(name && categorySelect?.value.trim());
    }

    if (activeStep.id === 'sales') {
      const complimentary = showcase.querySelector<HTMLInputElement>('#product-complimentary-control input[type="checkbox"]')?.checked === true;
      const priceInput = Array.from(showcase.querySelectorAll<HTMLInputElement>('input'))
        .find(input => input.type === 'number');
      const parsedPrice = Number.parseFloat((priceInput?.value ?? '').replace(',', '.'));
      return complimentary || (Number.isFinite(parsedPrice) && parsedPrice >= 0);
    }

    return true;
  }, [activeStep.id, activeIndex, isOpen, revision]);

  if (!isOpen || !topHost || !reviewHost || !footerHost) return null;

  const goNext = (): void => {
    if (!canContinue || isSaving) return;
    if (activeIndex < STEPS.length - 1) {
      setActiveIndex(current => current + 1);
      return;
    }
    document
      .getElementById('save-unified-product-button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  const top = createPortal(
    <div className="mb-4 overflow-hidden rounded-3xl border border-violet-500/20 bg-slate-950">
      <div className="border-b border-slate-800 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-300">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">
              Kyrubia · Cadastro guiado
            </span>
            <h2 className="mt-1 text-xl font-black text-white">Cadastrar novo item</h2>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="font-mono text-[9px] font-black text-slate-500">{activeIndex + 1}/{STEPS.length}</span>
        </div>
      </div>
      <div className="bg-violet-500/[0.06] p-4">
        <span className="text-[9px] font-black uppercase tracking-wider text-violet-300">{activeStep.label}</span>
        <h3 className="mt-1 text-lg font-black text-white">{activeStep.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{activeStep.prompt}</p>
      </div>
    </div>,
    topHost
  );

  const review = createPortal(
    <div className="space-y-3 rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['Item', reviewData.name || 'Não informado'],
          ['Categoria', reviewData.category || 'Não informada'],
          ['Preço', reviewData.price ? `R$ ${reviewData.price}` : 'Sem preço informado'],
          ['Estação', reviewData.station || 'Geral'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <span className="block text-[9px] font-black uppercase text-slate-500">{label}</span>
            <strong className="mt-1 block text-sm text-white">{value}</strong>
          </div>
        ))}
      </div>
      {reviewData.description && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <span className="block text-[9px] font-black uppercase text-slate-500">Descrição</span>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{reviewData.description}</p>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-slate-500">
        Estoque, ficha técnica, opcionais e dados fiscais permanecem no mesmo cadastro e serão validados pela rotina original ao concluir.
      </p>
    </div>,
    reviewHost
  );

  const footer = createPortal(
    <div className="mt-4 grid grid-cols-[auto_1fr] gap-3 border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={() => setActiveIndex(current => Math.max(0, current - 1))}
        disabled={activeIndex === 0 || isSaving}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-xs font-black uppercase text-slate-300 disabled:opacity-35"
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>
      <button
        type="button"
        onClick={goNext}
        disabled={!canContinue || isSaving}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 text-xs font-black uppercase text-white disabled:opacity-40"
      >
        {isSaving
          ? 'Salvando...'
          : activeIndex === STEPS.length - 1
            ? 'Cadastrar item'
            : 'Continuar'}
        {activeIndex === STEPS.length - 1
          ? <Check className="h-4 w-4" />
          : <ChevronRight className="h-4 w-4" />}
      </button>
    </div>,
    footerHost
  );

  return <>{top}{review}{footer}</>;
}
