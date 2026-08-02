import { useEffect } from 'react';

const SUBTAB_LABELS = ['Minha lista', 'Sugestões', 'Solicitações'] as const;

const findSubtabButton = (
  modal: HTMLElement,
  label: (typeof SUBTAB_LABELS)[number]
): HTMLButtonElement | null =>
  Array.from(modal.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    Array.from(button.querySelectorAll('span')).some(
      span => span.textContent?.trim() === label
    )
  ) ?? null;

const ensureStableTextPrefix = (
  button: HTMLButtonElement,
  label: (typeof SUBTAB_LABELS)[number]
) => {
  button.dataset.kyrubConnectionSection = label;

  let prefix = button.querySelector<HTMLElement>(
    ':scope > [data-kyrub-connection-label-prefix]'
  );
  if (!prefix) {
    prefix = document.createElement('span');
    prefix.dataset.kyrubConnectionLabelPrefix = 'true';
    prefix.setAttribute('aria-hidden', 'true');
    prefix.style.position = 'absolute';
    prefix.style.width = '1px';
    prefix.style.height = '1px';
    prefix.style.padding = '0';
    prefix.style.margin = '-1px';
    prefix.style.overflow = 'hidden';
    prefix.style.clip = 'rect(0, 0, 0, 0)';
    prefix.style.whiteSpace = 'nowrap';
    prefix.style.border = '0';
    button.prepend(prefix);
  }
  prefix.textContent = `${label} `;
};

export function ProfileConnectionSubtabsBridge() {
  useEffect(() => {
    const decorate = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) return;

      const buttons = SUBTAB_LABELS.map(label => ({
        label,
        button: findSubtabButton(modal, label),
      }));
      const listButton = buttons[0]?.button;
      const subnav = listButton?.parentElement;
      if (!subnav) return;

      subnav.dataset.kyrubConnectionSubnavAnchor = 'true';
      for (const { label, button } of buttons) {
        if (button && button.parentElement === subnav) {
          ensureStableTextPrefix(button, label);
        }
      }
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-connection-label-prefix]')
        .forEach(element => element.remove());
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-connection-section]')
        .forEach(element => delete element.dataset.kyrubConnectionSection);
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-connection-subnav-anchor]')
        .forEach(element => delete element.dataset.kyrubConnectionSubnavAnchor);
    };
  }, []);

  return null;
}
