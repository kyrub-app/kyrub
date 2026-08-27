import { useEffect } from 'react';

const MARKER = 'data-kyrub-legacy-kds-station-filter-hidden';

function hideDuplicateLegacyStationFilter(): void {
  const kds = document.getElementById('kds-funnel-view');
  if (!kds) return;

  const previous = kds.previousElementSibling;
  if (!(previous instanceof HTMLElement)) return;

  const buttons = Array.from(previous.querySelectorAll('button'));
  if (buttons.length === 0) return;

  const labels = buttons
    .map(button => button.textContent?.trim().toLocaleUpperCase('pt-BR') ?? '')
    .filter(Boolean);

  const looksLikeLegacyStationStrip =
    labels.includes('TODOS') &&
    !labels.includes('TODAS AS ESTAÇÕES') &&
    !previous.closest('[aria-label="Etapas dos pedidos"]');

  if (!looksLikeLegacyStationStrip) return;

  previous.setAttribute(MARKER, 'true');
  previous.style.display = 'none';
}

export function LegacyKdsStationFilterCleanupBridge() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        hideDuplicateLegacyStationFilter();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      document
        .querySelectorAll<HTMLElement>(`[${MARKER}="true"]`)
        .forEach(element => {
          element.style.removeProperty('display');
          element.removeAttribute(MARKER);
        });
    };
  }, []);

  return null;
}
