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
  ChevronRight,
  CircleAlert,
  Globe2,
  Import,
  LockKeyhole,
  MapPin,
  Megaphone,
  MessageCircle,
  Pencil,
  Plus,
  Reply,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useCommunityDirectory } from '../hooks/useCommunityDirectory';
import {
  addDebateComment,
  approveCommunityMember,
  createCommunity,
  createCommunityDebate,
  createCommunityPost,
  deleteDebateComment,
  hasLocalCommunityPrototype,
  importLocalCommunityPrototype,
  joinCommunity,
  leaveCommunity,
  OPEN_COMMUNITY_CLOUD_CREATE_EVENT,
  rejectCommunityMember,
  removeCommunityCover,
  subscribeCommunityDebates,
  subscribeCommunityMemberships,
  subscribeCommunityPosts,
  subscribeDebateComments,
  updateCommunity,
  updateDebateComment,
  updateDebateStatus,
  uploadCommunityCover,
  type CloudCommunity,
  type CloudCommunityDebate,
  type CloudCommunityDebateComment,
  type CloudCommunityMembership,
  type CloudCommunityPost,
  type CommunityVisibility,
} from '../utils/communityCloud';

type CommunityListTab = 'mine' | 'discover' | 'trending';
type CommunityPageTab = 'wall' | 'debates' | 'notices' | 'about';

type CreateDraft = {
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: CommunityVisibility;
  rules: string;
};

const initialCreateDraft: CreateDraft = {
  name: '',
  description: '',
  category: '',
  location: '',
  visibility: 'public',
  rules: '',
};

const formatDate = (value: string): string => {
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

const visibilityDetails = (visibility: CommunityVisibility) => {
  if (visibility === 'private') {
    return {
      label: 'Privada',
      description: 'Somente convidados podem encontrar e participar.',
      icon: LockKeyhole,
    };
  }
  if (visibility === 'moderated') {
    return {
      label: 'Moderada',
      description: 'O criador aprova cada solicitação de entrada.',
      icon: ShieldCheck,
    };
  }
  return {
    label: 'Pública',
    description: 'Qualquer usuário autenticado pode entrar.',
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

const prepareCoverBlob = async (file: File): Promise<Blob> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('A imagem deve ter no máximo 15 MB antes da redução.');
  }
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      element.src = source;
    });
    const maxWidth = 1800;
    const maxHeight = 1100;
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
    if (!context) throw new Error('Não foi possível preparar a imagem.');
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        blob =>
          blob
            ? resolve(blob)
            : reject(new Error('Não foi possível preparar a imagem.')),
        'image/jpeg',
        0.84
      )
    );
  } finally {
    URL.revokeObjectURL(source);
  }
};

function Avatar({ name, url }: { name: string; url: string }) {
  return url ? (
    <img
      src={url}
      alt=""
      className="h-9 w-9 shrink-0 rounded-xl object-cover"
    />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-[11px] font-black text-sky-200">
      {name.charAt(0).toLocaleUpperCase('pt-BR')}
    </span>
  );
}

function CommunityCover({
  community,
  className,
}: {
  community: CloudCommunity;
  className: string;
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
        <span className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/80">
          {community.name.charAt(0).toLocaleUpperCase('pt-BR')}
        </span>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-slate-950/15" />
    </div>
  );
}

