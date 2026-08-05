import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Camera,
  Check,
  Globe2,
  LockKeyhole,
  MapPin,
  Megaphone,
  MessageCircle,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  addPreviewCommunityDiscussion,
  addPreviewCommunityPost,
  COMMUNITY_PREVIEW_UPDATED_EVENT,
  createPreviewCommunity,
  loadPreviewCommunities,
  loadPreviewCommunityDiscussions,
  loadPreviewCommunityPosts,
  OPEN_COMMUNITY_PREVIEW_CREATE_EVENT,
  setPreviewCommunityMembership,
  updatePreviewCommunity,
  type PreviewCommunity,
  type PreviewCommunityDiscussion,
  type PreviewCommunityPost,
  type PreviewCommunityVisibility,
} from '../utils/communityPreview';

type CommunityListTab = 'mine' | 'discover' | 'trending';
type CommunityPageTab = 'wall' | 'discussions' | 'notices' | 'about';

type CreateCommunityDraft = {
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: PreviewCommunityVisibility;
  rules: string;
};

const initialCreateDraft: CreateCommunityDraft = {
  name: '',
  description: '',
  category: '',
  location: '',
  visibility: 'public',
  rules: '',
};

const formatPreviewDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Agora'
    : new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
};

const readAuthorName = (): string => {
  const profileModal = document.querySelector('#profile-social-hub-modal');
  return (
    Array.from(profileModal?.querySelectorAll<HTMLElement>('h3') ?? [])
      .map(item => item.textContent?.trim() ?? '')
      .find(Boolean) || 'Você'
  );
};

const visibilityDetails = (
  visibility: PreviewCommunityVisibility
): { label: string; description: string; icon: typeof Globe2 } => {
  if (visibility === 'private') {
    return {
      label: 'Privada',
      description: 'Somente convidados visualizam e participam.',
      icon: LockKeyhole,
    };
  }

  if (visibility === 'moderated') {
    return {
      label: 'Moderada',
      description: 'Novos membros precisam de aprovação.',
      icon: ShieldCheck,
    };
  }

  return {
    label: 'Pública',
    description: 'Qualquer pessoa pode descobrir e participar.',
    icon: Globe2,
  };
};

const isSquareSearchInput = (input: HTMLInputElement): boolean => {
  if (input.id === 'profile-square-search-input') return true;
  const placeholder = input.placeholder.toLocaleLowerCase('pt-BR');
  return (
    placeholder.startsWith('buscar') &&
    (placeholder.includes('publica') || placeholder.includes('comunidade')) &&
    Boolean(input.closest('#profile-social-hub-modal main'))
  );
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const prepareCoverImage = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.');
  }

  const source = await readFileAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1600;
      const maxHeight = 1000;
      const scale = Math.min(
        1,
        maxWidth / Math.max(1, image.naturalWidth),
        maxHeight / Math.max(1, image.naturalHeight)
      );
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Não foi possível preparar a imagem.'));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    image.src = source;
  });
};

