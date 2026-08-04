import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Clock3,
  Compass,
  FolderPlus,
  MessageCircle,
  Plus,
  Users,
  X,
} from 'lucide-react';

type PublicationMode = 'publication' | 'status';

type NativeComposerControls = {
  statusInput: HTMLInputElement | null;
  squareInput: HTMLInputElement | null;
};

const setNativeCheckbox = (
  input: HTMLInputElement | null,
  checked: boolean
): void => {
  if (!input || input.checked === checked) return;

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'checked'
  );
  descriptor?.set?.call(input, checked);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const findLabel = (
  composer: HTMLElement,
  text: string
): HTMLLabelElement | null =>
  Array.from(composer.querySelectorAll<HTMLLabelElement>('label')).find(label =>
    label.textContent?.includes(text)
  ) ?? null;

export function ProfilePublishingDestinationsPreviewBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<PublicationMode>('publication');
  const [shareToSquare, setShareToSquare] = useState(false);
  const [communityPanelOpen, setCommunityPanelOpen] = useState(false);
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(false);
  const [communityDraft, setCommunityDraft] = useState('');
  const [selectionDraft, setSelectionDraft] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [selectionName, setSelectionName] = useState('');
  const controlsRef = useRef<NativeComposerControls>({
    statusInput: null,
    squareInput: null,
  });
  const originalGridRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;

    const synchronize = (): void => {
      const textarea = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>('textarea')
      ).find(item =>
        item.placeholder.includes('linha do tempo')
      );
      const composer = textarea?.closest<HTMLElement>('section');

      if (!composer) {
        setHost(null);
        return;
      }

      const statusLabel = findLabel(composer, 'Publicar no Status');
      const squareLabel = findLabel(composer, 'Enviar para a Praça');
      const originalGrid = statusLabel?.parentElement;

      if (
        !statusLabel ||
        !squareLabel ||
        !originalGrid ||
        originalGrid !== squareLabel.parentElement
      ) {
        setHost(null);
        return;
      }

      controlsRef.current = {
        statusInput: statusLabel.querySelector<HTMLInputElement>(
          'input[type="checkbox"]'
        ),
        squareInput: squareLabel.querySelector<HTMLInputElement>(
          'input[type="checkbox"]'
        ),
      };

      if (originalGridRef.current !== originalGrid) {
        if (originalGridRef.current) {
          originalGridRef.current.style.removeProperty('display');
          delete originalGridRef.current.dataset.kyrubPublishingPreviewHidden;
        }
        originalGridRef.current = originalGrid;
      }

      originalGrid.dataset.kyrubPublishingPreviewHidden = 'true';
      originalGrid.style.display = 'none';

      let mount = composer.querySelector<HTMLElement>(
        '[data-kyrub-publishing-destinations-preview]'
      );
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.kyrubPublishingDestinationsPreview = 'true';
        originalGrid.before(mount);
      }

      mountRef.current = mount;
      setHost(current => (current === mount ? current : mount));

      const statusChecked = controlsRef.current.statusInput?.checked === true;
      const squareChecked = controlsRef.current.squareInput?.checked === true;
      setMode(current =>
        current === (statusChecked ? 'status' : 'publication')
          ? current
          : statusChecked
            ? 'status'
            : 'publication'
      );
      setShareToSquare(current =>
        current === squareChecked ? current : squareChecked
      );
    };

    const schedule = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      if (originalGridRef.current) {
        originalGridRef.current.style.removeProperty('display');
        delete originalGridRef.current.dataset.kyrubPublishingPreviewHidden;
      }
      mountRef.current?.remove();
    };
  }, []);

  const selectMode = (nextMode: PublicationMode): void => {
    setMode(nextMode);
    setNativeCheckbox(
      controlsRef.current.statusInput,
      nextMode === 'status'
    );

    if (nextMode === 'status') {
      setShareToSquare(false);
      setNativeCheckbox(controlsRef.current.squareInput, false);
      setCommunityName('');
      setCommunityPanelOpen(false);
    }
  };

  const toggleSquare = (): void => {
    if (mode === 'status') return;
    const nextValue = !shareToSquare;
    setShareToSquare(nextValue);
    setNativeCheckbox(controlsRef.current.squareInput, nextValue);
  };

  if (!host) return null;

  const distributionSummary = [
    mode === 'status' ? 'Status · 24 h' : 'Perfil',
    mode === 'publication' && shareToSquare ? 'Praça' : '',
    mode === 'publication' && communityName
      ? `Comunidade · ${communityName}`
      : '',
    selectionName ? `Seleção · ${selectionName}` : '',
  ].filter(Boolean);

  return createPortal(
    <section
      className="space-y-3 rounded-3xl border border-slate-700 bg-slate-950/75 p-3 shadow-inner"
      id="profile-publishing-destinations-preview"
      aria-label="Prévia de destinos da publicação"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[8px] font-black uppercase tracking-[0.18em] text-orange-400">
            Novo fluxo de publicação
          </span>
          <h4 className="mt-0.5 text-xs font-black text-white">
            Como este conteúdo será publicado?
          </h4>
        </div>
        <span className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-[7px] font-black uppercase text-violet-300">
          Protótipo visual
        </span>
      </header>

      <div>
        <span className="mb-2 block text-[8px] font-black uppercase tracking-wide text-slate-500">
          1. Formato
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => selectMode('publication')}
            className={`min-h-[70px] rounded-2xl border p-3 text-left transition-colors ${
              mode === 'publication'
                ? 'border-orange-500/45 bg-orange-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <span className="flex items-center gap-2">
              <MessageCircle
                className={`h-4 w-4 ${
                  mode === 'publication' ? 'text-orange-300' : 'text-slate-500'
                }`}
              />
              <strong className="text-[9px] font-black uppercase text-white">
                Publicação
              </strong>
            </span>
            <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">
              Permanente no perfil e pronta para distribuição.
            </span>
          </button>

          <button
            type="button"
            onClick={() => selectMode('status')}
            className={`min-h-[70px] rounded-2xl border p-3 text-left transition-colors ${
              mode === 'status'
                ? 'border-teal-500/45 bg-teal-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <span className="flex items-center gap-2">
              <Clock3
                className={`h-4 w-4 ${
                  mode === 'status' ? 'text-teal-300' : 'text-slate-500'
                }`}
              />
              <strong className="text-[9px] font-black uppercase text-white">
                Status
              </strong>
            </span>
            <span className="mt-1 block text-[8px] leading-relaxed text-slate-500">
              Temporário por 24 horas, sem virar publicação permanente.
            </span>
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[8px] font-black uppercase tracking-wide text-slate-500">
            2. Onde compartilhar
          </span>
          {mode === 'status' && (
            <span className="text-[7px] text-teal-300/75">
              Status começa com alcance próprio
            </span>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={toggleSquare}
            disabled={mode === 'status'}
            className={`flex min-h-[62px] items-center gap-3 rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              shareToSquare && mode === 'publication'
                ? 'border-orange-500/45 bg-orange-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-orange-300">
              <Compass className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[9px] font-black uppercase text-white">
                Praça
              </strong>
              <span className="mt-0.5 block text-[8px] text-slate-500">
                Descoberta pública no feed geral.
              </span>
            </span>
            {shareToSquare && mode === 'publication' && (
              <Check className="h-4 w-4 shrink-0 text-orange-300" />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              mode === 'publication' &&
              setCommunityPanelOpen(current => !current)
            }
            disabled={mode === 'status'}
            className={`flex min-h-[62px] items-center gap-3 rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              communityName && mode === 'publication'
                ? 'border-sky-500/45 bg-sky-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sky-300">
              <Users className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[9px] font-black uppercase text-white">
                Comunidade
              </strong>
              <span className="mt-0.5 block truncate text-[8px] text-slate-500">
                {communityName || 'Escolher ou criar uma comunidade'}
              </span>
            </span>
            {communityName && mode === 'publication' ? (
              <Check className="h-4 w-4 shrink-0 text-sky-300" />
            ) : (
              <Plus className="h-4 w-4 shrink-0 text-slate-600" />
            )}
          </button>
        </div>

        {communityPanelOpen && mode === 'publication' && (
          <div className="mt-2 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <strong className="block text-[9px] font-black uppercase text-sky-200">
                  Comunidade
                </strong>
                <span className="text-[8px] text-slate-500">
                  Digite um nome para simular escolher ou criar.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCommunityPanelOpen(false)}
                className="text-slate-500"
                aria-label="Fechar prévia de comunidade"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={communityDraft}
                onChange={event =>
                  setCommunityDraft(event.target.value.slice(0, 60))
                }
                placeholder="Nome da comunidade"
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-sky-500/60"
              />
              <button
                type="button"
                onClick={() => {
                  const name = communityDraft.trim();
                  if (!name) return;
                  setCommunityName(name);
                  setCommunityPanelOpen(false);
                }}
                className="min-h-10 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
              >
                Usar
              </button>
            </div>
            {communityName && (
              <button
                type="button"
                onClick={() => {
                  setCommunityName('');
                  setCommunityDraft('');
                }}
                className="mt-2 text-[8px] font-bold text-slate-500 underline"
              >
                Publicar sem comunidade
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <span className="mb-2 block text-[8px] font-black uppercase tracking-wide text-slate-500">
          3. Organizar, sem duplicar
        </span>
        <button
          type="button"
          onClick={() => setSelectionPanelOpen(current => !current)}
          className={`flex min-h-[62px] w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
            selectionName
              ? 'border-violet-500/45 bg-violet-500/10'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-violet-300">
            <FolderPlus className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-[9px] font-black uppercase text-white">
              Seleções
            </strong>
            <span className="mt-0.5 block truncate text-[8px] text-slate-500">
              {selectionName || 'Guardar em uma seleção do perfil'}
            </span>
          </span>
          {selectionName ? (
            <Check className="h-4 w-4 shrink-0 text-violet-300" />
          ) : (
            <Plus className="h-4 w-4 shrink-0 text-slate-600" />
          )}
        </button>

        {selectionPanelOpen && (
          <div className="mt-2 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <strong className="block text-[9px] font-black uppercase text-violet-200">
                  Seleção do perfil
                </strong>
                <span className="text-[8px] text-slate-500">
                  A seleção organiza a publicação ou preserva o Status.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectionPanelOpen(false)}
                className="text-slate-500"
                aria-label="Fechar prévia de seleção"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={selectionDraft}
                onChange={event =>
                  setSelectionDraft(event.target.value.slice(0, 60))
                }
                placeholder="Nome da seleção"
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[10px] text-white outline-none focus:border-violet-500/60"
              />
              <button
                type="button"
                onClick={() => {
                  const name = selectionDraft.trim();
                  if (!name) return;
                  setSelectionName(name);
                  setSelectionPanelOpen(false);
                }}
                className="min-h-10 rounded-xl bg-violet-500 px-3 text-[8px] font-black uppercase text-white"
              >
                Usar
              </button>
            </div>
            {selectionName && (
              <button
                type="button"
                onClick={() => {
                  setSelectionName('');
                  setSelectionDraft('');
                }}
                className="mt-2 text-[8px] font-bold text-slate-500 underline"
              >
                Não adicionar a uma seleção
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-slate-800 pt-3">
        <span className="block text-[7px] font-black uppercase tracking-wide text-slate-600">
          Prévia do destino
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {distributionSummary.map(item => (
            <span
              key={item}
              className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[8px] font-bold text-slate-300"
            >
              {item}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[7px] leading-relaxed text-slate-600">
          Nesta etapa, Comunidade e Seleções são apenas uma simulação visual;
          nenhuma estrutura é criada ou salva no banco.
        </p>
      </footer>
    </section>,
    host
  );
}
