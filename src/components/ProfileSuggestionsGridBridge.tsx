import { useEffect } from 'react';

const STYLE_ID = 'kyrub-profile-suggestions-grid-style';
const GRID_CLASS = 'kyrub-profile-suggestions-grid';
const CARD_CLASS = 'kyrub-profile-suggestion-card';
const PEOPLE_GRID_CLASS = 'kyrub-profile-people-grid';
const PEOPLE_CARD_CLASS = 'kyrub-profile-person-card';
const REQUEST_GRID_CLASS = 'kyrub-profile-request-grid';
const REQUEST_CARD_CLASS = 'kyrub-profile-request-card';
const GROUPS_GRID_CLASS = 'kyrub-profile-groups-grid';
const GROUP_CARD_CLASS = 'kyrub-profile-group-card';

const css = `
.${GRID_CLASS},
.${PEOPLE_GRID_CLASS},
.${REQUEST_GRID_CLASS} {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 20px 12px !important;
  align-items: start !important;
}

.${CARD_CLASS},
.${PEOPLE_CARD_CLASS},
.${REQUEST_CARD_CLASS} {
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
  min-height: 0 !important;
}

.${CARD_CLASS} > img,
.${CARD_CLASS} > span[role='img'],
.${REQUEST_CARD_CLASS} > div:first-child img,
.${REQUEST_CARD_CLASS} > div:first-child span[role='img'] {
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

.${CARD_CLASS} h4,
.${REQUEST_CARD_CLASS} h4 {
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
.${CARD_CLASS} div:not(.absolute) > span,
.${REQUEST_CARD_CLASS} p {
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

/* Geral e Frequentes: a foto vira a peça principal, como uma galeria de pessoas. */
.${PEOPLE_CARD_CLASS} > div:first-child {
  width: 100% !important;
  overflow: visible !important;
}

.${PEOPLE_CARD_CLASS} > div:first-child > img,
.${PEOPLE_CARD_CLASS} > div:first-child > span[role='img'] {
  width: clamp(78px, 24vw, 108px) !important;
  height: clamp(78px, 24vw, 108px) !important;
  margin: 0 auto !important;
  aspect-ratio: 1 / 1 !important;
  border-radius: 9999px !important;
  object-fit: cover !important;
  border: 2px solid rgb(30 41 59) !important;
}

.${PEOPLE_CARD_CLASS} > div:first-child > span,
.${PEOPLE_CARD_CLASS} > div:nth-child(2) p {
  display: none !important;
}

.${PEOPLE_CARD_CLASS} > div:first-child button {
  top: 0 !important;
  right: 2px !important;
  width: 30px !important;
  height: 30px !important;
}

.${PEOPLE_CARD_CLASS} > div:nth-child(2) {
  min-height: 0 !important;
  width: 100% !important;
  padding: 0 !important;
  text-align: center !important;
}

.${PEOPLE_CARD_CLASS} > div:nth-child(2) h4 {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  font-size: 11px !important;
  text-align: center !important;
}

.${PEOPLE_CARD_CLASS} > div:last-child {
  display: grid !important;
  width: 100% !important;
  grid-template-columns: minmax(0, 1fr) 30px !important;
  gap: 4px !important;
  border: 0 !important;
  padding: 0 !important;
}

.${PEOPLE_CARD_CLASS} > div:last-child > button:first-child {
  height: 32px !important;
  border-radius: 9999px !important;
  padding: 0 6px !important;
  font-size: 8px !important;
}

.${PEOPLE_CARD_CLASS} > div:last-child > button:last-child {
  width: 30px !important;
  height: 30px !important;
  border-radius: 9999px !important;
}

/* Solicitações também entram na mesma linguagem visual. */
.${REQUEST_CARD_CLASS} > div:first-child {
  display: flex !important;
  width: 100% !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 8px !important;
  text-align: center !important;
}

.${REQUEST_CARD_CLASS} > div:first-child > div:last-child {
  width: 100% !important;
  min-width: 0 !important;
}

.${REQUEST_CARD_CLASS} > div:last-child {
  display: grid !important;
  width: 100% !important;
  grid-template-columns: 1fr !important;
  gap: 4px !important;
  margin: 0 !important;
}

.${REQUEST_CARD_CLASS} > div:last-child button {
  height: 29px !important;
  border-radius: 9999px !important;
  padding: 0 5px !important;
  font-size: 7px !important;
}

/* Grupos: o formulário fica inteiro e os grupos passam a ocupar uma grade compacta. */
.${GROUPS_GRID_CLASS} {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 12px !important;
}

.${GROUPS_GRID_CLASS} > form,
.${GROUPS_GRID_CLASS} > div:not(.${GROUP_CARD_CLASS}) {
  grid-column: 1 / -1 !important;
}

.${GROUP_CARD_CLASS} {
  min-width: 0 !important;
  margin: 0 !important;
  padding: 12px !important;
  border-radius: 24px !important;
}

.${GROUP_CARD_CLASS} > div:first-child h4 {
  max-width: 110px !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.${GROUP_CARD_CLASS} > div:nth-child(2) {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 6px !important;
}

.${GROUP_CARD_CLASS} > div:nth-child(2) button {
  min-width: 0 !important;
  flex-direction: column !important;
  justify-content: center !important;
  gap: 4px !important;
  padding: 6px 2px !important;
  text-align: center !important;
}

.${GROUP_CARD_CLASS} > div:nth-child(2) button img,
.${GROUP_CARD_CLASS} > div:nth-child(2) button span[role='img'] {
  width: 30px !important;
  height: 30px !important;
  flex: none !important;
}

.${GROUP_CARD_CLASS} > div:nth-child(2) button > span:not([role='img']) {
  width: 100% !important;
  font-size: 7px !important;
  text-align: center !important;
}

@media (max-width: 359px) {
  .${GRID_CLASS},
  .${PEOPLE_GRID_CLASS},
  .${REQUEST_GRID_CLASS} {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .${CARD_CLASS} > img,
  .${CARD_CLASS} > span[role='img'],
  .${PEOPLE_CARD_CLASS} > div:first-child > img,
  .${PEOPLE_CARD_CLASS} > div:first-child > span[role='img'],
  .${REQUEST_CARD_CLASS} > div:first-child img,
  .${REQUEST_CARD_CLASS} > div:first-child span[role='img'] {
    width: 96px !important;
    height: 96px !important;
  }
}

@media (min-width: 640px) {
  .${GRID_CLASS},
  .${PEOPLE_GRID_CLASS},
  .${REQUEST_GRID_CLASS} {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 24px 16px !important;
  }

  .${GROUPS_GRID_CLASS} {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
}
`;

