import { useEffect } from 'react';

interface ProductModalArchitectureBridgeProps {
  isOpen: boolean;
}

const setButtonLabel = (button: HTMLButtonElement, label: string): void => {
  const labelSpan = button.querySelector<HTMLSpanElement>('span');
  if (!labelSpan) return;
  const textNode = Array.from(labelSpan.childNodes).find(
    node => node.nodeType === Node.TEXT_NODE
  );
  if (textNode) textNode.textContent = ` ${label}`;
};

const setButtonDescription = (
  button: HTMLButtonElement,
  description: string
): void => {
  const spans = button.querySelectorAll<HTMLSpanElement>(':scope > span');
  const descriptionSpan = spans.item(1);
  if (descriptionSpan) descriptionSpan.textContent = description;
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
          'Defina o que você vende e, quando necessário, do que este item é feito. Estoque e compras são operações globais da loja.';
      }

      const tabs = document.getElementById('unified-product-modal-tabs');
      const buttons = tabs?.querySelectorAll<HTMLButtonElement>('button') ?? [];
      buttons.forEach(button => {
        const text = button.textContent ?? '';
        if (text.includes('Itens da vitrine') || button.dataset.kyrubProductTab === 'product') {
          button.dataset.kyrubProductTab = 'product';
          button.style.removeProperty('display');
          setButtonLabel(button, 'Produto');
          setButtonDescription(button, 'Identidade, venda e apresentação');
        } else if (text.includes('Estoque') || button.dataset.kyrubProductTab === 'composition') {
          button.dataset.kyrubProductTab = 'composition';
          button.style.removeProperty('display');
          setButtonLabel(button, 'Composição');
          setButtonDescription(button, 'Ficha técnica, kit, consumo e custos');
        } else if (text.includes('Lista de compras') || button.dataset.kyrubProductTab === 'purchase') {
          button.dataset.kyrubProductTab = 'purchase';
          button.style.display = 'none';
        }
      });

      const inventoryTab = document.getElementById('product-inventory-tab');
      if (inventoryTab instanceof HTMLElement) {
        let note = inventoryTab.querySelector<HTMLDivElement>(
          '#product-composition-architecture-note'
        );
        if (!note) {
          note = document.createElement('div');
          note.id = 'product-composition-architecture-note';
          note.className =
            'rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] px-4 py-3 text-[10px] leading-relaxed text-cyan-100';
          note.textContent =
            'Aqui você define a composição deste produto. Cadastre e movimente saldos, mínimos, custos e fornecedores na guia Estoque da loja.';
          inventoryTab.prepend(note);
        }

        const catalogSection = document.getElementById('inventory-catalog-accordion');
        if (catalogSection instanceof HTMLElement) {
          catalogSection.style.display = 'none';
        }

        const componentsSection = document.getElementById('inventory-components-accordion');
        if (componentsSection instanceof HTMLElement) {
          const emptyButton = Array.from(
            componentsSection.querySelectorAll<HTMLButtonElement>('button')
          ).find(button => (button.textContent ?? '').includes('Cadastrar insumo'));
          if (emptyButton) emptyButton.style.display = 'none';
          const emptyParagraph = Array.from(
            componentsSection.querySelectorAll<HTMLParagraphElement>('p')
          ).find(paragraph =>
            (paragraph.textContent ?? '').includes('Cadastre primeiro um insumo')
          );
          if (emptyParagraph) {
            emptyParagraph.textContent =
              'Nenhum item de estoque disponível. Cadastre-o primeiro na guia Estoque da loja.';
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
