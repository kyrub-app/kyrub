import { useEffect } from 'react';

const normalized = (value: string | null): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

const replaceFilterLabels = (): void => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const novas of buttons) {
    if (normalized(novas.textContent) !== 'NOVAS' && normalized(novas.textContent) !== 'EM PROMOÇÃO') {
      continue;
    }
    const parent = novas.parentElement;
    if (!parent) continue;
    const siblings = Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button'));
    const favorite = siblings.find(button => normalized(button.textContent) === 'FAVORITAS');
    const customer = siblings.find(button => {
      const text = normalized(button.textContent);
      return text === 'CLIENTE' || text === 'PARA VOCÊ';
    });
    if (!favorite || !customer) continue;
    novas.textContent = 'Em promoção';
    customer.textContent = 'Para você';
    novas.title = 'Lojas com promoção pública ativa';
    customer.title = 'Lojas em que você já tem histórico de compra confirmado';
    novas.setAttribute('aria-label', 'Filtrar lojas em promoção');
    customer.setAttribute('aria-label', 'Filtrar lojas para você');
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