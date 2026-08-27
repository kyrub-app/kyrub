import { useEffect, useState } from 'react';
import { Check, FileText, X } from 'lucide-react';

interface VisibleChecklistItem {
  label: string;
  completed: boolean;
}

interface VisibleNoteContent {
  title: string;
  content: string;
  checklist: VisibleChecklistItem[];
}

const PREVIEW_BUTTON_CLASS = 'kyrub-note-preview-open';
const PREVIEW_CONTENT_ATTRIBUTE = 'data-kyrub-note-content-preview';
const CHECKLIST_PROGRESS_CLASS = 'kyrub-note-checklist-progress';
const CHECKLIST_ROW_ATTRIBUTE = 'data-kyrub-checklist-row';
const STYLE_ELEMENT_ID = 'kyrub-note-card-layout-styles';
const MAX_PENDING_CHECKLIST_ITEMS = 3;

const ensurePreviewStyles = (): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    #notes-grid {
      display: block !important;
      column-count: 2;
      column-gap: 0.9rem;
    }

    #notes-grid > article {
      display: inline-block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 0 0.9rem !important;
      vertical-align: top;
      break-inside: avoid;
      -webkit-column-break-inside: avoid;
      page-break-inside: avoid;
    }

    #notes-grid > article > :first-child {
      height: auto !important;
      min-height: 0 !important;
    }

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

    #notes-grid .${CHECKLIST_PROGRESS_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin: 0.35rem 0 0.55rem;
      color: rgb(45 212 191);
      font-size: 0.625rem;
      font-weight: 800;
      letter-spacing: 0.025em;
      text-transform: uppercase;
    }

    #notes-grid [${CHECKLIST_ROW_ATTRIBUTE}="hidden"] {
      display: none !important;
    }

    #notes-grid .${PREVIEW_BUTTON_CLASS} {
      display: block;
      width: 100%;
      margin: 0;
      border: 0;
      border-top: 1px solid rgb(30 41 59);
      background: rgb(15 23 42 / 0.72);
      padding: 0.8rem 0.75rem 0.85rem;
      color: rgb(45 212 191);
      cursor: pointer;
      font-size: 0.625rem;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-align: center;
      text-transform: uppercase;
    }

    #notes-grid > article > .${PREVIEW_BUTTON_CLASS} {
      border-radius: 0 0 0.9rem 0.9rem;
    }

    #notes-grid .${PREVIEW_BUTTON_CLASS}:hover,
    #notes-grid .${PREVIEW_BUTTON_CLASS}:focus-visible {
      color: rgb(94 234 212);
      outline: none;
      text-decoration: underline;
      text-underline-offset: 0.2rem;
    }

    @media (max-width: 359px) {
      #notes-grid {
        column-count: 1;
      }
    }

    @media (min-width: 640px) {
      #notes-grid > article [${PREVIEW_CONTENT_ATTRIBUTE}="true"] {
        max-height: 14rem;
      }
    }

    @media (min-width: 768px) {
      #notes-grid {
        column-count: 3;
        column-gap: 1rem;
      }

      #notes-grid > article {
        margin-bottom: 1rem !important;
      }
    }

    @media (min-width: 1200px) {
      #notes-grid {
        column-count: 4;
      }
    }
  `;
  document.head.appendChild(style);
};

const findChecklistHeading = (root: HTMLElement): HTMLElement | null => {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('div, span, p, h4, h5'));
  return (
    candidates.find(candidate => candidate.textContent?.trim().toUpperCase() === 'CHECKLIST') ?? null
  );
};

const getChecklistRow = (input: HTMLInputElement, root: HTMLElement): HTMLElement | null => {
  const label = input.closest('label');
  if (label instanceof HTMLElement && root.contains(label)) return label;

  let current: HTMLElement | null = input.parentElement;
  while (current && current.parentElement && current.parentElement !== root) {
    const inputCount = current.querySelectorAll('input[type="checkbox"]').length;
    if (inputCount === 1 && (current.textContent?.trim().length ?? 0) > 0) return current;
    current = current.parentElement;
  }

  return input.parentElement instanceof HTMLElement ? input.parentElement : null;
};

const readChecklist = (root: HTMLElement): VisibleChecklistItem[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(input => {
    const row = getChecklistRow(input, root);
    const label = row?.textContent?.replace(/\s+/g, ' ').trim() || 'Item da checklist';
    return { label, completed: input.checked };
  });

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
        const bodyIsOverflowing = paragraph.scrollHeight > paragraph.clientHeight + 1;
        paragraph.dataset.overflowing = bodyIsOverflowing ? 'true' : 'false';

        const checklistInputs = Array.from(
          contentRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        );
        const checklist = readChecklist(contentRoot);
        const completedCount = checklist.filter(item => item.completed).length;
        let visiblePendingCount = 0;

        checklistInputs.forEach(input => {
          const row = getChecklistRow(input, contentRoot);
          if (!row) return;

          const shouldHide = input.checked || visiblePendingCount >= MAX_PENDING_CHECKLIST_ITEMS;
          row.setAttribute(CHECKLIST_ROW_ATTRIBUTE, shouldHide ? 'hidden' : 'visible');
          if (!input.checked && !shouldHide) visiblePendingCount += 1;
        });

        const pendingCount = checklist.length - completedCount;
        const checklistHasHiddenContent =
          completedCount > 0 || pendingCount > MAX_PENDING_CHECKLIST_ITEMS;

        const checklistHeading = findChecklistHeading(contentRoot);
        let progress = contentRoot.querySelector<HTMLElement>(`.${CHECKLIST_PROGRESS_CLASS}`);

        if (checklist.length > 0 && checklistHeading) {
          if (!progress) {
            progress = document.createElement('span');
            progress.className = CHECKLIST_PROGRESS_CLASS;
            checklistHeading.insertAdjacentElement('afterend', progress);
          }
          progress.textContent = `${completedCount}/${checklist.length} concluídos`;
        } else {
          progress?.remove();
          progress = null;
        }

        let button = card.querySelector<HTMLButtonElement>(`.${PREVIEW_BUTTON_CLASS}`);
        const needsFullView = bodyIsOverflowing || checklistHasHiddenContent;

        if (!needsFullView) {
          button?.remove();
          return;
        }

        if (!button) {
          button = document.createElement('button');
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
              checklist: readChecklist(contentRoot),
            });
          });
        }

        // O CTA deve ser o último elemento do article, abaixo de todo o conteúdo e da faixa de ações.
        if (card.lastElementChild !== button) card.appendChild(button);
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
      attributes: true,
      attributeFilter: ['checked'],
    });

    const handleChecklistChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
        scheduleEnhancement();
      }
    };

    document.addEventListener('change', handleChecklistChange);
    window.addEventListener('resize', scheduleEnhancement);
    scheduleEnhancement();

    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('change', handleChecklistChange);
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

  const completedChecklistCount = visibleNote.checklist.filter(item => item.completed).length;

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

          {visibleNote.checklist.length > 0 && (
            <div className="mt-6 border-t border-slate-800 pt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Checklist
                </span>
                <span className="text-[10px] font-black uppercase tracking-wide text-teal-400">
                  {completedChecklistCount}/{visibleNote.checklist.length} concluídos
                </span>
              </div>
              <div className="space-y-2.5">
                {visibleNote.checklist.map((item, index) => (
                  <div
                    key={`${item.label}-${index}`}
                    className="flex items-start gap-2.5 rounded-xl bg-slate-950/55 px-3 py-2.5"
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        item.completed
                          ? 'border-teal-400 bg-teal-400/15 text-teal-300'
                          : 'border-slate-600 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span
                      className={`text-sm leading-5 ${
                        item.completed ? 'text-slate-500 line-through' : 'text-slate-200'
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