export function ProfileCommunitiesCloudBridge() {
  const { user, communities, loading, error, activeCommunities } =
    useCommunityDirectory();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [listTab, setListTab] = useState<CommunityListTab>('mine');
  const [searchValue, setSearchValue] = useState('');
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [pageTab, setPageTab] = useState<CommunityPageTab>('wall');
  const [posts, setPosts] = useState<CloudCommunityPost[]>([]);
  const [debates, setDebates] = useState<CloudCommunityDebate[]>([]);
  const [members, setMembers] = useState<CloudCommunityMembership[]>([]);
  const [selectedDebateId, setSelectedDebateId] = useState('');
  const [comments, setComments] = useState<CloudCommunityDebateComment[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(initialCreateDraft);
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRules, setEditRules] = useState('');
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [removeCoverRequested, setRemoveCoverRequested] = useState(false);
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [wallDraft, setWallDraft] = useState('');
  const [debateComposerOpen, setDebateComposerOpen] = useState(false);
  const [debateTitle, setDebateTitle] = useState('');
  const [debateContent, setDebateContent] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [replyTo, setReplyTo] =
    useState<CloudCommunityDebateComment | null>(null);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [editingCommentText, setEditingCommentText] = useState('');
  const [message, setMessage] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [showLocalImport, setShowLocalImport] = useState(() =>
    hasLocalCommunityPrototype()
  );
  const mountRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchListenerRef = useRef<((event: Event) => void) | null>(null);

  const selectedCommunity = communities.find(
    community => community.id === selectedCommunityId
  );
  const selectedDebate = debates.find(debate => debate.id === selectedDebateId);
  const canParticipate = Boolean(
    selectedCommunity?.isOwner || selectedCommunity?.isActiveMember
  );

  useEffect(() => {
    const openCreate = () => {
      setCreateError('');
      setCreateOpen(true);
    };
    window.addEventListener(OPEN_COMMUNITY_CLOUD_CREATE_EVENT, openCreate);
    return () =>
      window.removeEventListener(OPEN_COMMUNITY_CLOUD_CREATE_EVENT, openCreate);
  }, []);

  useEffect(() => {
    let frame = 0;
    const detach = () => {
      if (searchInputRef.current && searchListenerRef.current) {
        searchInputRef.current.removeEventListener(
          'input',
          searchListenerRef.current
        );
      }
      searchInputRef.current = null;
      searchListenerRef.current = null;
    };
    const synchronize = () => {
      const modal = document.querySelector('#profile-social-hub-modal');
      const input = modal
        ? Array.from(modal.querySelectorAll<HTMLInputElement>('main input')).find(
            isSquareSearchInput
          ) ?? null
        : null;
      if (!input) {
        setHost(null);
        return;
      }
      if (searchInputRef.current !== input) {
        detach();
        input.id = 'profile-square-search-input';
        input.placeholder = 'Buscar pessoas, publicações ou comunidades...';
        const listener = (event: Event) =>
          setSearchValue((event.target as HTMLInputElement).value);
        input.addEventListener('input', listener);
        searchInputRef.current = input;
        searchListenerRef.current = listener;
        setSearchValue(input.value);
      }
      const searchContainer = input.parentElement;
      if (!searchContainer) return;
      let mount = searchContainer.parentElement?.querySelector<HTMLElement>(
        ':scope > [data-kyrub-cloud-communities]'
      );
      if (!mount || !mount.isConnected) {
        mount = document.createElement('div');
        mount.dataset.kyrubCloudCommunities = 'true';
        searchContainer.insertAdjacentElement('afterend', mount);
      }
      mountRef.current = mount;
      setHost(current => (current === mount ? current : mount));
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(schedule, 600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      observer.disconnect();
      detach();
      mountRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!selectedCommunityId) {
      setPosts([]);
      setDebates([]);
      setMembers([]);
      return;
    }
    const report = (value: Error) => {
      console.warn('Não foi possível sincronizar a comunidade.', value);
      setMessage('Algumas informações da comunidade não puderam ser carregadas.');
    };
    const unsubscribePosts = subscribeCommunityPosts(
      selectedCommunityId,
      setPosts,
      report
    );
    const unsubscribeDebates = subscribeCommunityDebates(
      selectedCommunityId,
      setDebates,
      report
    );
    const unsubscribeMembers = subscribeCommunityMemberships(
      selectedCommunityId,
      setMembers,
      report
    );
    return () => {
      unsubscribePosts();
      unsubscribeDebates();
      unsubscribeMembers();
    };
  }, [selectedCommunityId]);

  useEffect(() => {
    if (!selectedDebateId) {
      setComments([]);
      return;
    }
    return subscribeDebateComments(
      selectedDebateId,
      setComments,
      value => {
        console.warn('Não foi possível carregar os comentários.', value);
        setMessage('Não foi possível carregar todos os comentários agora.');
      }
    );
  }, [selectedDebateId]);

  useEffect(() => {
    if (
      !selectedCommunityId &&
      !createOpen &&
      !editOpen
    ) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [createOpen, editOpen, selectedCommunityId]);

  useEffect(
    () => () => {
      if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    },
    [coverPreview]
  );

  const normalizedSearch = searchValue.trim().toLocaleLowerCase('pt-BR');
  const visibleCommunities = useMemo(() => {
    const filtered = communities.filter(community => {
      const matches =
        !normalizedSearch ||
        `${community.name} ${community.description} ${community.category} ${community.location}`
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedSearch);
      if (!matches) return false;
      if (listTab === 'mine') {
        return community.isOwner || community.isActiveMember || community.isPendingMember;
      }
      return community.visibility !== 'private' || community.isOwner || community.isActiveMember;
    });
    return listTab === 'trending'
      ? [...filtered].sort((left, right) => right.memberCount - left.memberCount)
      : filtered;
  }, [communities, listTab, normalizedSearch]);

  const similarCommunities = useMemo(() => {
    const name = createDraft.name.trim().toLocaleLowerCase('pt-BR');
    if (name.length < 3) return [];
    return communities
      .filter(community =>
        community.name.toLocaleLowerCase('pt-BR').includes(name)
      )
      .slice(0, 3);
  }, [communities, createDraft.name]);

  const pendingMembers = members.filter(member => member.status === 'pending');

  const openCommunity = (community: CloudCommunity) => {
    setSelectedCommunityId(community.id);
    setPageTab('wall');
    setSelectedDebateId('');
    setMessage('');
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionBusy(key);
    setMessage('');
    try {
      await action();
    } catch (value) {
      setMessage(
        value instanceof Error ? value.message : 'Não foi possível concluir a ação.'
      );
    } finally {
      setActionBusy('');
    }
  };

  const handleMembership = async (community: CloudCommunity) => {
    if (community.isOwner) return;
    if (community.isPendingMember || community.isActiveMember) {
      await runAction(`membership-${community.id}`, async () => {
        await leaveCommunity(community.id);
        setMessage(
          community.isPendingMember
            ? 'Solicitação cancelada.'
            : 'Você saiu da comunidade.'
        );
      });
      return;
    }
    await runAction(`membership-${community.id}`, async () => {
      const status = await joinCommunity(community.id);
      setMessage(
        status === 'pending'
          ? 'Solicitação enviada ao criador.'
          : 'Você entrou na comunidade.'
      );
    });
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError('');
    try {
      const community = await createCommunity(createDraft);
      setCreateDraft(initialCreateDraft);
      setCreateOpen(false);
      openCommunity(community);
    } catch (value) {
      setCreateError(
        value instanceof Error ? value.message : 'Não foi possível criar a comunidade.'
      );
    } finally {
      setCreateBusy(false);
    }
  };

  const openEditor = () => {
    if (!selectedCommunity?.isOwner) return;
    setEditRules(selectedCommunity.rules);
    setCoverBlob(null);
    setCoverPreview(selectedCommunity.coverImage);
    setRemoveCoverRequested(false);
    setEditError('');
    setEditOpen(true);
  };

  const chooseCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setEditBusy(true);
    setEditError('');
    try {
      const blob = await prepareCoverBlob(file);
      if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverBlob(blob);
      setCoverPreview(URL.createObjectURL(blob));
      setRemoveCoverRequested(false);
    } catch (value) {
      setEditError(
        value instanceof Error ? value.message : 'Não foi possível preparar a capa.'
      );
    } finally {
      setEditBusy(false);
    }
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCommunity) return;
    setEditBusy(true);
    setEditError('');
    try {
      let coverImage = selectedCommunity.coverImage;
      let coverPath = selectedCommunity.coverPath;
      if (removeCoverRequested) {
        await removeCommunityCover(selectedCommunity);
        coverImage = '';
        coverPath = '';
      } else if (coverBlob) {
        const uploaded = await uploadCommunityCover(selectedCommunity, coverBlob);
        coverImage = uploaded.url;
        coverPath = uploaded.path;
      }
      await updateCommunity({
        communityId: selectedCommunity.id,
        rules: editRules,
        coverImage,
        coverPath,
      });
      setEditOpen(false);
      setMessage('Capa e regras atualizadas.');
    } catch (value) {
      setEditError(
        value instanceof Error
          ? value.message
          : 'Não foi possível atualizar a comunidade.'
      );
    } finally {
      setEditBusy(false);
    }
  };

  const submitWallPost = async () => {
    if (!selectedCommunity) return;
    await runAction('wall-post', async () => {
      await createCommunityPost({
        communityId: selectedCommunity.id,
        content: wallDraft,
      });
      setWallDraft('');
      setMessage('Publicação adicionada ao mural.');
    });
  };

  const submitDebate = async () => {
    if (!selectedCommunity) return;
    await runAction('new-debate', async () => {
      const debateId = await createCommunityDebate({
        communityId: selectedCommunity.id,
        title: debateTitle,
        content: debateContent,
      });
      setDebateTitle('');
      setDebateContent('');
      setDebateComposerOpen(false);
      setSelectedDebateId(debateId);
      setMessage('Debate iniciado.');
    });
  };

  const submitComment = async () => {
    if (!selectedCommunity || !selectedDebate) return;
    await runAction('comment', async () => {
      await addDebateComment({
        communityId: selectedCommunity.id,
        debateId: selectedDebate.id,
        text: commentDraft,
        parentCommentId: replyTo?.id,
      });
      setCommentDraft('');
      setReplyTo(null);
    });
  };

  const saveEditedComment = async (commentId: string) => {
    await runAction(`edit-comment-${commentId}`, async () => {
      await updateDebateComment(commentId, editingCommentText);
      setEditingCommentId('');
      setEditingCommentText('');
    });
  };

  const importLocal = async () => {
    await runAction('import-local', async () => {
      const imported = await importLocalCommunityPrototype();
      setShowLocalImport(false);
      setMessage(
        imported > 0
          ? `${imported} comunidade${imported === 1 ? '' : 's'} importada${
              imported === 1 ? '' : 's'
            } para este perfil.`
          : 'Este perfil já importou as comunidades locais disponíveis.'
      );
    });
  };

  const renderCard = (community: (typeof communities)[number]) => {
    const actionLabel = community.isOwner || community.isActiveMember
      ? 'Abrir'
      : community.isPendingMember
        ? 'Solicitado'
        : community.visibility === 'private'
          ? 'Por convite'
          : community.visibility === 'moderated'
            ? 'Solicitar'
            : 'Entrar';
    return (
      <article
        key={community.id}
        className="flex w-[172px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
      >
        <button type="button" onClick={() => openCommunity(community)} className="text-left">
          <CommunityCover community={community} className="h-24" />
          <div className="relative p-3">
            {(community.isOwner || community.isActiveMember) && (
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
              {community.category}
            </span>
          </div>
        </button>
        <div className="mt-auto border-t border-slate-800 p-2">
          <button
            type="button"
            disabled={
              actionBusy === `membership-${community.id}` ||
              community.visibility === 'private' &&
                !community.isOwner &&
                !community.isActiveMember
            }
            onClick={() =>
              community.isOwner || community.isActiveMember
                ? openCommunity(community)
                : void handleMembership(community)
            }
            className={`flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[8px] font-black uppercase disabled:opacity-45 ${
              community.isOwner || community.isActiveMember
                ? 'bg-slate-800 text-slate-200'
                : community.isPendingMember
                  ? 'border border-amber-500/25 bg-amber-500/10 text-amber-200'
                  : 'bg-sky-500 text-slate-950'
            }`}
          >
            {community.isOwner || community.isActiveMember ? (
              <MessageCircle className="h-3.5 w-3.5" />
            ) : community.isPendingMember ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </button>
        </div>
      </article>
    );
  };

  const pageTabs: Array<{
    id: CommunityPageTab;
    label: string;
    icon: typeof MessageCircle;
  }> = [
    { id: 'wall', label: 'Mural', icon: MessageCircle },
    { id: 'debates', label: 'Debates', icon: Users },
    { id: 'notices', label: 'Avisos', icon: Megaphone },
    { id: 'about', label: 'Sobre', icon: ShieldCheck },
  ];

  return (
    <>
      {host &&
        createPortal(
          <section
            className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-3"
            id="square-communities"
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

            {showLocalImport && user && (
              <button
                type="button"
                disabled={actionBusy === 'import-local'}
                onClick={() => void importLocal()}
                className="flex w-full items-center gap-3 rounded-2xl border border-violet-500/25 bg-violet-500/10 p-3 text-left disabled:opacity-45"
              >
                <Import className="h-5 w-5 shrink-0 text-violet-300" />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[9px] font-black uppercase text-violet-200">
                    Importar teste deste aparelho
                  </strong>
                  <span className="mt-0.5 block text-[8px] leading-relaxed text-slate-500">
                    O perfil conectado agora se tornará dono das comunidades locais importadas.
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-violet-300" />
              </button>
            )}

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

            {error && (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[8px] text-amber-200">
                {error}
              </p>
            )}

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

              {visibleCommunities.map(renderCard)}

              {!loading && visibleCommunities.length === 0 && (
                <div className="flex min-h-[210px] min-w-[230px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-5 text-center">
                  <div>
                    <Users className="mx-auto h-7 w-7 text-slate-700" />
                    <p className="mt-2 text-[9px] font-black text-slate-400">
                      Nenhuma comunidade encontrada
                    </p>
                    <p className="mt-1 text-[8px] text-slate-600">
                      Crie uma ou procure na aba Descobrir.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>,
          host
        )}

      {createOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[185] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4"
            onClick={() => setCreateOpen(false)}
            role="presentation"
          >
            <form
              onSubmit={submitCreate}
              onClick={event => event.stopPropagation()}
              className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <div>
                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
                    Nova comunidade
                  </span>
                  <h3 className="mt-1 text-lg font-black text-white">
                    Crie um espaço compartilhado
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
                  <span className="text-[8px] font-black uppercase text-slate-400">Nome</span>
                  <input
                    value={createDraft.name}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        name: event.target.value.slice(0, 80),
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none focus:border-sky-500/60"
                    placeholder="Ex.: Empreendedores do bairro"
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
                          <span className="text-[8px] text-slate-500">
                            {community.memberCount} membros
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">Descrição</span>
                  <textarea
                    value={createDraft.description}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        description: event.target.value.slice(0, 500),
                      }))
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                    placeholder="Explique o propósito da comunidade."
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-slate-400">Categoria</span>
                    <input
                      value={createDraft.category}
                      onChange={event =>
                        setCreateDraft(current => ({
                          ...current,
                          category: event.target.value.slice(0, 80),
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                      placeholder="Negócios, culinária..."
                    />
                  </label>
                  <label className="block">
                    <span className="text-[8px] font-black uppercase text-slate-400">Localização</span>
                    <input
                      value={createDraft.location}
                      onChange={event =>
                        setCreateDraft(current => ({
                          ...current,
                          location: event.target.value.slice(0, 120),
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                      placeholder="Cidade ou região"
                    />
                  </label>
                </div>
                <fieldset>
                  <legend className="text-[8px] font-black uppercase text-slate-400">Acesso</legend>
                  <div className="mt-2 grid gap-2">
                    {(['public', 'moderated', 'private'] as CommunityVisibility[]).map(
                      visibility => {
                        const details = visibilityDetails(visibility);
                        const Icon = details.icon;
                        const selected = createDraft.visibility === visibility;
                        return (
                          <button
                            key={visibility}
                            type="button"
                            onClick={() =>
                              setCreateDraft(current => ({ ...current, visibility }))
                            }
                            className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${
                              selected
                                ? 'border-sky-500/40 bg-sky-500/10'
                                : 'border-slate-800 bg-slate-950'
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-sky-300" />
                            <span className="min-w-0 flex-1">
                              <strong className="block text-[9px] text-white">{details.label}</strong>
                              <span className="mt-0.5 block text-[8px] text-slate-500">
                                {details.description}
                              </span>
                            </span>
                            {selected && <Check className="h-4 w-4 text-sky-300" />}
                          </button>
                        );
                      }
                    )}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">Regras</span>
                  <textarea
                    value={createDraft.rules}
                    onChange={event =>
                      setCreateDraft(current => ({
                        ...current,
                        rules: event.target.value.slice(0, 1200),
                      }))
                    }
                    rows={4}
                    className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                    placeholder="Convivência, assuntos permitidos e publicidade."
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
                  disabled={createBusy}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[9px] font-black uppercase text-slate-950 disabled:opacity-45"
                >
                  <Plus className="h-4 w-4" />
                  {createBusy ? 'Criando...' : 'Criar e abrir comunidade'}
                </button>
              </footer>
            </form>
          </div>,
          document.body
        )}

      {selectedCommunity &&
        createPortal(
          <div className="fixed inset-0 z-[175] bg-slate-950/95 backdrop-blur-md">
            <section className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border-x border-slate-800 bg-slate-950">
              {selectedDebate ? (
                <>
                  <header className="border-b border-slate-800 bg-slate-900/95 p-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDebateId('');
                          setReplyTo(null);
                          setEditingCommentId('');
                        }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-300"
                        aria-label="Voltar aos debates"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <span className="text-[8px] font-black uppercase tracking-[0.16em] text-sky-300">
                          Debate · {selectedCommunity.name}
                        </span>
                        <h2 className="mt-1 text-base font-black text-white">
                          {selectedDebate.title}
                        </h2>
                        <span className="mt-1 block text-[8px] text-slate-500">
                          {selectedDebate.commentCount}{' '}
                          {selectedDebate.commentCount === 1 ? 'comentário' : 'comentários'}
                        </span>
                      </div>
                      {(selectedCommunity.isOwner ||
                        selectedDebate.authorId === user?.uid) && (
                        <button
                          type="button"
                          disabled={actionBusy === 'debate-status'}
                          onClick={() =>
                            void runAction('debate-status', async () => {
                              await updateDebateStatus(
                                selectedDebate.id,
                                selectedDebate.status === 'open' ? 'closed' : 'open'
                              );
                            })
                          }
                          className="min-h-10 shrink-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[8px] font-black uppercase text-slate-300 disabled:opacity-40"
                        >
                          {selectedDebate.status === 'open' ? 'Encerrar' : 'Reabrir'}
                        </button>
                      )}
                    </div>
                  </header>
                  <main className="flex-1 overflow-y-auto p-4">
                    {message && (
                      <p className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[9px] text-sky-200">
                        {message}
                      </p>
                    )}
                    <article className="rounded-3xl border border-sky-500/20 bg-slate-900 p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={selectedDebate.authorName} url={selectedDebate.authorAvatar} />
                        <div>
                          <strong className="block text-[10px] text-white">
                            {selectedDebate.authorName}
                          </strong>
                          <span className="text-[8px] text-slate-600">
                            {formatDate(selectedDebate.createdAt)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-4 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                        {selectedDebate.content}
                      </p>
                    </article>

                    <section className="mt-4 space-y-3">
                      {comments.map(comment => {
                        const parent = comments.find(item => item.id === comment.parentCommentId);
                        const canManage =
                          comment.authorId === user?.uid || selectedCommunity.isOwner;
                        return (
                          <article
                            key={comment.id}
                            className={`rounded-3xl border border-slate-800 bg-slate-900 p-4 ${
                              comment.parentCommentId ? 'ml-5' : ''
                            }`}
                          >
                            {parent && (
                              <p className="mb-3 rounded-xl border-l-2 border-sky-500 bg-slate-950 px-3 py-2 text-[8px] text-slate-500">
                                Em resposta a <strong className="text-sky-300">{parent.authorName}</strong>: {parent.text.slice(0, 100)}
                              </p>
                            )}
                            <div className="flex items-start gap-3">
                              <Avatar name={comment.authorName} url={comment.authorAvatar} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <strong className="truncate text-[10px] text-white">
                                    {comment.authorName}
                                  </strong>
                                  <span className="shrink-0 text-[8px] text-slate-600">
                                    {formatDate(comment.createdAt)}
                                  </span>
                                </div>
                                {editingCommentId === comment.id ? (
                                  <div className="mt-2 space-y-2">
                                    <textarea
                                      value={editingCommentText}
                                      onChange={event =>
                                        setEditingCommentText(event.target.value.slice(0, 1400))
                                      }
                                      rows={3}
                                      className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void saveEditedComment(comment.id)}
                                        className="min-h-9 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
                                      >
                                        Salvar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingCommentId('')}
                                        className="min-h-9 rounded-xl border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-400"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-slate-300">
                                    {comment.text}
                                  </p>
                                )}
                              </div>
                            </div>
                            {editingCommentId !== comment.id && (
                              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                                {canParticipate && selectedDebate.status === 'open' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReplyTo(comment);
                                      setCommentDraft('');
                                    }}
                                    className="flex items-center gap-1 text-[8px] font-bold text-sky-300"
                                  >
                                    <Reply className="h-3.5 w-3.5" />
                                    Responder
                                  </button>
                                )}
                                {comment.authorId === user?.uid && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId(comment.id);
                                      setEditingCommentText(comment.text);
                                    }}
                                    className="flex items-center gap-1 text-[8px] font-bold text-slate-400"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Editar
                                  </button>
                                )}
                                {canManage && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!window.confirm('Excluir este comentário?')) return;
                                      void runAction(`delete-${comment.id}`, () =>
                                        deleteDebateComment(selectedDebate.id, comment.id)
                                      );
                                    }}
                                    className="flex items-center gap-1 text-[8px] font-bold text-red-300"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Excluir
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                      {comments.length === 0 && (
                        <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-10 text-center">
                          <MessageCircle className="mx-auto h-8 w-8 text-slate-700" />
                          <p className="mt-3 text-[10px] font-black text-slate-400">
                            Seja o primeiro a comentar
                          </p>
                        </div>
                      )}
                    </section>
                  </main>
                  <footer className="border-t border-slate-800 bg-slate-900/95 p-3">
                    {canParticipate && selectedDebate.status === 'open' ? (
                      <div>
                        {replyTo && (
                          <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-950 px-3 py-2 text-[8px] text-slate-500">
                            <span>
                              Respondendo a <strong className="text-sky-300">{replyTo.authorName}</strong>
                            </span>
                            <button type="button" onClick={() => setReplyTo(null)}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-end gap-2">
                          <textarea
                            value={commentDraft}
                            onChange={event => setCommentDraft(event.target.value.slice(0, 1400))}
                            rows={2}
                            placeholder="Escreva seu comentário neste debate..."
                            className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                          />
                          <button
                            type="button"
                            disabled={actionBusy === 'comment' || !commentDraft.trim()}
                            onClick={() => void submitComment()}
                            className="min-h-12 rounded-2xl bg-sky-500 px-4 text-[8px] font-black uppercase text-slate-950 disabled:opacity-35"
                          >
                            Comentar
                          </button>
                        </div>
                      </div>
                    ) : selectedDebate.status === 'closed' ? (
                      <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-center text-[9px] text-amber-200">
                        Este debate foi encerrado para novos comentários.
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={selectedCommunity.isPendingMember || selectedCommunity.visibility === 'private'}
                        onClick={() => void handleMembership(selectedCommunity)}
                        className="min-h-11 w-full rounded-xl bg-sky-500 text-[9px] font-black uppercase text-slate-950 disabled:opacity-45"
                      >
                        {selectedCommunity.isPendingMember
                          ? 'Solicitação aguardando aprovação'
                          : selectedCommunity.visibility === 'private'
                            ? 'Participação somente por convite'
                            : 'Entre na comunidade para comentar'}
                      </button>
                    )}
                  </footer>
                </>
              ) : (
                <>
                  <header className="border-b border-slate-800 bg-slate-900">
                    <div className="relative">
                      <CommunityCover community={selectedCommunity} className="h-36 sm:h-44" />
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
                          onClick={openEditor}
                          className="absolute right-3 top-3 flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-slate-950/80 px-3 text-[8px] font-black uppercase text-white backdrop-blur"
                        >
                          <Pencil className="h-4 w-4" />
                          Editar
                        </button>
                      )}
                    </div>
                    <div className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">Comunidade</span>
                        <h2 className="mt-0.5 text-lg font-black text-white">{selectedCommunity.name}</h2>
                        <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                          {selectedCommunity.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[8px] text-slate-400">
                          <span>{selectedCommunity.memberCount} membros</span>
                          <span>•</span>
                          <span>{visibilityDetails(selectedCommunity.visibility).label}</span>
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
                          disabled={actionBusy === `membership-${selectedCommunity.id}` || selectedCommunity.visibility === 'private' && !selectedCommunity.isActiveMember}
                          onClick={() => void handleMembership(selectedCommunity)}
                          className={`min-h-10 shrink-0 rounded-xl px-3 text-[8px] font-black uppercase disabled:opacity-45 ${
                            selectedCommunity.isActiveMember
                              ? 'border border-slate-700 bg-slate-800 text-slate-200'
                              : selectedCommunity.isPendingMember
                                ? 'border border-amber-500/25 bg-amber-500/10 text-amber-200'
                                : 'bg-sky-500 text-slate-950'
                          }`}
                        >
                          {selectedCommunity.isActiveMember
                            ? 'Sair'
                            : selectedCommunity.isPendingMember
                              ? 'Cancelar'
                              : selectedCommunity.visibility === 'moderated'
                                ? 'Solicitar'
                                : selectedCommunity.visibility === 'private'
                                  ? 'Por convite'
                                  : 'Entrar'}
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
                    {message && (
                      <p className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[9px] text-sky-200">
                        {message}
                      </p>
                    )}

                    {pageTab === 'wall' && (
                      <div className="space-y-3">
                        {canParticipate && (
                          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
                            <textarea
                              value={wallDraft}
                              onChange={event => setWallDraft(event.target.value.slice(0, 3000))}
                              rows={3}
                              placeholder="Publique no mural da comunidade..."
                              className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                            />
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                disabled={actionBusy === 'wall-post'}
                                onClick={() => void submitWallPost()}
                                className="min-h-10 rounded-xl bg-sky-500 px-4 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
                              >
                                Publicar no mural
                              </button>
                            </div>
                          </section>
                        )}
                        {posts.map(post => (
                          <article key={post.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                            <div className="flex items-center gap-3">
                              <Avatar name={post.authorName} url={post.authorAvatar} />
                              <div className="min-w-0 flex-1">
                                <strong className="block truncate text-[10px] text-white">{post.authorName}</strong>
                                <span className="text-[8px] text-slate-600">{formatDate(post.createdAt)}</span>
                              </div>
                            </div>
                            {post.content && (
                              <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-300">{post.content}</p>
                            )}
                            {post.mediaUrls[0] && (
                              <img src={post.mediaUrls[0]} alt="Imagem da publicação" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />
                            )}
                          </article>
                        ))}
                        {posts.length === 0 && (
                          <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-12 text-center">
                            <MessageCircle className="mx-auto h-8 w-8 text-slate-700" />
                            <p className="mt-3 text-[10px] font-black text-slate-400">O mural ainda está vazio</p>
                          </div>
                        )}
                      </div>
                    )}

                    {pageTab === 'debates' && (
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-black text-white">Debates da comunidade</h3>
                            <p className="mt-1 text-[8px] text-slate-500">Converse, responda e retome assuntos a qualquer momento.</p>
                          </div>
                          {canParticipate && (
                            <button
                              type="button"
                              onClick={() => setDebateComposerOpen(current => !current)}
                              className="min-h-9 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
                            >
                              Iniciar debate
                            </button>
                          )}
                        </div>
                        {debateComposerOpen && (
                          <section className="space-y-2 rounded-3xl border border-slate-800 bg-slate-900 p-3">
                            <input
                              value={debateTitle}
                              onChange={event => setDebateTitle(event.target.value.slice(0, 140))}
                              placeholder="Título do debate"
                              className="min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                            />
                            <textarea
                              value={debateContent}
                              onChange={event => setDebateContent(event.target.value.slice(0, 3000))}
                              rows={4}
                              placeholder="Apresente o assunto e convide outras pessoas a participar..."
                              className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                            />
                            <button
                              type="button"
                              disabled={actionBusy === 'new-debate'}
                              onClick={() => void submitDebate()}
                              className="min-h-10 w-full rounded-xl bg-sky-500 text-[8px] font-black uppercase text-slate-950 disabled:opacity-40"
                            >
                              Publicar debate
                            </button>
                          </section>
                        )}
                        {debates.map(debate => (
                          <button
                            key={debate.id}
                            type="button"
                            onClick={() => {
                              setSelectedDebateId(debate.id);
                              setMessage('');
                            }}
                            className="flex w-full items-start gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left"
                          >
                            <Avatar name={debate.authorName} url={debate.authorAvatar} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-start justify-between gap-3">
                                <strong className="text-xs font-black text-white">{debate.title}</strong>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[7px] font-black uppercase ${
                                  debate.status === 'open'
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : 'bg-slate-800 text-slate-500'
                                }`}>
                                  {debate.status === 'open' ? 'Aberto' : 'Encerrado'}
                                </span>
                              </span>
                              <span className="mt-2 line-clamp-2 block text-[10px] leading-relaxed text-slate-400">{debate.content}</span>
                              <span className="mt-3 flex items-center justify-between text-[8px] text-slate-600">
                                <span>{debate.authorName}</span>
                                <span>{debate.commentCount} {debate.commentCount === 1 ? 'comentário' : 'comentários'}</span>
                              </span>
                            </span>
                            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-600" />
                          </button>
                        ))}
                        {debates.length === 0 && (
                          <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-12 text-center">
                            <Users className="mx-auto h-8 w-8 text-slate-700" />
                            <p className="mt-3 text-[10px] font-black text-slate-400">Nenhum debate iniciado</p>
                          </div>
                        )}
                      </div>
                    )}

                    {pageTab === 'notices' && (
                      <div className="space-y-3">
                        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                          <div className="flex items-center gap-2 text-amber-200">
                            <Megaphone className="h-4 w-4" />
                            <h3 className="text-[10px] font-black uppercase">Avisos da administração</h3>
                          </div>
                          <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                            Regras, eventos e comunicados fixados aparecerão aqui em uma próxima etapa.
                          </p>
                        </section>
                      </div>
                    )}

                    {pageTab === 'about' && (
                      <div className="space-y-3">
                        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-[10px] font-black uppercase text-white">Sobre a comunidade</h3>
                            {selectedCommunity.isOwner && (
                              <button type="button" onClick={openEditor} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 text-[8px] font-black uppercase text-sky-200">
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </button>
                            )}
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-slate-300">{selectedCommunity.description}</p>
                          <dl className="mt-4 grid gap-3 text-[9px] sm:grid-cols-2">
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Categoria</dt><dd className="mt-1 text-slate-300">{selectedCommunity.category}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Acesso</dt><dd className="mt-1 text-slate-300">{visibilityDetails(selectedCommunity.visibility).label}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Localização</dt><dd className="mt-1 text-slate-300">{selectedCommunity.location || 'Não definida'}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Criador</dt><dd className="mt-1 text-slate-300">{selectedCommunity.ownerName}</dd></div>
                          </dl>
                        </section>
                        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                          <h3 className="text-[10px] font-black uppercase text-white">Regras</h3>
                          <p className="mt-3 whitespace-pre-line text-[10px] leading-relaxed text-slate-400">{selectedCommunity.rules}</p>
                        </section>
                        {selectedCommunity.isOwner && pendingMembers.length > 0 && (
                          <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                            <h3 className="text-[10px] font-black uppercase text-amber-200">Solicitações de entrada</h3>
                            <div className="mt-3 space-y-2">
                              {pendingMembers.map(member => (
                                <div key={member.id} className="flex items-center gap-3 rounded-2xl bg-slate-950 p-3">
                                  <Avatar name={member.userName} url={member.userAvatar} />
                                  <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-white">{member.userName}</span>
                                  <button
                                    type="button"
                                    onClick={() => void runAction(`approve-${member.id}`, () => approveCommunityMember(selectedCommunity.id, member.userId))}
                                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"
                                    aria-label="Aprovar participante"
                                  >
                                    <UserCheck className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void runAction(`reject-${member.id}`, () => rejectCommunityMember(selectedCommunity.id, member.userId))}
                                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-300"
                                    aria-label="Recusar participante"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                          <h3 className="text-[10px] font-black uppercase text-white">Participantes</h3>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {members.filter(member => member.status === 'active').slice(0, 20).map(member => (
                              <span key={member.id} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-[8px] text-slate-300">
                                <Avatar name={member.userName} url={member.userAvatar} />
                                {member.userName}
                              </span>
                            ))}
                          </div>
                        </section>
                      </div>
                    )}
                  </main>
                </>
              )}
            </section>
          </div>,
          document.body
        )}

      {editOpen && selectedCommunity?.isOwner &&
        createPortal(
          <div
            className="fixed inset-0 z-[195] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4"
            onClick={() => setEditOpen(false)}
            role="presentation"
          >
            <form
              onSubmit={submitEdit}
              onClick={event => event.stopPropagation()}
              className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <div>
                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">Administração</span>
                  <h3 className="mt-1 text-lg font-black text-white">Editar comunidade</h3>
                </div>
                <button type="button" onClick={() => setEditOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500" aria-label="Fechar edição">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="space-y-4 p-4">
                <section>
                  <span className="text-[8px] font-black uppercase text-slate-400">Imagem de capa</span>
                  <div className="mt-2 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
                    <div className="relative h-44">
                      {coverPreview && !removeCoverRequested ? (
                        <img src={coverPreview} alt="Prévia da capa" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-sky-500/20 via-violet-500/10 to-orange-500/20 text-slate-600">
                          <Camera className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3">
                      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950">
                        <Camera className="h-4 w-4" />
                        Escolher imagem
                        <input type="file" accept="image/*" className="hidden" disabled={editBusy} onChange={event => void chooseCover(event)} />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setCoverBlob(null);
                          setCoverPreview('');
                          setRemoveCoverRequested(true);
                        }}
                        disabled={(!selectedCommunity.coverImage && !coverBlob) || editBusy}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[8px] font-black uppercase text-red-300 disabled:opacity-35"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover capa
                      </button>
                    </div>
                  </div>
                </section>
                <label className="block">
                  <span className="text-[8px] font-black uppercase text-slate-400">Regras da comunidade</span>
                  <textarea
                    value={editRules}
                    onChange={event => setEditRules(event.target.value.slice(0, 1200))}
                    rows={8}
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                  />
                  <span className="mt-1 block text-right font-mono text-[8px] text-slate-600">{editRules.length}/1200</span>
                </label>
                {editError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[9px] text-red-300">{editError}</p>
                )}
              </div>
              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button type="submit" disabled={editBusy || !editRules.trim()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-[9px] font-black uppercase text-slate-950 disabled:opacity-40">
                  <Save className="h-4 w-4" />
                  {editBusy ? 'Salvando...' : 'Salvar capa e regras'}
                </button>
              </footer>
            </form>
          </div>,
          document.body
        )}
    </>
  );
}
