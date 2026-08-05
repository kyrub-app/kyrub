import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  Globe2,
  LockKeyhole,
  MapPin,
  Megaphone,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
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

const visibilityLabel = (
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
  const [wallDraft, setWallDraft] = useState('');
  const [discussionComposerOpen, setDiscussionComposerOpen] = useState(false);
  const [discussionTitle, setDiscussionTitle] = useState('');
  const [discussionContent, setDiscussionContent] = useState('');
  const [pageMessage, setPageMessage] = useState('');
  const mountRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const originalPlaceholderRef = useRef('');

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

    const synchronize = (): void => {
      const input = Array.from(
        document.querySelectorAll<HTMLInputElement>('input')
      ).find(item => item.placeholder.includes('Buscar pessoas e publicações'));
      const container = input?.parentElement;

      if (!input || !container) {
        setHost(null);
        return;
      }

      if (searchInputRef.current !== input) {
        if (searchInputRef.current && originalPlaceholderRef.current) {
          searchInputRef.current.placeholder = originalPlaceholderRef.current;
        }
        searchInputRef.current = input;
        originalPlaceholderRef.current = input.placeholder;
        input.placeholder = 'Buscar pessoas, publicações ou comunidades...';
        input.addEventListener('input', event =>
          setSearchValue((event.target as HTMLInputElement).value)
        );
      }

      let mount = container.parentElement?.querySelector<HTMLElement>(
        '[data-kyrub-communities-preview]'
      );
      if (!mount) {
        mount = document.createElement('div');
        mount.dataset.kyrubCommunitiesPreview = 'true';
        container.after(mount);
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

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      mountRef.current?.remove();
      if (searchInputRef.current && originalPlaceholderRef.current) {
        searchInputRef.current.placeholder = originalPlaceholderRef.current;
      }
    };
  }, []);

  useEffect(() => {
    if (!createOpen && !selectedCommunityId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [createOpen, selectedCommunityId]);

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

    if (listTab === 'trending') {
      return [...filtered].sort(
        (left, right) => right.memberCount - left.memberCount
      );
    }
    return filtered;
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
        <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-sky-500/25 via-violet-500/15 to-orange-500/20">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/75 text-xl font-black text-white shadow-xl">
            {community.name.charAt(0).toLocaleUpperCase('pt-BR')}
          </span>
          {(community.isMember || community.isOwner) && (
            <span className="absolute right-2 top-2 rounded-full border border-emerald-500/30 bg-slate-950/85 px-2 py-1 text-[7px] font-black uppercase text-emerald-300">
              Você participa
            </span>
          )}
        </div>
        <div className="p-3">
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
              Preview local: comunidades, participações, murais e discussões ficam apenas neste navegador até definirmos a infraestrutura definitiva.
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
                    placeholder="Ex.: Empreendedores do meu bairro"
                    className="mt-1.5 min-h-12 w-full rounded-2xl border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-500/60"
                  />
                </label>

                {similarCommunities.length > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <strong className="text-[8px] font-black uppercase text-amber-200">
                      Comunidades parecidas já existem
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
                          className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-left"
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
                    rows={4}
                    placeholder="Explique para quem é a comunidade e o que acontecerá nela."
                    className="mt-1.5 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
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
                      placeholder="Interesse ou finalidade"
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
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
                      placeholder="Cidade, bairro ou região"
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                    />
                  </label>
                </div>

                <fieldset>
                  <legend className="text-[8px] font-black uppercase text-slate-400">
                    Acesso
                  </legend>
                  <div className="mt-2 grid gap-2">
                    {(['public', 'moderated', 'private'] as const).map(value => {
                      const presentation = visibilityLabel(value);
                      const Icon = presentation.icon;
                      const active = createDraft.visibility === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setCreateDraft(current => ({
                              ...current,
                              visibility: value,
                            }))
                          }
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${
                            active
                              ? 'border-sky-500/45 bg-sky-500/10'
                              : 'border-slate-800 bg-slate-950'
                          }`}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sky-300">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-[9px] font-black text-white">
                              {presentation.label}
                            </strong>
                            <span className="mt-0.5 block text-[8px] text-slate-500">
                              {presentation.description}
                            </span>
                          </span>
                          {active && <Check className="h-4 w-4 text-sky-300" />}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">
                    Regras básicas
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
                    placeholder="Respeito, assuntos permitidos, publicidade e moderação."
                    className="mt-1.5 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                  />
                </label>

                {createError && (
                  <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                    {createError}
                  </p>
                )}
              </div>

              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button
                  type="submit"
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 text-[10px] font-black uppercase text-slate-950"
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
          <div className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4">
            <section className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl sm:h-auto sm:max-h-[96dvh] sm:rounded-3xl">
              <header className="relative overflow-hidden border-b border-slate-800 bg-gradient-to-br from-sky-500/25 via-violet-500/10 to-orange-500/20 p-4 sm:p-5">
                <div className="absolute inset-0 bg-slate-950/35" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedCommunityId('')}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-slate-950/75 text-white"
                      aria-label="Voltar para a Praça"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            `Conheça a comunidade ${selectedCommunity.name} no Kyrub.`
                          );
                          setPageMessage('Convite copiado para compartilhar.');
                        }}
                        className="flex min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/75 px-3 text-[8px] font-black uppercase text-white"
                      >
                        <UserPlus className="h-4 w-4" />
                        Convidar
                      </button>
                      {selectedCommunity.isOwner && (
                        <button
                          type="button"
                          onClick={() => setPageTab('about')}
                          className="flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-[8px] font-black uppercase text-slate-950"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Administrar
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-8 flex items-end gap-3">
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-slate-950/80 text-3xl font-black text-white shadow-2xl">
                      {selectedCommunity.name.charAt(0).toLocaleUpperCase('pt-BR')}
                    </span>
                    <div className="min-w-0 flex-1 pb-1">
                      <h2 className="line-clamp-2 text-xl font-black text-white sm:text-2xl">
                        {selectedCommunity.name}
                      </h2>
                      <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-300 sm:text-xs">
                        {selectedCommunity.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[8px] text-slate-300">
                        <span className="flex items-center gap-1 rounded-full bg-slate-950/65 px-2 py-1">
                          <Users className="h-3 w-3" />
                          {selectedCommunity.memberCount.toLocaleString('pt-BR')} membros
                        </span>
                        <span className="rounded-full bg-slate-950/65 px-2 py-1">
                          {visibilityLabel(selectedCommunity.visibility).label}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </header>

              <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950 px-3 py-2">
                {pageTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setPageTab(tab.id);
                        setPageMessage('');
                      }}
                      className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[8px] font-black uppercase ${
                        pageTab === tab.id
                          ? 'bg-sky-500 text-slate-950'
                          : 'border border-slate-800 bg-slate-900 text-slate-400'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <main className="flex-1 overflow-y-auto p-4 sm:p-5">
                {pageMessage && (
                  <p className="mb-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[9px] text-sky-200">
                    {pageMessage}
                  </p>
                )}

                {pageTab === 'wall' && (
                  <div className="space-y-4">
                    {selectedCommunity.isMember || selectedCommunity.isOwner ? (
                      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
                        <textarea
                          value={wallDraft}
                          onChange={event =>
                            setWallDraft(event.target.value.slice(0, 3000))
                          }
                          rows={3}
                          placeholder={`Publicar no mural de ${selectedCommunity.name}`}
                          className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={submitWallPost}
                            className="flex min-h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-[8px] font-black uppercase text-slate-950"
                          >
                            <MessageCircle className="h-4 w-4" />
                            Publicar no mural
                          </button>
                        </div>
                      </section>
                    ) : (
                      <section className="rounded-3xl border border-sky-500/20 bg-sky-500/5 p-4 text-center">
                        <Users className="mx-auto h-8 w-8 text-sky-300" />
                        <h3 className="mt-2 text-xs font-black text-white">
                          Participe para publicar
                        </h3>
                        <p className="mt-1 text-[9px] text-slate-500">
                          Entre na comunidade para criar publicações e discussões.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleMembership(selectedCommunity)}
                          className="mt-3 min-h-10 rounded-xl bg-sky-500 px-5 text-[8px] font-black uppercase text-slate-950"
                        >
                          Entrar na comunidade
                        </button>
                      </section>
                    )}

                    {selectedPosts.map(post => (
                      <article
                        key={post.id}
                        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-sm font-black text-sky-300">
                            {post.authorName.charAt(0).toLocaleUpperCase('pt-BR')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <strong className="block truncate text-[10px] text-white">
                              {post.authorName}
                            </strong>
                            <span className="text-[8px] text-slate-600">
                              {formatPreviewDate(post.createdAt)}
                            </span>
                          </div>
                        </div>
                        {post.content && (
                          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                            {post.content}
                          </p>
                        )}
                        {post.mediaUrls.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {post.mediaUrls.map((url, index) => (
                              <img
                                key={`${url}-${index}`}
                                src={url}
                                alt=""
                                className="aspect-square w-full rounded-2xl object-cover"
                              />
                            ))}
                          </div>
                        )}
                      </article>
                    ))}

                    {selectedPosts.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-10 text-center">
                        <MessageCircle className="mx-auto h-8 w-8 text-slate-700" />
                        <h3 className="mt-3 text-xs font-black text-slate-300">
                          O mural ainda está vazio
                        </h3>
                        <p className="mt-1 text-[9px] text-slate-600">
                          A primeira publicação dará início à comunidade.
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
                          Assuntos organizados que continuam pesquisáveis.
                        </p>
                      </div>
                      {(selectedCommunity.isMember || selectedCommunity.isOwner) && (
                        <button
                          type="button"
                          onClick={() =>
                            setDiscussionComposerOpen(current => !current)
                          }
                          className="flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
                        >
                          <Plus className="h-4 w-4" />
                          Novo tópico
                        </button>
                      )}
                    </div>

                    {discussionComposerOpen && (
                      <section className="space-y-2 rounded-3xl border border-sky-500/20 bg-sky-500/5 p-3">
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
                            setDiscussionContent(
                              event.target.value.slice(0, 3000)
                            )
                          }
                          rows={4}
                          placeholder="Explique a pergunta, ideia ou oportunidade."
                          className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDiscussionComposerOpen(false)}
                            className="min-h-9 rounded-xl px-3 text-[8px] font-black uppercase text-slate-500"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={submitDiscussion}
                            className="min-h-9 rounded-xl bg-sky-500 px-4 text-[8px] font-black uppercase text-slate-950"
                          >
                            Criar discussão
                          </button>
                        </div>
                      </section>
                    )}

                    {selectedDiscussions.map(discussion => (
                      <article
                        key={discussion.id}
                        className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="text-xs font-black text-white">
                              {discussion.title}
                            </h4>
                            <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                              {discussion.content}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-slate-950 px-2 py-1 text-[7px] text-slate-500">
                            {discussion.replyCount} respostas
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-[8px] text-slate-600">
                          <span>{discussion.authorName}</span>
                          <span>{formatPreviewDate(discussion.createdAt)}</span>
                        </div>
                      </article>
                    ))}

                    {selectedDiscussions.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-10 text-center">
                        <Users className="mx-auto h-8 w-8 text-slate-700" />
                        <p className="mt-3 text-[9px] font-black text-slate-400">
                          Nenhuma discussão iniciada
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {pageTab === 'notices' && (
                  <div className="space-y-3">
                    <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
                          <Megaphone className="h-4 w-4" />
                        </span>
                        <div>
                          <h3 className="text-xs font-black text-white">
                            Avisos da administração
                          </h3>
                          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                            Este espaço será usado para regras, eventos, oportunidades e comunicados importantes fixados pelos administradores.
                          </p>
                        </div>
                      </div>
                    </section>
                    <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-10 text-center">
                      <Megaphone className="mx-auto h-8 w-8 text-slate-700" />
                      <p className="mt-3 text-[9px] font-black text-slate-400">
                        Nenhum aviso publicado
                      </p>
                    </div>
                  </div>
                )}

                {pageTab === 'about' && (
                  <div className="space-y-3">
                    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                      <h3 className="text-xs font-black text-white">
                        Sobre a comunidade
                      </h3>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                        {selectedCommunity.description}
                      </p>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <span className="text-[7px] font-black uppercase text-slate-600">
                            Categoria
                          </span>
                          <strong className="mt-1 block text-[9px] text-slate-300">
                            {selectedCommunity.category}
                          </strong>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-3">
                          <span className="text-[7px] font-black uppercase text-slate-600">
                            Acesso
                          </span>
                          <strong className="mt-1 block text-[9px] text-slate-300">
                            {visibilityLabel(selectedCommunity.visibility).label}
                          </strong>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-3 sm:col-span-2">
                          <span className="flex items-center gap-1 text-[7px] font-black uppercase text-slate-600">
                            <MapPin className="h-3 w-3" />
                            Localização aproximada
                          </span>
                          <strong className="mt-1 block text-[9px] text-slate-300">
                            {selectedCommunity.location || 'Sem recorte geográfico'}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                      <h3 className="text-xs font-black text-white">Regras</h3>
                      <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-slate-400">
                        {selectedCommunity.rules}
                      </p>
                    </section>

                    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                      <h3 className="text-xs font-black text-white">
                        Administração
                      </h3>
                      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-slate-950 p-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/10 text-sky-300">
                          <ShieldCheck className="h-4 w-4" />
                        </span>
                        <div>
                          <strong className="block text-[9px] text-white">
                            {selectedCommunity.isOwner ? 'Você' : 'Equipe da comunidade'}
                          </strong>
                          <span className="text-[8px] text-slate-500">
                            Proprietário e administradores
                          </span>
                        </div>
                      </div>
                    </section>

                    {!selectedCommunity.isOwner && (
                      <button
                        type="button"
                        onClick={() => handleMembership(selectedCommunity)}
                        className={`min-h-11 w-full rounded-2xl border text-[9px] font-black uppercase ${
                          selectedCommunity.isMember
                            ? 'border-red-500/20 bg-red-500/5 text-red-300'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                        }`}
                      >
                        {selectedCommunity.isMember
                          ? 'Sair da comunidade'
                          : 'Entrar na comunidade'}
                      </button>
                    )}
                  </div>
                )}
              </main>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
