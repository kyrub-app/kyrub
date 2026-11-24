import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  EllipsisVertical,
  Flag,
  Inbox,
  MessageCircle,
  Star,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { Friend, SocialPost } from '../types';
import { auth } from '../utils/firebase';
import {changeSocialBlock,useSocialBlocks,legacySocialBlocks} from '../hooks/useSocialBlocks';
import {BlockedContactsPanel} from './BlockedContactsPanel';
import { ContactPresentationModal } from './ContactPresentationModal';
import { submitSocialUserReport } from '../utils/socialReports';

type ExtendedSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  createdAt?: string;
};

type ConnectionRequest = {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
  bio?: string;
};

type PublicProfileTarget = {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
  bio?: string;
};

interface ConnectedContactsPanelProps {
  searchQuery: string;
  friends: Friend[];
  posts: SocialPost[];
  getSuggestions: () => Friend[];
  connectionRequests: ConnectionRequest[];
  setConectadosSubTab: (value: 'sugestoes' | 'solicitacoes') => void;
  handleToggleFriend: (id: string) => void;
  handleToggleFavoriteFriend: (id: string) => void;
  setSelectedChatUser: (value: Friend | null) => void;
  setShowChatModal: (value: boolean) => void;
  handleAcceptRequest: (request: unknown) => void;
  handleDeclineRequest: (id: string, name: string) => void;
  triggerToast: (
    message: string,
    type?: 'success' | 'error' | 'info'
  ) => void;
}

const readIdSet = (storageKey: string): Set<string> => {
  if (typeof window === 'undefined') return new Set<string>();

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : []
    );
  } catch (error) {
    console.warn('Não foi possível ler preferências da rede social.', error);
    return new Set<string>();
  }
};

const persistIdSet = (storageKey: string, values: Set<string>) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...values]));
  } catch (error) {
    console.warn('Não foi possível salvar preferências da rede social.', error);
  }
};

const normalizeSearch = (value: string) =>
  value.trim().toLocaleLowerCase('pt-BR');

const matchesUserSearch = (user: PublicProfileTarget, search: string) => {
  if (!search) return true;
  return [user.name, user.role, user.bio].some(value =>
    value?.toLocaleLowerCase('pt-BR').includes(search)
  );
};

function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      className={`${className} flex items-center justify-center bg-slate-950 text-slate-500`}
      role="img"
      aria-label={`Foto de ${name} não informada`}
    >
      <CircleUserRound className="h-1/2 w-1/2" />
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-700" />
      <h4 className="mt-3 text-xs font-black uppercase text-slate-300">
        {title}
      </h4>
      <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-slate-500">
        {description}
      </p>
    </div>
  );
}

function ListModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/90 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <section className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-900 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black uppercase text-white">
              {title}
            </h3>
            <p className="mt-0.5 truncate text-[9px] text-slate-500">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500 hover:text-white"
            aria-label={`Fechar ${title}`}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </section>
    </div>
  );
}

