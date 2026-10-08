import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Compass,
  FolderPlus,
  Send,
  Plus,
  Users,
  X,
} from 'lucide-react';
import { useCommunityDirectory } from '../hooks/useCommunityDirectory';
import {
  createCommunityPost,
  OPEN_COMMUNITY_CLOUD_CREATE_EVENT,
} from '../utils/communityCloud';

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

export function ProfilePublishingDestinationsCloudBridge() {
  const { activeCommunities } = useCommunityDirectory();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shareToSquare, setShareToSquare] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [communityPanelOpen, setCommunityPanelOpen] = useState(false);
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [selectionDraft, setSelectionDraft] = useState('');
  const [selectionName, setSelectionName] = useState('');
  const [communityMessage, setCommunityMessage] = useState('');
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
    const openPublishMenu = () => {
      setCommunityMessage('');
      setPublishMenuOpen(true);
    };
    window.addEventListener(
      'kyrub-profile-publish-menu-requested',
      openPublishMenu
    );
    return () =>
      window.removeEventListener(
        'kyrub-profile-publish-menu-requested',
        openPublishMenu
      );
  }, []);

  useEffect(() => {
    if (
      selectedCommunityId &&
      !activeCommunities.some(community => community.id === selectedCommunityId)
    ) {
      setSelectedCommunityId('');
    }
  }, [activeCommunities, selectedCommunityId]);

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
          delete originalGridRef.current.dataset.kyrubPublishingCloudHidden;
        }
        originalGridRef.current = originalGrid;
      }
      originalGrid.dataset.kyrubPublishingCloudHidden = 'true';
      originalGrid.style.display = 'none';
      let mount = composer.querySelector<HTMLElement>(
        '[data-kyrub-publishing-destinations-cloud]'
      );
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.kyrubPublishingDestinationsCloud = 'true';
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
        delete originalGridRef.current.dataset.kyrubPublishingCloudHidden;
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
      const content = textarea.value;
      const mediaUrls = Array.from(
        composer.querySelectorAll<HTMLImageElement>('div.relative.aspect-square img')
      )
        .map(image => image.src)
        .filter(url => Boolean(url) && !url.startsWith('blob:'));
      if (!content.trim() && mediaUrls.length === 0) return;

      void createCommunityPost({ communityId, content, mediaUrls })
        .then(() => {
          setCommunityMessage('A publicação também foi enviada à comunidade.');
          setSelectedCommunityId('');
          setCommunityPanelOpen(false);
          setSelectionName('');
          setSelectionDraft('');
          setPublishMenuOpen(false);
        })
        .catch(value => {
          console.warn('Não foi possível publicar na comunidade.', value);
          setCommunityMessage(
            value instanceof Error
              ? value.message
              : 'A publicação foi criada no perfil, mas não chegou à comunidade.'
          );
        });
    };
    document.addEventListener('click', handlePublishClick, true);
    return () => document.removeEventListener('click', handlePublishClick, true);
  }, []);

  const toggleSquare = (): void => {
    const nextValue = !shareToSquare;
    setShareToSquare(nextValue);
    setNativeCheckbox(controlsRef.current.squareInput, nextValue);
  };

  const selectedCommunity = activeCommunities.find(
    community => community.id === selectedCommunityId
  );

  if (!host) return null;

  const distributionSummary = [
    'Perfil',
    shareToSquare ? 'Praça' : '',
    selectedCommunity ? `Comunidade · ${selectedCommunity.name}` : '',
    selectionName ? `Seleção · ${selectionName}` : '',
  ].filter(Boolean);

  return createPortal(
    publishMenuOpen ? (
      <section
        className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 shadow-2xl"
        id="profile-publishing-destinations"
        aria-label="Destinos da publicação"
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-[10px] font-black uppercase text-white">
              Publicar em
            </h4>
            <p className="mt-0.5 text-[8px] text-slate-500">
              O perfil guarda a publicação. Escolha onde mais ela deve aparecer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPublishMenuOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 text-slate-400"
            aria-label="Fechar destinos"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-2">
          <button
            type="button"
            onClick={toggleSquare}
            className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${
              shareToSquare
                ? 'border-orange-500/45 bg-orange-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <Compass className="h-4 w-4 text-orange-300" />
            <span className="min-w-0 flex-1">
              <strong className="block text-[9px] font-black uppercase text-white">Praça</strong>
              <span className="block text-[8px] text-slate-500">Feed público geral</span>
            </span>
            {shareToSquare && <Check className="h-4 w-4 text-orange-300" />}
          </button>

          <button
            type="button"
            onClick={() => setCommunityPanelOpen(current => !current)}
            className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${
              selectedCommunity
                ? 'border-sky-500/45 bg-sky-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <Users className="h-4 w-4 text-sky-300" />
            <span className="min-w-0 flex-1">
              <strong className="block text-[9px] font-black uppercase text-white">Comunidade</strong>
              <span className="block truncate text-[8px] text-slate-500">
                {selectedCommunity?.name || 'Escolher comunidade'}
              </span>
            </span>
            {selectedCommunity ? <Check className="h-4 w-4 text-sky-300" /> : <Plus className="h-4 w-4 text-slate-600" />}
          </button>

          {communityPanelOpen && (
            <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-2">
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {activeCommunities.map(community => (
                  <button
                    key={community.id}
                    type="button"
                    onClick={() => {
                      setSelectedCommunityId(
                        selectedCommunityId === community.id ? '' : community.id
                      );
                      setCommunityPanelOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${
                      selectedCommunityId === community.id
                        ? 'border-sky-500/45 bg-sky-500/10'
                        : 'border-slate-800 bg-slate-950'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-white">
                      {community.name}
                    </span>
                    {selectedCommunityId === community.id && <Check className="h-4 w-4 text-sky-300" />}
                  </button>
                ))}
                {activeCommunities.length === 0 && (
                  <p className="px-2 py-3 text-center text-[8px] text-slate-500">
                    Você ainda não participa de uma comunidade.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCommunityPanelOpen(false);
                  setPublishMenuOpen(false);
                  window.dispatchEvent(new Event(OPEN_COMMUNITY_CLOUD_CREATE_EVENT));
                }}
                className="flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-sky-500/25 text-[8px] font-black uppercase text-sky-200"
              >
                <Plus className="h-4 w-4" />
                Criar comunidade
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setSelectionPanelOpen(current => !current)}
            className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${
              selectionName
                ? 'border-violet-500/45 bg-violet-500/10'
                : 'border-slate-800 bg-slate-900/70'
            }`}
          >
            <FolderPlus className="h-4 w-4 text-violet-300" />
            <span className="min-w-0 flex-1">
              <strong className="block text-[9px] font-black uppercase text-white">Seleções</strong>
              <span className="block truncate text-[8px] text-slate-500">
                {selectionName || 'Organizar sem duplicar'}
              </span>
            </span>
            {selectionName ? <Check className="h-4 w-4 text-violet-300" /> : <Plus className="h-4 w-4 text-slate-600" />}
          </button>

          {selectionPanelOpen && (
            <div className="flex gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-2">
              <input
                value={selectionDraft}
                onChange={event => setSelectionDraft(event.target.value.slice(0, 60))}
                placeholder="Nome da seleção"
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 text-[9px] text-white outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const name = selectionDraft.trim();
                  if (!name) return;
                  setSelectionName(name);
                  setSelectionPanelOpen(false);
                }}
                className="rounded-lg bg-violet-500 px-3 text-[8px] font-black uppercase text-white"
              >
                Usar
              </button>
            </div>
          )}
        </div>

        {communityMessage && (
          <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[8px] text-sky-200">
            {communityMessage}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            const nativePublish = document.querySelector<HTMLButtonElement>(
              '#profile-social-hub-modal button[aria-label="Confirmar publicação"]'
            );
            nativePublish?.click();
            if (!selectedCommunityIdRef.current) {
              setPublishMenuOpen(false);
              setSelectionName('');
              setSelectionDraft('');
            }
          }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950"
        >
          <Send className="h-4 w-4" />
          Publicar agora
        </button>
      </section>
    ) : null,
    host
  );
}
