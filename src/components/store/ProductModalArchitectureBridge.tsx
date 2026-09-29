import { useEffect } from 'react';

interface ProductModalArchitectureBridgeProps {
  isOpen: boolean;
}

const identifyLegacyTabs = (tabs: HTMLElement): void => {
  const buttons = tabs.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach(button => {
    const text = button.textContent ?? '';
    if (
      text.includes('Itens da vitrine') ||
      text.includes('Produto') ||
      button.dataset.kyrubProductTab === 'product'
    ) {
      button.dataset.kyrubProductTab = 'product';
    } else if (
      text.includes('Estoque') ||
      text.includes('Composição') ||
      button.dataset.kyrubProductTab === 'composition'
    ) {
      button.dataset.kyrubProductTab = 'composition';
    } else if (
      text.includes('Lista de compras') ||
      button.dataset.kyrubProductTab === 'purchase'
    ) {
      button.dataset.kyrubProductTab = 'purchase';
    }
  });
};

const createCompositionBackControl = (
  inventoryTab: HTMLElement
): HTMLDivElement => {
  const control = document.createElement('div');
  control.id = 'product-composition-back-control';
  control.className =
    'mb-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/65 px-3 py-3';

  const copy = document.createElement('div');
  copy.className = 'min-w-0';

  const title = document.createElement('strong');
  title.className =
    'block text-[10px] font-black uppercase tracking-wide text-white';
  title.textContent = 'Composição do item';

  const description = document.createElement('span');
  description.className =
    'mt-0.5 block text-[9px] leading-relaxed text-slate-500';
  description.textContent =
    'Ficha técnica, componentes, rendimento e custos deste produto.';

  copy.append(title, description);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className =
    'min-h-9 shrink-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[8px] font-black uppercase text-slate-300';
  backButton.textContent = '← Produto';
  backButton.addEventListener('click', () => {
    const productButton = document.querySelector<HTMLButtonElement>(
      '[data-kyrub-product-tab="product"]'
    );
    productButton?.click();
  });

  control.append(copy, backButton);
  inventoryTab.prepend(control);
  return control;
};

export function ProductModalArchitectureBridge({
  isOpen,
}: ProductModalArchitectureBridgeProps) {
  useEffect(() => {
    if (!isOpen) return;

    let frame = 0;

    const synchronize = (): void => {
      frame = 0;
      const modal = document.getElementById('unified-product-modal');
      if (!(modal instanceof HTMLElement)) return;

      const header = modal.querySelector('header');
      const kicker = header?.querySelector<HTMLSpanElement>('span');
      const description = header?.querySelector<HTMLParagraphElement>('p');
      if (kicker) kicker.textContent = 'Cadastro do produto';
      if (description) {
        description.textContent =
          'Edite os dados do item. Estoque e compras são operações da loja; aqui ficam apenas os dados e a composição deste produto.';
      }

      const tabs = document.getElementById('unified-product-modal-tabs');
      if (tabs instanceof HTMLElement) {
        identifyLegacyTabs(tabs);
        tabs.style.display = 'none';
      }

      const inventoryTab = document.getElementById('product-inventory-tab');
      if (inventoryTab instanceof HTMLElement) {
        const oldNote = inventoryTab.querySelector(
          '#product-composition-architecture-note'
        );
        oldNote?.remove();

        if (!inventoryTab.querySelector('#product-composition-back-control')) {
          createCompositionBackControl(inventoryTab);
        }

        const catalogSection = document.getElementById(
          'inventory-catalog-accordion'
        );
        if (catalogSection instanceof HTMLElement) {
          catalogSection.style.display = 'none';
        }

        const componentsSection = document.getElementById(
          'inventory-components-accordion'
        );
        if (componentsSection instanceof HTMLElement) {
          const emptyButton = Array.from(
            componentsSection.querySelectorAll<HTMLButtonElement>('button')
          ).find(button =>
            (button.textContent ?? '').includes('Cadastrar insumo')
          );
          if (emptyButton) emptyButton.style.display = 'none';

          const emptyParagraph = Array.from(
            componentsSection.querySelectorAll<HTMLParagraphElement>('p')
          ).find(paragraph =>
            (paragraph.textContent ?? '').includes('Cadastre primeiro um insumo')
          );
          if (emptyParagraph) {
            emptyParagraph.textContent =
              'Nenhum item de estoque disponível. Cadastre-o primeiro em Estoque, fora deste produto.';
          }
        }

        if (inventoryTab.dataset.kyrubCompositionInitialized !== 'true') {
          inventoryTab.dataset.kyrubCompositionInitialized = 'true';
          const compositionButton = document.querySelector<HTMLButtonElement>(
            '#inventory-composition-accordion > button'
          );
          if (compositionButton?.getAttribute('aria-expanded') === 'false') {
            compositionButton.click();
          }
        }
      }
    };

    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  return null;
}
