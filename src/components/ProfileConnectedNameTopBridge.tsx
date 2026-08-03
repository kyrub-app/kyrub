import { useEffect } from 'react';

const CARD_SELECTOR =
  'article[data-profile-connected-full-image="true"]';
const HEADING_SLOT_SELECTOR =
  '[data-profile-connected-heading-slot="true"]';
const GROUP_LABEL_SELECTOR =
  '[data-profile-connected-group-label="true"]';

export function ProfileConnectedNameTopBridge() {
  useEffect(() => {
    const synchronize = () => {
      document
        .querySelectorAll<HTMLElement>(CARD_SELECTOR)
        .forEach(card => {
          const headingSlot = card.querySelector<HTMLElement>(
            HEADING_SLOT_SELECTOR
          );
          const content = headingSlot?.parentElement as HTMLElement | null;
          const headingRow = headingSlot?.firstElementChild as HTMLElement | null;
          const nameButton = headingSlot?.querySelector<HTMLButtonElement>(
            'button[aria-label^="Abrir perfil de "]'
          );
          const groupLabel = card.querySelector<HTMLElement>(
            GROUP_LABEL_SELECTOR
          );
          const imageContainer = card.firstElementChild as HTMLElement | null;
          const gradient = imageContainer?.querySelector<HTMLElement>(
            '[data-profile-connected-full-gradient="true"]'
          );

          if (!headingSlot || !content || !nameButton) return;

          content.dataset.profileConnectedNameTop = 'true';
          content.style.position = 'absolute';
          content.style.inset = '14px 56px auto 14px';
          content.style.zIndex = '5';
          content.style.margin = '0';
          content.style.minHeight = '0';
          content.style.padding = '0';
          content.style.background = 'transparent';
          content.style.pointerEvents = 'none';

          headingSlot.style.pointerEvents = 'auto';
          headingSlot.style.width = '100%';

          if (headingRow) {
            headingRow.style.alignItems = 'flex-start';
            headingRow.style.width = '100%';
          }

          nameButton.style.display = '-webkit-box';
          nameButton.style.webkitBoxOrient = 'vertical';
          nameButton.style.webkitLineClamp = '2';
          nameButton.style.whiteSpace = 'normal';
          nameButton.style.overflow = 'hidden';
          nameButton.style.textOverflow = 'ellipsis';
          nameButton.style.lineHeight = '1.05';
          nameButton.style.maxHeight = '2.15em';
          nameButton.style.fontSize = '0.82rem';
          nameButton.style.textAlign = 'left';
          nameButton.style.textShadow = '0 2px 7px rgba(2, 6, 23, 0.95)';

          if (groupLabel) {
            groupLabel.style.marginTop = '5px';
            groupLabel.style.maxWidth = '100%';
            groupLabel.style.whiteSpace = 'normal';
            groupLabel.style.overflow = 'hidden';
            groupLabel.style.textOverflow = 'ellipsis';
            groupLabel.style.lineHeight = '1.1';
            groupLabel.style.textShadow =
              '0 2px 7px rgba(2, 6, 23, 0.95)';
            groupLabel.style.pointerEvents = 'none';
          }

          if (gradient) {
            gradient.style.background =
              'linear-gradient(to bottom, rgba(2,6,23,0.76) 0%, rgba(2,6,23,0.2) 30%, rgba(2,6,23,0.2) 52%, rgba(2,6,23,0.78) 76%, rgba(2,6,23,0.98) 100%)';
          }
        });
    };

    synchronize();
    const timer = window.setInterval(synchronize, 250);

    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-connected-name-top="true"]'
        )
        .forEach(content => {
          delete content.dataset.profileConnectedNameTop;
        });
    };
  }, []);

  return null;
}
