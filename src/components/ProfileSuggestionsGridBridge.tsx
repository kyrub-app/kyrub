import { useEffect } from 'react';

const STYLE_ID = 'kyrub-profile-suggestions-grid-style';
const GRID_CLASS = 'kyrub-profile-suggestions-grid';
const CARD_CLASS = 'kyrub-profile-suggestion-card';
const PROFILE_CLASS = 'kyrub-profile-suggestion-profile';
const ACTIONS_CLASS = 'kyrub-profile-suggestion-actions';

const css = `
.${GRID_CLASS} {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 18px 12px !important;
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
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  padding: 0 !important;
  overflow: visible !important;
}

.${PROFILE_CLASS} {
  display: flex !important;
  width: 100% !important;
  min-width: 0 !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 8px !important;
  text-align: center !important;
}

.${PROFILE_CLASS} > img,
.${PROFILE_CLASS} > span[role='img'] {
  width: clamp(74px, 24vw, 108px) !important;
  height: clamp(74px, 24vw, 108px) !important;
  flex: none !important;
  border-radius: 9999px !important;
  border: 2px solid rgb(30 41 59) !important;
  object-fit: cover !important;
  box-shadow: 0 8px 28px rgb(2 6 23 / .28) !important;
}

.${PROFILE_CLASS} > span:last-child {
  width: 100% !important;
  min-width: 0 !important;
}

.${PROFILE_CLASS} strong {
  display: block !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  font-size: 11px !important;
  line-height: 1.25 !important;
  text-transform: none !important;
  color: rgb(241 245 249) !important;
}

.${PROFILE_CLASS} strong + span {
  display: none !important;
}

.${ACTIONS_CLASS} {
  display: flex !important;
  width: 100% !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
}

.${ACTIONS_CLASS} > button:first-child {
  min-width: 0 !important;
  flex: 1 1 auto !important;
  border-radius: 9999px !important;
  padding: 7px 7px !important;
  font-size: 8px !important;
  line-height: 1 !important;
  white-space: nowrap !important;
}

.${ACTIONS_CLASS} > button:last-child {
  position: absolute !important;
  top: 2px !important;
  right: 2px !important;
  width: 28px !important;
  height: 28px !important;
  border-radius: 9999px !important;
  border-color: rgb(255 255 255 / .12) !important;
  background: rgb(2 6 23 / .72) !important;
  color: rgb(226 232 240) !important;
  backdrop-filter: blur(8px) !important;
}

.${CARD_CLASS} > div.absolute {
  top: 30px !important;
  right: 0 !important;
  z-index: 50 !important;
}

@media (max-width: 359px) {
  .${GRID_CLASS} {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .${PROFILE_CLASS} > img,
  .${PROFILE_CLASS} > span[role='img'] {
    width: 96px !important;
    height: 96px !important;
  }
}

@media (min-width: 640px) {
  .${GRID_CLASS} {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 22px 16px !important;
  }
}
`;

function applySuggestionsGrid() {
  const titles = Array.from(document.querySelectorAll('h3'));
  const title = titles.find(node => node.textContent?.trim() === 'Sugestões');
  if (!title) return;

  const modal = title.closest('section');
  if (!modal) return;

  const scroller = Array.from(modal.children).find(child =>
    child instanceof HTMLElement && child.classList.contains('overflow-y-auto')
  ) as HTMLElement | undefined;
  if (!scroller) return;

  const grid = Array.from(scroller.children).find(child => {
    if (!(child instanceof HTMLElement)) return false;
    return child.querySelector(':scope > article') !== null;
  }) as HTMLElement | undefined;
  if (!grid) return;

  grid.classList.add(GRID_CLASS);

  Array.from(grid.children).forEach(child => {
    if (!(child instanceof HTMLElement) || child.tagName !== 'ARTICLE') return;
    child.classList.add(CARD_CLASS);

    const directButtons = Array.from(child.children).filter(
      node => node instanceof HTMLButtonElement
    ) as HTMLButtonElement[];
    const profileButton = directButtons[0];
    profileButton?.classList.add(PROFILE_CLASS);

    const actions = Array.from(child.children).find(node => {
      if (!(node instanceof HTMLElement) || node.tagName !== 'DIV') return false;
      return node.querySelector(':scope > button') !== null && !node.classList.contains('absolute');
    }) as HTMLElement | undefined;
    actions?.classList.add(ACTIONS_CLASS);
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