const textOf = (element: Element | null) =>
  element?.textContent?.trim().toLocaleLowerCase('pt-BR') ?? '';

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
        const text = textOf(button);
        return text.includes('conectar') || text.includes('cancelar');
      })
    );
  });

  if (suggestionsGrid) {
    suggestionsGrid.classList.add(GRID_CLASS);
    Array.from(suggestionsGrid.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child.tagName !== 'ARTICLE') return;
      child.classList.add(CARD_CLASS);
    });
  }

  const requestList = Array.from(modal.querySelectorAll('div.space-y-3')).find(container =>
    Array.from(container.querySelectorAll(':scope > article')).some(article => {
      const buttons = Array.from(article.querySelectorAll('button')).map(textOf);
      return buttons.some(text => text.includes('aceitar')) &&
        buttons.some(text => text.includes('recusar'));
    })
  ) as HTMLElement | undefined;

  if (requestList) {
    requestList.classList.add(REQUEST_GRID_CLASS);
    Array.from(requestList.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child.tagName !== 'ARTICLE') return;
      child.classList.add(REQUEST_CARD_CLASS);
    });
  }
}

function applyConnectedPeopleGrid() {
  const hub = document.getElementById('profile-social-hub-modal');
  if (!hub) return;

  const connectedNav = hub.querySelector('nav[aria-label="Seções de conectados"]');
  if (!connectedNav) return;
  const wrapper = connectedNav.parentElement;
  if (!wrapper) return;

  const grids = Array.from(wrapper.children).filter(child =>
    child instanceof HTMLElement && child.matches('div.grid.grid-cols-2')
  ) as HTMLElement[];

  grids.forEach(grid => {
    const articles = Array.from(grid.querySelectorAll(':scope > article'));
    if (!articles.some(article => textOf(article).includes('chat'))) return;
    grid.classList.add(PEOPLE_GRID_CLASS);
    articles.forEach(article => article.classList.add(PEOPLE_CARD_CLASS));
  });

  const groupsContainer = Array.from(wrapper.children).find(child => {
    if (!(child instanceof HTMLElement) || !child.classList.contains('space-y-4')) return false;
    return Array.from(child.querySelectorAll(':scope > section')).some(section =>
      Array.from(section.querySelectorAll('button')).some(button =>
        button.getAttribute('aria-label')?.toLocaleLowerCase('pt-BR').startsWith('excluir grupo')
      )
    );
  }) as HTMLElement | undefined;

  if (groupsContainer) {
    groupsContainer.classList.add(GROUPS_GRID_CLASS);
    Array.from(groupsContainer.querySelectorAll(':scope > section')).forEach(section =>
      section.classList.add(GROUP_CARD_CLASS)
    );
  }
}

function applySocialGalleryLayout() {
  applySuggestionsGrid();
  applyConnectedPeopleGrid();
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
        applySocialGalleryLayout();
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
