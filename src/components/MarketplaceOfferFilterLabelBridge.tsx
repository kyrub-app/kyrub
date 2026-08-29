import { useEffect } from 'react';

const normalized = (value: string | null): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

const replaceFilterLabels = (): void => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const promotionButton of buttons) {
    const promotionText = normalized(promotionButton.textContent);
    if (promotionText !== 'NOVAS' && promotionText !== 'EM PROMOÇÃO') {
      continue;
    }
    const parent = promotionButton.parentElement;
    if (!parent) continue;
    const siblings = Array.from(
      parent.querySelectorAll<HTMLButtonElement>(':scope > button')
    );
    const favorite = siblings.find(
      button => normalized(button.textContent) === 'FAVORITAS'
    );
    const forYouButton = siblings.find(button => {
      const text = normalized(button.textContent);
      return text === 'CLIENTE' || text === 'PARA VOCÊ';
    });
    if (!favorite || !forYouButton) continue;

    if (promotionText !== 'EM PROMOÇÃO') {
      promotionButton.textContent = 'Em promoção';
    }
    if (normalized(forYouButton.textContent) !== 'PARA VOCÊ') {
      forYouButton.textContent = 'Para você';
    }
    promotionButton.title = 'Lojas com promoção pública ativa';
    forYouButton.title = 'Lojas em que você já tem histórico de compra confirmado';
    promotionButton.setAttribute('aria-label', 'Filtrar lojas em promoção');
    forYouButton.setAttribute('aria-label', 'Filtrar lojas para você');
    return;
  }
};

export function MarketplaceOfferFilterLabelBridge({
  enabled,
}: {
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    replaceFilterLabels();
    const observer = new MutationObserver(replaceFilterLabels);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  return null;
}