export function ConnectedContactsPanel({
  searchQuery,
  friends,
  posts,
  getSuggestions,
  connectionRequests,
  setConectadosSubTab,
  handleToggleFriend,
  handleToggleFavoriteFriend,
  setSelectedChatUser,
  setShowChatModal,
  handleAcceptRequest,
  handleDeclineRequest,
  triggerToast,
}: ConnectedContactsPanelProps) {
  const viewerId = auth.currentUser?.uid || 'anonymous';
  const hiddenSuggestionsKey = `kyrub_hidden_suggestions_${viewerId}`;
  const {entries:serverBlocks}=useSocialBlocks(auth.currentUser?.uid);
  const blockedUserIds=new Set([...serverBlocks.map(item=>item.id),...legacySocialBlocks(viewerId)]);
  const normalizedSearch = normalizeSearch(searchQuery);

  const [activeListModal, setActiveListModal] = useState<
    'suggestions' | 'requests' | null
  >(null);
  const [selectedPublicProfile, setSelectedPublicProfile] =
    useState<PublicProfileTarget | null>(null);
  const [openContactMenuId, setOpenContactMenuId] = useState<string | null>(null);
  const [openSuggestionMenuId, setOpenSuggestionMenuId] =
    useState<string | null>(null);
  const [statusIndexByFriend, setStatusIndexByFriend] = useState<
    Record<string, number>
  >({});
  const [hiddenSuggestionIds, setHiddenSuggestionIds] = useState<Set<string>>(
    () => readIdSet(hiddenSuggestionsKey)
  );
  useEffect(() => {
    setHiddenSuggestionIds(readIdSet(hiddenSuggestionsKey));
  }, [hiddenSuggestionsKey]);

  const extendedPosts = posts as ExtendedSocialPost[];

  const connectedFriends = useMemo(
    () =>
      friends.filter(friend => {
        if (!friend.added || friend.isProfileVisible === false) return false;
        if (blockedUserIds.has(friend.id)) return false;
        return matchesUserSearch(friend, normalizedSearch);
      }),
    [blockedUserIds, friends, normalizedSearch]
  );

  const suggestions = useMemo(
    () =>
      getSuggestions().filter(friend => {
        if (friend.isProfileVisible === false) return false;
        if (hiddenSuggestionIds.has(friend.id)) return false;
        if (blockedUserIds.has(friend.id)) return false;
        return matchesUserSearch(friend, normalizedSearch);
      }),
    [blockedUserIds, getSuggestions, hiddenSuggestionIds, normalizedSearch]
  );

  const statusesFor = (friend: Friend) =>
    extendedPosts.filter(
      post =>
        post.publicationType === 'status' &&
        (post.authorId === friend.id || post.user === friend.name)
    );

  const changeStatus = (friendId: string, count: number, direction: number) => {
    if (count <= 1) return;
    setStatusIndexByFriend(current => {
      const activeIndex = current[friendId] ?? 0;
      return {
        ...current,
        [friendId]: (activeIndex + direction + count) % count,
      };
    });
  };

  const openSuggestions = () => {
    setConectadosSubTab('sugestoes');
    setActiveListModal('suggestions');
  };

  const openRequests = () => {
    setConectadosSubTab('solicitacoes');
    setActiveListModal('requests');
  };

  const removeSuggestion = (friend: Friend) => {
    const next = new Set(hiddenSuggestionIds);
    next.add(friend.id);
    setHiddenSuggestionIds(next);
    persistIdSet(hiddenSuggestionsKey, next);
    setOpenSuggestionMenuId(null);
    triggerToast(`${friend.name} foi removido das sugestões.`, 'success');
  };

  const disconnectFriend = (friend: Friend) => {
    handleToggleFriend(friend.id);
    setOpenContactMenuId(null);
    triggerToast(`Conexão com ${friend.name} removida.`, 'success');
  };

  const blockFriend = async (friend: Friend) => {
    if(!window.confirm('Bloquear este contato em todos os seus dispositivos?'))return;
    setOpenContactMenuId(null);
    try{await changeSocialBlock(friend.id,true,viewerId);triggerToast(`${friend.name} foi bloqueado.`,'success');}
    catch{triggerToast('Não foi possível confirmar o bloqueio. Tente novamente.','error');}
  };

  const reportFriend = async (friend: Friend) => {
    setOpenContactMenuId(null);
    const reason = window.prompt(`Por que deseja denunciar ${friend.name}? Descreva brevemente o motivo:`, '');
    if (reason === null) return;
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 500) {
      triggerToast('Informe um motivo entre 3 e 500 caracteres.', 'error');
      return;
    }
    try {
      const outcome = await submitSocialUserReport(friend.id, normalizedReason);
      triggerToast(outcome === 'already_reported' ? 'Você já denunciou este usuário.' : 'Denúncia encaminhada à moderação.', 'success');
    } catch (error) {
      console.warn('Falha ao encaminhar denúncia de usuário.', error);
      triggerToast('Denúncia não enviada. Tente novamente.', 'error');
    }
  };

  return (
    <section
      className="mt-5 space-y-4 animate-fade-in"
      id="connected-contacts-redesign"
    >
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-900/85 p-1 shadow-lg">
        <button
          type="button"
          className="min-w-0 rounded-xl bg-orange-600 px-1 py-2 text-[8px] font-black uppercase tracking-tight text-white sm:text-[10px]"
          aria-current="page"
          aria-label="Contatos conectados"
        >
          <span className="block truncate">Conectados</span>
          <span className="mt-0.5 block font-mono text-[7px] text-orange-100">
            {connectedFriends.length}
          </span>
        </button>
        <button
          type="button"
          onClick={openSuggestions}
          className="min-w-0 rounded-xl px-1 py-2 text-[8px] font-black uppercase tracking-tight text-slate-400 hover:bg-slate-800 hover:text-white sm:text-[10px]"
          aria-label={`Abrir sugestões de conexão: ${suggestions.length}`}
        >
          <span className="block truncate">Sugestões</span>
          <span className="mt-0.5 block font-mono text-[7px] text-teal-400">
            {suggestions.length}
          </span>
        </button>
        <button
          type="button"
          onClick={openRequests}
          className="min-w-0 rounded-xl px-1 py-2 text-[8px] font-black uppercase tracking-tight text-slate-400 hover:bg-slate-800 hover:text-white sm:text-[10px]"
          aria-label={`Abrir solicitações de conexão: ${connectionRequests.length}`}
        >
          <span className="block truncate">Solicitações</span>
          <span className="mt-0.5 block font-mono text-[7px] text-orange-400">
            {connectionRequests.length}
          </span>
        </button>
      </div>

      {viewerId!=='anonymous'&&<BlockedContactsPanel uid={viewerId}/>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {connectedFriends.map(friend => {
          const statuses = statusesFor(friend);
          const requestedIndex = statusIndexByFriend[friend.id] ?? 0;
          const activeIndex = statuses.length > 0
            ? requestedIndex % statuses.length
            : 0;
          const activeStatus = statuses[activeIndex];
          const backgroundImage = activeStatus?.mediaUrls?.[0];

          return (
            <article
              key={friend.id}
              className="relative min-h-[250px] min-w-0 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-xl transition-colors hover:border-slate-700"
              data-contact-card={friend.id}
            >
              {backgroundImage && (
                <img
                  src={backgroundImage}
                  alt={`Status de ${friend.name}`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              {!backgroundImage && (
                <div className="absolute inset-0 bg-gradient-to-br from-teal-950 via-slate-900 to-orange-950" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/20 to-slate-950/95" />

              <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setSelectedPublicProfile(friend)}
                  className="flex min-w-0 items-center gap-2 text-left"
                  aria-label={`Abrir perfil público de ${friend.name}`}
                >
                  <Avatar
                    src={friend.avatar}
                    name={friend.name}
                    className="h-9 w-9 shrink-0 rounded-full border-2 border-orange-500 bg-slate-950 object-cover"
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-[10px] font-black text-white drop-shadow">
                      {friend.name}
                    </strong>
                    <span className="block truncate font-mono text-[7px] uppercase text-slate-300 drop-shadow">
                      {friend.role || 'Contato Kyrub'}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleFavoriteFriend(friend.id)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border backdrop-blur-md ${
                    friend.favorited
                      ? 'border-amber-400/50 bg-amber-500/25 text-amber-300'
                      : 'border-white/15 bg-slate-950/55 text-white/80'
                  }`}
                  aria-label={
                    friend.favorited
                      ? `Remover ${friend.name} dos favoritos`
                      : `Favoritar ${friend.name}`
                  }
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      friend.favorited ? 'fill-current' : ''
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={() => changeStatus(friend.id, statuses.length, -1)}
                disabled={statuses.length <= 1}
                className="absolute left-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-950/50 text-white backdrop-blur-md disabled:opacity-25"
                aria-label={`Status anterior de ${friend.name}`}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => changeStatus(friend.id, statuses.length, 1)}
                disabled={statuses.length <= 1}
                className="absolute right-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-950/50 text-white backdrop-blur-md disabled:opacity-25"
                aria-label={`Próximo status de ${friend.name}`}
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="absolute inset-x-9 top-1/2 z-[5] -translate-y-1/2 text-center">
                <span className="inline-flex rounded-full border border-white/10 bg-slate-950/45 px-2 py-1 font-mono text-[7px] font-black uppercase text-teal-300 backdrop-blur-md">
                  {activeStatus ? `Status ${activeIndex + 1}/${statuses.length}` : 'Sem status'}
                </span>
                <p className="mt-2 line-clamp-5 text-[10px] font-bold leading-relaxed text-white drop-shadow-lg">
                  {activeStatus?.content || friend.bio || 'Este contato ainda não publicou um status.'}
                </p>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChatUser(friend);
                    setShowChatModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-[8px] font-black uppercase text-white shadow-lg hover:bg-orange-500"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Chat
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenContactMenuId(current =>
                        current === friend.id ? null : friend.id
                      )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-slate-950/65 text-white backdrop-blur-md"
                    aria-label={`Mais opções para ${friend.name}`}
                  >
                    <EllipsisVertical className="h-4 w-4" />
                  </button>

                  {openContactMenuId === friend.id && (
                    <div className="absolute bottom-11 right-0 w-40 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => disconnectFriend(friend)}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[9px] font-bold text-slate-300 hover:bg-slate-900"
                      >
                        <UserMinus className="h-3.5 w-3.5 text-orange-400" />
                        Desconectar
                      </button>
                      <button
                        type="button"
                        onClick={() => blockFriend(friend)}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[9px] font-bold text-red-300 hover:bg-red-500/10"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Bloquear
                      </button>
                      <button
                        type="button"
                        onClick={() => void reportFriend(friend)}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[9px] font-bold text-amber-300 hover:bg-amber-500/10"
                      >
                        <Flag className="h-3.5 w-3.5" />
                        Denunciar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {connectedFriends.length === 0 && (
        <EmptyState
          icon={Users}
          title="Nenhum contato conectado"
          description="Aceite uma solicitação ou abra Sugestões para formar sua rede na Praça."
        />
      )}

      {activeListModal === 'suggestions' && (
        <ListModal
          title="Sugestões"
          subtitle="Perfis públicos que podem fazer parte da sua rede"
          onClose={() => {
            setActiveListModal(null);
            setOpenSuggestionMenuId(null);
          }}
        >
          {suggestions.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="Nenhuma sugestão disponível"
              description="Novos perfis públicos aparecerão aqui quando estiverem disponíveis para conexão."
            />
          ) : (
            <div className="space-y-3">
              {suggestions.map(friend => (
                <article
                  key={friend.id}
                  className="relative flex items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPublicProfile(friend)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-label={`Abrir perfil público de ${friend.name}`}
                  >
                    <Avatar
                      src={friend.avatar}
                      name={friend.name}
                      className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-xs font-black uppercase text-white">
                        {friend.name}
                      </strong>
                      <span className="block truncate text-[9px] text-slate-500">
                        {friend.bio || friend.role || 'Usuário Kyrub'}
                      </span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleFriend(friend.id)}
                      className={`rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                        friend.connectionStatus === 'pending_sent'
                          ? 'border border-slate-700 bg-slate-800 text-slate-300'
                          : 'bg-teal-500 text-slate-950'
                      }`}
                    >
                      {friend.connectionStatus === 'pending_sent'
                        ? 'Cancelar'
                        : 'Conectar'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSuggestionMenuId(current =>
                          current === friend.id ? null : friend.id
                        )
                      }
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                      aria-label={`Mais opções para sugestão ${friend.name}`}
                    >
                      <EllipsisVertical className="h-4 w-4" />
                    </button>
                  </div>

                  {openSuggestionMenuId === friend.id && (
                    <div className="absolute right-3 top-14 z-20 w-52 rounded-2xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => removeSuggestion(friend)}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[9px] font-bold text-slate-300 hover:bg-slate-900"
                      >
                        <UserMinus className="h-3.5 w-3.5 text-orange-400" />
                        Remover usuário das sugestões
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </ListModal>
      )}

      {activeListModal === 'requests' && (
        <ListModal
          title="Solicitações"
          subtitle="Pedidos pendentes para entrar na sua rede"
          onClose={() => setActiveListModal(null)}
        >
          {connectionRequests.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nenhuma solicitação pendente"
              description="Novos pedidos de conexão serão exibidos neste modal."
            />
          ) : (
            <div className="space-y-3">
              {connectionRequests.map(request => (
                <article
                  key={request.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPublicProfile(request)}
                    className="flex w-full min-w-0 items-center gap-3 text-left"
                    aria-label={`Abrir perfil público de ${request.name}`}
                  >
                    <Avatar
                      src={request.avatar}
                      name={request.name}
                      className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-xs font-black uppercase text-white">
                        {request.name}
                      </strong>
                      <span className="block truncate text-[9px] text-slate-500">
                        {request.bio || request.role || 'Usuário Kyrub'}
                      </span>
                    </span>
                  </button>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleAcceptRequest(request)}
                      className="rounded-xl bg-emerald-600 py-2 text-[9px] font-black uppercase text-white"
                    >
                      Aceitar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDeclineRequest(request.id, request.name)
                      }
                      className="rounded-xl border border-slate-800 bg-slate-950 py-2 text-[9px] font-black uppercase text-slate-400"
                    >
                      Recusar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </ListModal>
      )}

      {selectedPublicProfile&&<ContactPresentationModal
        targetId={selectedPublicProfile.id}
        onClose={()=>setSelectedPublicProfile(null)}
        onChat={connectedFriends.some(friend=>friend.id===selectedPublicProfile.id)?()=>{
          const friend=connectedFriends.find(item=>item.id===selectedPublicProfile.id);
          if(!friend)return;
          setSelectedPublicProfile(null);setSelectedChatUser(friend);setShowChatModal(true);
        }:undefined}
      />}
    </section>
  );
}
