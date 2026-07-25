import { useEffect, useMemo } from 'react';
import type { Store } from '../types';

interface StoreOfferCardPresentationBridgeProps {
  stores: Store[];
  enabled: boolean;
}

const normalizeStoreName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const formatStoreKeywords = (keywords: string[] | undefined): string => {
  const normalizedKeywords = (keywords ?? [])
    .map(keyword => keyword.trim())
    .filter(Boolean)
    .slice(0, 6);

  return normalizedKeywords.length > 0
    ? normalizedKeywords.join(' • ')
    : 'Palavras-chave não informadas';
};

export function StoreOfferCardPresentationBridge({
  stores,
  enabled,
}: StoreOfferCardPresentationBridgeProps) {
  const keywordsByStoreName = useMemo(() => {
    const nextKeywords = new Map<string, string>();

    for (const store of stores) {
      nextKeywords.set(
        normalizeStoreName(store.name),
        formatStoreKeywords(store.keywords)
      );
    }

    return nextKeywords;
  }, [stores]);

  useEffect(() => {
    if (!enabled) return;

    let animationFrame = 0;

    const applyCardPresentation = () => {
      animationFrame = 0;
      const root = document.getElementById('kyrub-tab-container');
      if (!root) return;

      const cards = root.querySelectorAll<HTMLElement>(
        ':scope > .space-y-4.animate-fade-in > .grid.grid-cols-2 > article'
      );

      cards.forEach(card => {
        const heading = card.querySelector('h3');
        const description = heading?.nextElementSibling;
        const metadata = description?.nextElementSibling;

        if (!(heading instanceof HTMLElement) || !(metadata instanceof HTMLElement)) {
          return;
        }

        const storeName = normalizeStoreName(heading.textContent ?? '');
        const keywords =
          keywordsByStoreName.get(storeName) ?? 'Palavras-chave não informadas';

        card.dataset.offerStoreCard = 'true';
        metadata.dataset.storeKeywords = keywords;
        metadata.setAttribute('aria-label', `Palavras-chave da loja: ${keywords}`);
      });
    };

    const scheduleCardPresentation = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(applyCardPresentation);
    };

    scheduleCardPresentation();

    const observer = new MutationObserver(scheduleCardPresentation);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [enabled, keywordsByStoreName]);

  return null;
}
