import { useEffect } from 'react';

const STYLE_ID = 'kyrub-profile-suggestions-grid-style';
const GRID_CLASS = 'kyrub-profile-suggestions-grid';
const CARD_CLASS = 'kyrub-profile-suggestion-card';

const css = `
.${GRID_CLASS} {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 20px 12px !important;
  align-items: start !important;
}

.${CARD_CLASS} {
  position: relative !important;
  display: flex !important;
  min-width: 0 !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: flex-start !important;
  gap: 8px !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  padding: 0 !important;
}

.${CARD_CLASS} > img,
.${CARD_CLASS} > span[role='img'] {
  width: clamp(78px, 24vw, 108px) !important;
  height: clamp(78px, 24vw, 108px) !important;
  aspect-ratio: 1 / 1 !important;
  flex: none !important;
  border-radius: 9999px !important;
  border: 2px solid rgb(30 41 59) !important;
  object-fit: cover !important;
  box-shadow: 0 8px 24px rgb(2 6 23 / .28) !important;
}

.${CARD_CLASS} > div:not(.absolute) {
  width: 100% !important;
  min-height: 0 !important;
  padding: 0 !important;
  text-align: center !important;
}

.${CARD_CLASS} h4 {
  display: block !important;
  width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  font-size: 11px !important;
  line-height: 1.25 !important;
  text-align: center !important;
  text-transform: none !important;
  color: rgb(241 245 249) !important;
}

.${CARD_CLASS} p,
.${CARD_CLASS} div:not(.absolute) > span {
  display: none !important;
}

.${CARD_CLASS} > button {
  margin: 0 !important;
  width: 100% !important;
  min-width: 0 !important;
  height: 32px !important;
  border-radius: 9999px !important;
  padding: 0 7px !important;
  font-size: 8px !important;
  line-height: 1 !important;
  white-space: nowrap !important;
}

.${CARD_CLASS} > button svg {
  width: 13px !important;
  height: 13px !important;
}

@media (max-width: 359px) {
  .${GRID_CLASS} {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .${CARD_CLASS} > img,
  .${CARD_CLASS} > span[role='img'] {
    width: 96px !important;
    height: 96px !important;
  }
}

@media (min-width: 640px) {
  .${GRID_CLASS} {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 24px 16px !important;
  }
}
`;

function applySuggestionsGrid() {
  const titles = Array.from(document.querySelectorAll('h3'));
  const title = titles.find(node => node.textContent?.trim() === 'Novos contatos');
  if (!title) return;

  const modal = title.closest('section');
  if (!modal) return;

  const grids = Array.from(modal.querySelectorAll('div.grid.grid-cols-2')) as HTMLElement[];
  const suggestionsGrid = grids.find(grid => {
    const articles = Array.from(grid.querySelectorAll(':scope > article'));
    if (articles.length === 0) return false;
    return articles.some(article =>
      Array.from(article.querySelectorAll('button')).some(button => {
        const text = button.textContent?.trim().toLocaleLowerCase('pt-BR') ?? '';
        return text.includes('conectar') || text.includes('cancelar');
      })
    );
  });

  if (!suggestionsGrid) return;

  suggestionsGrid.classList.add(GRID_CLASS);
  Array.from(suggestionsGrid.children).forEach(child => {
    if (!(child instanceof HTMLElement) || child.tagName !== 'ARTICLE') return;
    child.classList.add(CARD_CLASS);
  });
}

export function ProfileSuggestionsGridBridge() {
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applySuggestionsGrid();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
