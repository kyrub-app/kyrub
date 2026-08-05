import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Compass,
  FolderPlus,
  MessageCircle,
  Plus,
  Users,
  X,
} from 'lucide-react';
import {
  addPreviewCommunityPost,
  COMMUNITY_PREVIEW_UPDATED_EVENT,
  loadPreviewCommunities,
  OPEN_COMMUNITY_PREVIEW_CREATE_EVENT,
  type PreviewCommunity,
} from '../utils/communityPreview';

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

const readAuthorName = (): string => {
  const profileModal = document.querySelector('#profile-social-hub-modal');
  const candidates = Array.from(
    profileModal?.querySelectorAll<HTMLElement>('h3') ?? []
  );
  return candidates.find(item => item.textContent?.trim())?.textContent?.trim() || 'Você';
};

export function ProfilePublishingDestinationsPreviewBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shareToSquare, setShareToSquare] = useState(false);
  const [communityPanelOpen, setCommunityPanelOpen] = useState(false);
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [selectionDraft, setSelectionDraft] = useState('');
  const [selectionName, setSelectionName] = useState('');
  const [communities, setCommunities] = useState<PreviewCommunity[]>(() =>
    loadPreviewCommunities()
  );
  const controlsRef = useRef<NativeComposerControls>({
    statusInput: null,
    squareInput: null,
  });
  const selectedCommunityIdRef = useRef('');
  const originalGridRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    selectedCommunityIdRef.current = selectedCommunityId;
  }, [selectedCommunityId]);

  useEffect(() => {
    const refresh = (): void => setCommunities(loadPreviewCommunities());
    window.addEventListener(COMMUNITY_PREVIEW_UPDATED_EVENT, refresh);
    return () =>
      window.removeEventListener(COMMUNITY_PREVIEW_UPDATED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let frame = 0;

    const synchronize = (): void => {
      const textarea = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>('textarea')
      ).find(item => item.placeholder.includes('linha do tempo'));
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

      setNativeCheckbox(controlsRef.current.statusInput, false);

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

      const squareChecked = controlsRef.current.squareInput?.checked === true;
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

  useEffect(() => {
    const handlePublishClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>('button');
      if (!button || button.textContent?.trim() !== 'Publicar') return;

      const composer = button.closest<HTMLElement>('section');
      const textarea = composer?.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder*="linha do tempo"]'
      );
      const communityId = selectedCommunityIdRef.current;
      if (!composer || !textarea || !communityId) return;

      const mediaUrls = Array.from(
        composer.querySelectorAll<HTMLImageElement>('div.relative.aspect-square img')
      )
        .map(image => image.src)
        .filter(Boolean);

      if (!textarea.value.trim() && mediaUrls.length === 0) return;

      try {
        addPreviewCommunityPost({
          communityId,
          authorName: readAuthorName(),
          content: textarea.value,
          mediaUrls,
        });
        setSelectedCommunityId('');
        setCommunityPanelOpen(false);
        setSelectionName('');
        setSelectionDraft('');
      } catch {
        // The native publisher remains authoritative for validation feedback.
      }
    };

    document.addEventListener('click', handlePublishClick, true);
    return () => document.removeEventListener('click', handlePublishClick, true);
  }, []);

  const toggleSquare = (): void => {
    const nextValue = !shareToSquare;
    setShareToSquare(nextValue);
    setNativeCheckbox(controlsRef.current.squareInput, nextValue);
  };

  const selectedCommunity = communities.find(
    community => community.id === selectedCommunityId
  );
  const availableCommunities = communities.filter(
    community => community.isMember || community.isOwner
  );

  if (!host) return null;

  const distributionSummary = [
    'Perfil',
    shareToSquare ? 'Praça' : '',
    selectedCommunity ? `Comunidade · ${selectedCommunity.name}` : '',
    selectionName ? `Seleção · ${selectionName}` : '',
  ].filter(Boolean);

  return createPortal(
    <section
      className="space-y-3 rounded-3xl border border-slate-700 bg-slate-950/75 p-3 shadow-inner"
      id="profile-publishing-destinations-preview"
      aria-label="Destinos da publicação"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[8px] font-black uppercase tracking-[0.18em] text-orange-400">
            Publicação permanente
          </span>
          <h4 className="mt-0.5 text-xs font-black text-white">
            Onde este conteúdo deve aparecer?
          </h4>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
            A publicação permanece no perfil. Praça e Comunidade ampliam a distribuição.
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-500/25 bg-orange-500/10 text-orange-300">
          <MessageCircle className="h-4 w-4" />
        </span>
      </header>

      <div>
        <span className="mb-2 block text-[8px] font-black uppercase tracking-wide text-slate-500">
          Compartilhar em
        </span>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={toggleSquare}
            className={`flex min-h-[64px] items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
              shareToSquare
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
            {shareToSquare && (
              <Check className="h-4 w-4 shrink-0 text-orange-300" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setCommunityPanelOpen(current => !current)}
            className={`flex min-h-[64px] items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
              selectedCommunity
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
                {selectedCommunity?.name || 'Escolher uma comunidade'}
              </span>
            </span>
            {selectedCommunity ? (
              <Check className="h-4 w-4 shrink-0 text-sky-300" />
            ) : (
              <Plus className="h-4 w-4 shrink-0 text-slate-600" />
            )}
          </button>
        </div>

        {communityPanelOpen && (
          <div className="mt-2 space-y-2 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <strong className="block text-[9px] font-black uppercase text-sky-200">
                  Suas comunidades
                </strong>
                <span className="text-[8px] text-slate-500">
                  A publicação também aparecerá no mural escolhido.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCommunityPanelOpen(false)}
                className="text-slate-500"
                aria-label="Fechar comunidades"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-48 space-y-2 overflow-y-auto">
              {availableCommunities.map(community => (
                <button
                  key={community.id}
                  type="button"
                  onClick={() => {
                    setSelectedCommunityId(
                      selectedCommunityId === community.id ? '' : community.id
                    );
                    setCommunityPanelOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${
                    selectedCommunityId === community.id
                      ? 'border-sky-500/45 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-sky-300">
                    {community.name.charAt(0).toLocaleUpperCase('pt-BR')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[9px] text-white">
                      {community.name}
                    </strong>
                    <span className="block truncate text-[8px] text-slate-500">
                      {community.category}
                    </span>
                  </span>
                  {selectedCommunityId === community.id && (
                    <Check className="h-4 w-4 text-sky-300" />
                  )}
                </button>
              ))}
              {availableCommunities.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-[8px] text-slate-500">
                  Entre ou crie uma comunidade pela Praça para publicar nela.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setCommunityPanelOpen(false);
                window.dispatchEvent(
                  new Event(OPEN_COMMUNITY_PREVIEW_CREATE_EVENT)
                );
              }}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 text-[8px] font-black uppercase text-sky-200"
            >
              <Plus className="h-4 w-4" />
              Criar comunidade
            </button>
          </div>
        )}
      </div>

      <div>
        <span className="mb-2 block text-[8px] font-black uppercase tracking-wide text-slate-500">
          Organizar, sem duplicar
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
              {selectionName || 'Agrupar esta publicação no perfil'}
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
                  Este nome ainda é parte do protótipo de nomenclatura.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectionPanelOpen(false)}
                className="text-slate-500"
                aria-label="Fechar seleção"
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
          Destino desta publicação
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
          Comunidades e seus murais são funcionais apenas neste preview local. Seleções ainda não são persistidas.
        </p>
      </footer>
    </section>,
    host
  );
}
