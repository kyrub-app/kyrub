import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';

interface VisibleNoteContent {
  title: string;
  content: string;
}

const PREVIEW_BUTTON_CLASS = 'kyrub-note-preview-open';
const PREVIEW_CONTENT_ATTRIBUTE = 'data-kyrub-note-content-preview';
const STYLE_ELEMENT_ID = 'kyrub-note-card-layout-styles';

const ensurePreviewStyles = (): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"] {
      max-height: 11rem;
      overflow: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"][data-overflowing="true"] {
      -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%);
      mask-image: linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%);
    }

    #notes-grid .${PREVIEW_BUTTON_CLASS} {
      margin-top: 0.4rem;
      border: 0;
      background: transparent;
      padding: 0.25rem 0;
      color: rgb(45 212 191);
      cursor: pointer;
      font-size: 0.625rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    #notes-grid .${PREVIEW_BUTTON_CLASS}:hover,
    #notes-grid .${PREVIEW_BUTTON_CLASS}:focus-visible {
      color: rgb(94 234 212);
      outline: none;
      text-decoration: underline;
      text-underline-offset: 0.2rem;
    }

    @media (min-width: 640px) {
      #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"] {
        max-height: 14rem;
      }
    }
  `;
  document.head.appendChild(style);
};

export function NoteCardLayoutBridge() {
  const [visibleNote, setVisibleNote] = useState<VisibleNoteContent | null>(null);

  useEffect(() => {
    ensurePreviewStyles();

    let frame = 0;
    let stopped = false;

    const enhanceCards = () => {
      frame = 0;
      if (stopped) return;

      const grid = document.getElementById('notes-grid');
      if (!grid) return;

      const cards = Array.from(grid.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement
      );

      cards.forEach(card => {
        const contentRoot = card.firstElementChild;
        if (!(contentRoot instanceof HTMLElement)) return;

        const paragraph = Array.from(contentRoot.children).find(
          element => element.tagName === 'P'
        );
        if (!(paragraph instanceof HTMLParagraphElement)) return;

        paragraph.setAttribute(PREVIEW_CONTENT_ATTRIBUTE, 'true');

        const isOverflowing = paragraph.scrollHeight > paragraph.clientHeight + 1;
        paragraph.dataset.overflowing = isOverflowing ? 'true' : 'false';

        const existingButton = contentRoot.querySelector<HTMLButtonElement>(
          `.${PREVIEW_BUTTON_CLASS}`
        );

        if (!isOverflowing) {
          existingButton?.remove();
          return;
        }

        if (existingButton) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = PREVIEW_BUTTON_CLASS;
        button.textContent = 'Ver nota completa';
        button.setAttribute('aria-label', 'Ver nota completa');
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();

          const currentTitle = card.querySelector('h3')?.textContent?.trim();
          const currentContent = paragraph.textContent ?? '';
          setVisibleNote({
            title: currentTitle || 'Nota',
            content: currentContent,
          });
        });

        paragraph.insertAdjacentElement('afterend', button);
      });
    };

    const scheduleEnhancement = () => {
      if (frame || stopped) return;
      frame = window.requestAnimationFrame(enhanceCards);
    };

    const observer = new MutationObserver(scheduleEnhancement);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener('resize', scheduleEnhancement);
    scheduleEnhancement();

    return () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener('resize', scheduleEnhancement);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!visibleNote) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVisibleNote(null);
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visibleNote]);

  if (!visibleNote) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-note-title"
      onMouseDown={event => {
        if (event.currentTarget === event.target) setVisibleNote(null);
      }}
    >
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:max-h-[86vh] sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-teal-400">
              <FileText className="h-3.5 w-3.5" />
              Nota completa
            </span>
            <h2
              id="full-note-title"
              className="mt-1 break-words text-base font-black uppercase text-white"
            >
              {visibleNote.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setVisibleNote(null)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-slate-400 transition-colors hover:text-white"
            aria-label="Fechar nota completa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
            {visibleNote.content}
          </p>
        </div>

        <div className="border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={() => setVisibleNote(null)}
            className="w-full rounded-xl bg-slate-800 py-2.5 text-xs font-bold uppercase text-slate-200 transition-colors hover:bg-slate-700"
          >
            Voltar às notas
          </button>
        </div>
      </div>
    </div>
  );
}