function CommunityCover({
  community,
  className,
  showInitial = true,
}: {
  community: PreviewCommunity;
  className: string;
  showInitial?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-sky-500/25 via-violet-500/15 to-orange-500/20 ${className}`}
    >
      {community.coverImage ? (
        <img
          src={community.coverImage}
          alt={`Capa da comunidade ${community.name}`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        showInitial && (
          <span className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/80">
            {community.name.charAt(0).toLocaleUpperCase('pt-BR')}
          </span>
        )
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/15" />
    </div>
  );
}

export function ProfileCommunitiesPreviewBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [listTab, setListTab] = useState<CommunityListTab>('mine');
  const [searchValue, setSearchValue] = useState('');
  const [communities, setCommunities] = useState<PreviewCommunity[]>(() =>
    loadPreviewCommunities()
  );
  const [posts, setPosts] = useState<PreviewCommunityPost[]>(() =>
    loadPreviewCommunityPosts()
  );
  const [discussions, setDiscussions] = useState<PreviewCommunityDiscussion[]>(
    () => loadPreviewCommunityDiscussions()
  );
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [pageTab, setPageTab] = useState<CommunityPageTab>('wall');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] =
    useState<CreateCommunityDraft>(initialCreateDraft);
  const [createError, setCreateError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editRules, setEditRules] = useState('');
  const [editCoverImage, setEditCoverImage] = useState('');
  const [editError, setEditError] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const [wallDraft, setWallDraft] = useState('');
  const [discussionComposerOpen, setDiscussionComposerOpen] = useState(false);
  const [discussionTitle, setDiscussionTitle] = useState('');
  const [discussionContent, setDiscussionContent] = useState('');
  const [pageMessage, setPageMessage] = useState('');
  const mountRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchListenerRef = useRef<((event: Event) => void) | null>(null);

  const refresh = (): void => {
    setCommunities(loadPreviewCommunities());
    setPosts(loadPreviewCommunityPosts());
    setDiscussions(loadPreviewCommunityDiscussions());
  };

  useEffect(() => {
    window.addEventListener(COMMUNITY_PREVIEW_UPDATED_EVENT, refresh);
    const openCreate = (): void => {
      setCreateError('');
      setCreateOpen(true);
    };
    window.addEventListener(OPEN_COMMUNITY_PREVIEW_CREATE_EVENT, openCreate);

    return () => {
      window.removeEventListener(COMMUNITY_PREVIEW_UPDATED_EVENT, refresh);
      window.removeEventListener(
        OPEN_COMMUNITY_PREVIEW_CREATE_EVENT,
        openCreate
      );
    };
  }, []);

  useEffect(() => {
    let frame = 0;

    const detachSearchListener = (): void => {
      if (searchInputRef.current && searchListenerRef.current) {
        searchInputRef.current.removeEventListener(
          'input',
          searchListenerRef.current
        );
      }
      searchInputRef.current = null;
      searchListenerRef.current = null;
    };

    const synchronize = (): void => {
      const profileModal = document.querySelector('#profile-social-hub-modal');
      const input = profileModal
        ? Array.from(
            profileModal.querySelectorAll<HTMLInputElement>('main input')
          ).find(isSquareSearchInput) ?? null
        : null;

      if (!input) {
        setHost(null);
        return;
      }

      if (searchInputRef.current !== input) {
        detachSearchListener();
        input.id = 'profile-square-search-input';
        input.placeholder = 'Buscar pessoas, publicações ou comunidades...';
        const listener = (event: Event): void => {
          setSearchValue((event.target as HTMLInputElement).value);
        };
        input.addEventListener('input', listener);
        searchInputRef.current = input;
        searchListenerRef.current = listener;
        setSearchValue(input.value);
      }

      const searchContainer = input.parentElement;
      if (!searchContainer) return;

      let mount = searchContainer.parentElement?.querySelector<HTMLElement>(
        ':scope > [data-kyrub-communities-preview]'
      );

      if (!mount || !mount.isConnected) {
        mount = document.createElement('div');
        mount.dataset.kyrubCommunitiesPreview = 'true';
        searchContainer.insertAdjacentElement('afterend', mount);
      }

      mountRef.current = mount;
      setHost(current => (current === mount ? current : mount));
    };

    const schedule = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(schedule, 500);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      observer.disconnect();
      detachSearchListener();
      mountRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!createOpen && !selectedCommunityId && !editOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [createOpen, editOpen, selectedCommunityId]);

  const normalizedSearch = searchValue.trim().toLocaleLowerCase('pt-BR');
  const visibleCommunities = useMemo(() => {
    const filtered = communities.filter(community => {
      const matchesSearch =
        !normalizedSearch ||
        `${community.name} ${community.description} ${community.category} ${community.location}`
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedSearch);

      if (!matchesSearch) return false;
      if (listTab === 'mine') return community.isMember || community.isOwner;
      return true;
    });

    return listTab === 'trending'
      ? [...filtered].sort(
          (left, right) => right.memberCount - left.memberCount
        )
      : filtered;
  }, [communities, listTab, normalizedSearch]);

  const selectedCommunity = communities.find(
    community => community.id === selectedCommunityId
  );
  const selectedPosts = posts.filter(
    post => post.communityId === selectedCommunityId
  );
  const selectedDiscussions = discussions.filter(
    discussion => discussion.communityId === selectedCommunityId
  );

  const similarCommunities = useMemo(() => {
    const name = createDraft.name.trim().toLocaleLowerCase('pt-BR');
    if (name.length < 3) return [];
    return communities
      .filter(community =>
        community.name.toLocaleLowerCase('pt-BR').includes(name)
      )
      .slice(0, 3);
  }, [communities, createDraft.name]);

  const openCommunity = (community: PreviewCommunity): void => {
    setSelectedCommunityId(community.id);
    setPageTab('wall');
    setPageMessage('');
    setWallDraft('');
  };

  const openCommunityEditor = (): void => {
    if (!selectedCommunity?.isOwner) return;
    setEditRules(selectedCommunity.rules);
    setEditCoverImage(selectedCommunity.coverImage);
    setEditError('');
    setEditOpen(true);
  };

  const handleMembership = (community: PreviewCommunity): void => {
    if (community.isOwner) return;
    setPreviewCommunityMembership(community.id, !community.isMember);
    refresh();
  };

  const submitCreateCommunity = (event: FormEvent): void => {
    event.preventDefault();
    setCreateError('');

    try {
      const community = createPreviewCommunity(createDraft);
      setCreateDraft(initialCreateDraft);
      setCreateOpen(false);
      refresh();
      openCommunity(community);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar a comunidade.'
      );
    }
  };

  const readCoverImage = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setEditError('');
    try {
      setEditCoverImage(await prepareCoverImage(file));
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'Não foi possível usar a imagem.'
      );
    } finally {
      setCoverBusy(false);
    }
  };

  const submitCommunityEdit = (event: FormEvent): void => {
    event.preventDefault();
    if (!selectedCommunity) return;
    setEditError('');
    try {
      updatePreviewCommunity({
        communityId: selectedCommunity.id,
        rules: editRules,
        coverImage: editCoverImage,
      });
      refresh();
      setEditOpen(false);
      setPageMessage('Capa e regras atualizadas neste preview.');
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar a comunidade.'
      );
    }
  };

  const submitWallPost = (): void => {
    if (!selectedCommunity) return;

    try {
      addPreviewCommunityPost({
        communityId: selectedCommunity.id,
        authorName: readAuthorName(),
        content: wallDraft,
      });
      setWallDraft('');
      setPageMessage('Publicação adicionada ao mural local do preview.');
      refresh();
    } catch (error) {
      setPageMessage(
        error instanceof Error ? error.message : 'Revise a publicação.'
      );
    }
  };

  const submitDiscussion = (): void => {
    if (!selectedCommunity) return;

    try {
      addPreviewCommunityDiscussion({
        communityId: selectedCommunity.id,
        authorName: readAuthorName(),
        title: discussionTitle,
        content: discussionContent,
      });
      setDiscussionTitle('');
      setDiscussionContent('');
      setDiscussionComposerOpen(false);
      setPageMessage('Discussão criada neste preview.');
      refresh();
    } catch (error) {
      setPageMessage(
        error instanceof Error ? error.message : 'Revise a discussão.'
      );
    }
  };

  const renderCommunityCard = (community: PreviewCommunity) => (
    <article
      key={community.id}
      className="flex w-[168px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
    >
      <button
        type="button"
        onClick={() => openCommunity(community)}
        className="text-left"
      >
        <CommunityCover community={community} className="h-24" />
        <div className="relative p-3">
          {(community.isMember || community.isOwner) && (
            <span className="absolute -top-7 right-2 rounded-full border border-emerald-500/30 bg-slate-950/90 px-2 py-1 text-[7px] font-black uppercase text-emerald-300">
              Você participa
            </span>
          )}
          <strong className="block line-clamp-2 min-h-8 text-[10px] font-black text-white">
            {community.name}
          </strong>
          <span className="mt-1 block text-[8px] text-slate-500">
            {community.memberCount.toLocaleString('pt-BR')} membros
          </span>
          <span className="mt-1 block truncate text-[8px] text-sky-300/75">
            {community.activityLabel}
          </span>
        </div>
      </button>
      <div className="mt-auto border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={() =>
            community.isMember || community.isOwner
              ? openCommunity(community)
              : handleMembership(community)
          }
          className={`flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[8px] font-black uppercase ${
            community.isMember || community.isOwner
              ? 'bg-slate-800 text-slate-200'
              : 'bg-sky-500 text-slate-950'
          }`}
        >
          {community.isMember || community.isOwner ? (
            <MessageCircle className="h-3.5 w-3.5" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          {community.isMember || community.isOwner ? 'Abrir' : 'Entrar'}
        </button>
      </div>
    </article>
  );

  const pageTabs: Array<{
    id: CommunityPageTab;
    label: string;
    icon: typeof MessageCircle;
  }> = [
    { id: 'wall', label: 'Mural', icon: MessageCircle },
    { id: 'discussions', label: 'Discussões', icon: Users },
    { id: 'notices', label: 'Avisos', icon: Megaphone },
    { id: 'about', label: 'Sobre', icon: ShieldCheck },
  ];

  return (
    <>
      {host &&
        createPortal(
          <section
            className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-3"
            id="square-communities-preview"
            aria-label="Comunidades na Praça"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
                  Comunidades
                </span>
                <h3 className="mt-0.5 text-xs font-black text-white">
                  Encontre espaços para participar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex min-h-9 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
              >
                <Plus className="h-4 w-4" />
                Criar
              </button>
            </header>

            <div className="flex gap-1.5 overflow-x-auto">
              {([
                ['mine', 'Minhas'],
                ['discover', 'Descobrir'],
                ['trending', 'Em alta'],
              ] as Array<[CommunityListTab, string]>).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setListTab(id)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-[8px] font-black uppercase ${
                    listTab === id
                      ? 'bg-sky-500/15 text-sky-200'
                      : 'border border-slate-800 bg-slate-950 text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex w-[132px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-sky-500/30 bg-sky-500/5 p-4 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500 text-slate-950">
                  <Plus className="h-5 w-5" />
                </span>
                <strong className="mt-3 text-[9px] font-black uppercase text-sky-200">
                  Criar comunidade
                </strong>
                <span className="mt-1 text-[7px] leading-relaxed text-slate-500">
                  Reúna pessoas em torno de um interesse.
                </span>
              </button>

              {visibleCommunities.map(renderCommunityCard)}

              {visibleCommunities.length === 0 && listTab === 'mine' && (
                <div className="flex min-h-[210px] min-w-[230px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-5 text-center">
                  <div>
                    <Users className="mx-auto h-7 w-7 text-slate-700" />
                    <p className="mt-2 text-[9px] font-black text-slate-400">
                      Nenhuma comunidade ainda
                    </p>
                    <p className="mt-1 text-[8px] text-slate-600">
                      Crie uma ou entre em uma sugestão na aba Descobrir.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <p className="text-[7px] leading-relaxed text-slate-600">
              Preview local: comunidades, participações, capas, regras, murais e discussões ficam apenas neste navegador.
            </p>
          </section>,
          host
        )}

      {createOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[175] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-4"
            onClick={() => setCreateOpen(false)}
            role="presentation"
          >
            <form
              onSubmit={submitCreateCommunity}
              onClick={event => event.stopPropagation()}
              className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <div>
                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
                    Nova comunidade
                  </span>
                  <h3 className="mt-1 text-lg font-black text-white">
                    Crie um espaço de pertencimento
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"
                  aria-label="Fechar criação"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="space-y-4 p-4">
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Nome
                  </span>
                  <input
                    value={createDraft.name}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        name: event.target.value.slice(0, 80),
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-sky-500/60"
                    placeholder="Ex.: Empreendedores do meu bairro"
                  />
                </label>

                {similarCommunities.length > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <strong className="text-[8px] font-black uppercase text-amber-200">
                      Comunidades parecidas
                    </strong>
                    <div className="mt-2 space-y-1.5">
                      {similarCommunities.map(community => (
                        <button
                          key={community.id}
                          type="button"
                          onClick={() => {
                            setCreateOpen(false);
                            openCommunity(community);
                          }}
                          className="flex w-full items-center justify-between rounded-xl bg-slate-950 px-3 py-2 text-left"
                        >
                          <span className="truncate text-[9px] font-bold text-white">
                            {community.name}
                          </span>
                          <span className="shrink-0 text-[8px] text-slate-500">
                            {community.memberCount} membros
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Descrição
                  </span>
                  <textarea
                    value={createDraft.description}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        description: event.target.value.slice(0, 500),
                      }))
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                    placeholder="Explique quem deve participar e qual é o propósito."
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-slate-400">
                      Categoria
                    </span>
                    <input
                      value={createDraft.category}
                      onChange={event =>
                        setCreateDraft(current => ({
                          ...current,
                          category: event.target.value.slice(0, 60),
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                      placeholder="Negócios, culinária..."
                    />
                  </label>
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-slate-400">
                      Localização opcional
                    </span>
                    <input
                      value={createDraft.location}
                      onChange={event =>
                        setCreateDraft(current => ({
                          ...current,
                          location: event.target.value.slice(0, 80),
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                      placeholder="Cidade ou região"
                    />
                  </label>
                </div>

                <fieldset>
                  <legend className="text-[8px] font-black uppercase text-slate-400">
                    Acesso
                  </legend>
                  <div className="mt-2 grid gap-2">
                    {(
                      ['public', 'moderated', 'private'] as PreviewCommunityVisibility[]
                    ).map(visibility => {
                      const details = visibilityDetails(visibility);
                      const Icon = details.icon;
                      const selected = createDraft.visibility === visibility;
                      return (
                        <button
                          key={visibility}
                          type="button"
                          onClick={() =>
                            setCreateDraft(current => ({
                              ...current,
                              visibility,
                            }))
                          }
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${
                            selected
                              ? 'border-sky-500/40 bg-sky-500/10'
                              : 'border-slate-800 bg-slate-950'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-sky-300" />
                          <span className="min-w-0 flex-1">
                            <strong className="block text-[9px] text-white">
                              {details.label}
                            </strong>
                            <span className="mt-0.5 block text-[8px] text-slate-500">
                              {details.description}
                            </span>
                          </span>
                          {selected && <Check className="h-4 w-4 text-sky-300" />}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Regras
                  </span>
                  <textarea
                    value={createDraft.rules}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        rules: event.target.value.slice(0, 800),
                      }))
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                    placeholder="Respeito, assunto permitido, publicidade..."
                  />
                </label>

                {createError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
                    {createError}
                  </p>
                )}
              </div>

              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[9px] font-black uppercase text-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  Criar e abrir comunidade
                </button>
              </footer>
            </form>
          </div>,
          document.body
        )}

      {selectedCommunity &&
        createPortal(
          <div className="fixed inset-0 z-[170] bg-slate-950/95 backdrop-blur-md">
            <section className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border-x border-slate-800 bg-slate-950">
              <header className="border-b border-slate-800 bg-slate-900">
                <div className="relative">
                  <CommunityCover
                    community={selectedCommunity}
                    className="h-36 sm:h-44"
                    showInitial={false}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedCommunityId('')}
                    className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-slate-950/80 text-white backdrop-blur"
                    aria-label="Voltar para a Praça"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  {selectedCommunity.isOwner && (
                    <button
                      type="button"
                      onClick={openCommunityEditor}
                      className="absolute right-3 top-3 flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-slate-950/80 px-3 text-[8px] font-black uppercase text-white backdrop-blur"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar comunidade
                    </button>
                  )}
                </div>

                <div className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
                      Comunidade
                    </span>
                    <h2 className="mt-0.5 text-lg font-black text-white">
                      {selectedCommunity.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                      {selectedCommunity.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[8px] text-slate-400">
                      <span>{selectedCommunity.memberCount} membros</span>
                      <span>•</span>
                      <span>
                        {visibilityDetails(selectedCommunity.visibility).label}
                      </span>
                      {selectedCommunity.location && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {selectedCommunity.location}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {!selectedCommunity.isOwner && (
                    <button
                      type="button"
                      onClick={() => handleMembership(selectedCommunity)}
                      className={`min-h-10 shrink-0 rounded-xl px-3 text-[8px] font-black uppercase ${
                        selectedCommunity.isMember
                          ? 'border border-slate-700 bg-slate-800 text-slate-200'
                          : 'bg-sky-500 text-slate-950'
                      }`}
                    >
                      {selectedCommunity.isMember ? 'Sair' : 'Entrar'}
                    </button>
                  )}
                </div>
              </header>

              <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950 px-3 py-2">
                {pageTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPageTab(tab.id)}
                      className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[8px] font-black uppercase ${
                        pageTab === tab.id
                          ? 'bg-sky-500 text-slate-950'
                          : 'border border-slate-800 bg-slate-900 text-slate-500'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <main className="flex-1 overflow-y-auto p-4">
                {pageMessage && (
                  <p className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[9px] text-sky-200">
                    {pageMessage}
                  </p>
                )}

                {pageTab === 'wall' && (
                  <div className="space-y-3">
                    {(selectedCommunity.isMember || selectedCommunity.isOwner) && (
                      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
                        <textarea
                          value={wallDraft}
                          onChange={event =>
                            setWallDraft(event.target.value.slice(0, 3000))
                          }
                          rows={3}
                          placeholder="Publique no mural da comunidade..."
                          className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={submitWallPost}
                            className="min-h-10 rounded-xl bg-sky-500 px-4 text-[8px] font-black uppercase text-slate-950"
                          >
                            Publicar no mural
                          </button>
                        </div>
                      </section>
                    )}

                    {selectedPosts.map(post => (
                      <article
                        key={post.id}
                        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-[10px] text-white">
                            {post.authorName}
                          </strong>
                          <span className="text-[8px] text-slate-600">
                            {formatPreviewDate(post.createdAt)}
                          </span>
                        </div>
                        {post.content && (
                          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                            {post.content}
                          </p>
                        )}
                        {post.mediaUrls.length > 0 && (
                          <img
                            src={post.mediaUrls[0]}
                            alt="Imagem da publicação"
                            className="mt-3 max-h-80 w-full rounded-2xl object-cover"
                          />
                        )}
                      </article>
                    ))}

                    {selectedPosts.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-12 text-center">
                        <MessageCircle className="mx-auto h-8 w-8 text-slate-700" />
                        <p className="mt-3 text-[10px] font-black text-slate-400">
                          O mural ainda está vazio
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {pageTab === 'discussions' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-black text-white">
                          Discussões permanentes
                        </h3>
                        <p className="mt-1 text-[8px] text-slate-500">
                          Tópicos organizados que não somem no feed.
                        </p>
                      </div>
                      {(selectedCommunity.isMember || selectedCommunity.isOwner) && (
                        <button
                          type="button"
                          onClick={() =>
                            setDiscussionComposerOpen(current => !current)
                          }
                          className="min-h-9 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
                        >
                          Nova discussão
                        </button>
                      )}
                    </div>

                    {discussionComposerOpen && (
                      <section className="space-y-2 rounded-3xl border border-slate-800 bg-slate-900 p-3">
                        <input
                          value={discussionTitle}
                          onChange={event =>
                            setDiscussionTitle(event.target.value.slice(0, 140))
                          }
                          placeholder="Título da discussão"
                          className="min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                        />
                        <textarea
                          value={discussionContent}
                          onChange={event =>
                            setDiscussionContent(event.target.value.slice(0, 3000))
                          }
                          rows={4}
                          placeholder="Explique o assunto..."
                          className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={submitDiscussion}
                          className="min-h-10 w-full rounded-xl bg-sky-500 text-[8px] font-black uppercase text-slate-950"
                        >
                          Criar discussão
                        </button>
                      </section>
                    )}

                    {selectedDiscussions.map(discussion => (
                      <article
                        key={discussion.id}
                        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-xs font-black text-white">
                            {discussion.title}
                          </h4>
                          <span className="shrink-0 text-[8px] text-slate-600">
                            {discussion.replyCount} respostas
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-slate-400">
                          {discussion.content}
                        </p>
                        <div className="mt-3 flex items-center justify-between text-[8px] text-slate-600">
                          <span>{discussion.authorName}</span>
                          <span>{formatPreviewDate(discussion.createdAt)}</span>
                        </div>
                      </article>
                    ))}

                    {selectedDiscussions.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-12 text-center">
                        <Users className="mx-auto h-8 w-8 text-slate-700" />
                        <p className="mt-3 text-[10px] font-black text-slate-400">
                          Nenhuma discussão criada
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {pageTab === 'notices' && (
                  <div className="space-y-3">
                    <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex items-center gap-2 text-amber-200">
                        <Megaphone className="h-4 w-4" />
                        <h3 className="text-[10px] font-black uppercase">
                          Avisos da administração
                        </h3>
                      </div>
                      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                        Regras, eventos, oportunidades e comunicados fixados aparecerão aqui.
                      </p>
                    </section>
                    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-10 text-center text-[9px] text-slate-600">
                      Nenhum aviso publicado neste preview.
                    </div>
                  </div>
                )}

                {pageTab === 'about' && (
                  <div className="space-y-3">
                    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-[10px] font-black uppercase text-white">
                          Sobre a comunidade
                        </h3>
                        {selectedCommunity.isOwner && (
                          <button
                            type="button"
                            onClick={openCommunityEditor}
                            className="flex min-h-9 items-center gap-1.5 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 text-[8px] font-black uppercase text-sky-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                        )}
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-slate-300">
                        {selectedCommunity.description}
                      </p>
                      <dl className="mt-4 grid gap-3 text-[9px] sm:grid-cols-2">
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <dt className="font-black uppercase text-slate-600">
                            Categoria
                          </dt>
                          <dd className="mt-1 text-slate-300">
                            {selectedCommunity.category}
                          </dd>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <dt className="font-black uppercase text-slate-600">
                            Acesso
                          </dt>
                          <dd className="mt-1 text-slate-300">
                            {visibilityDetails(selectedCommunity.visibility).label}
                          </dd>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <dt className="font-black uppercase text-slate-600">
                            Localização
                          </dt>
                          <dd className="mt-1 text-slate-300">
                            {selectedCommunity.location || 'Não definida'}
                          </dd>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <dt className="font-black uppercase text-slate-600">
                            Administração
                          </dt>
                          <dd className="mt-1 text-slate-300">
                            {selectedCommunity.isOwner
                              ? 'Você é o dono'
                              : 'Administradores da comunidade'}
                          </dd>
                        </div>
                      </dl>
                    </section>
                    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                      <h3 className="text-[10px] font-black uppercase text-white">
                        Regras
                      </h3>
                      <p className="mt-3 whitespace-pre-line text-[10px] leading-relaxed text-slate-400">
                        {selectedCommunity.rules}
                      </p>
                    </section>
                  </div>
                )}
              </main>
            </section>
          </div>,
          document.body
        )}

      {editOpen && selectedCommunity?.isOwner &&
        createPortal(
          <div
            className="fixed inset-0 z-[185] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4"
            onClick={() => setEditOpen(false)}
            role="presentation"
          >
            <form
              onSubmit={submitCommunityEdit}
              onClick={event => event.stopPropagation()}
              className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <div>
                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
                    Administração
                  </span>
                  <h3 className="mt-1 text-lg font-black text-white">
                    Editar comunidade
                  </h3>
                  <p className="mt-1 text-[9px] text-slate-500">
                    Somente o criador visualiza este controle.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500"
                  aria-label="Fechar edição"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="space-y-4 p-4">
                <section>
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Imagem de capa
                  </span>
                  <div className="mt-2 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
                    <div className="relative h-44">
                      {editCoverImage ? (
                        <img
                          src={editCoverImage}
                          alt="Prévia da capa"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-sky-500/20 via-violet-500/10 to-orange-500/20 text-slate-600">
                          <Camera className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3">
                      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950">
                        <Camera className="h-4 w-4" />
                        {coverBusy ? 'Preparando...' : 'Escolher imagem'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={coverBusy}
                          onChange={event => void readCoverImage(event)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setEditCoverImage('')}
                        disabled={!editCoverImage || coverBusy}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[8px] font-black uppercase text-red-300 disabled:opacity-35"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover capa
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[8px] leading-relaxed text-slate-600">
                    A imagem é reduzida automaticamente para caber no armazenamento local do preview.
                  </p>
                </section>

                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Regras da comunidade
                  </span>
                  <textarea
                    value={editRules}
                    onChange={event =>
                      setEditRules(event.target.value.slice(0, 800))
                    }
                    rows={7}
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                    placeholder="Defina convivência, temas permitidos, publicidade e moderação."
                  />
                  <span className="mt-1 block text-right font-mono text-[8px] text-slate-600">
                    {editRules.length}/800
                  </span>
                </label>

                {editError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">
                    {editError}
                  </p>
                )}
              </div>

              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button
                  type="submit"
                  disabled={coverBusy}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40"
                >
                  <Save className="h-4 w-4" />
                  Salvar capa e regras
                </button>
              </footer>
            </form>
          </div>,
          document.body
        )}
    </>
  );
}
