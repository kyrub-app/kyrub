import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ImagePlus,
  Video,
  Check,
  CircleAlert,
  Globe2,
  Heart,
  LockKeyhole,
  MapPin,
  Megaphone,
  MessageCircle,
  ArrowUp,
  Plus,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useCommunityDirectory, type CommunityDirectoryItem, type PublicDirectoryCommunity } from '../hooks/useCommunityDirectory';
import { SquareDirectoryLayout } from './SquareDirectoryLayout';
import { CommunityPostCard } from './CommunityPostCard';
import { SemeaduraJourneyPanel } from './SemeaduraJourneyPanel';
import {
  approveCommunityMember,
  createCommunity,
  createCommunityPost,
  joinCommunity,
  leaveCommunity,
  OPEN_COMMUNITY_CLOUD_CREATE_EVENT,
  rejectCommunityMember,
  subscribeCommunityMemberships,
  subscribeCommunityPosts,
  saveCommunityProfile,
  uploadCommunityPostMedia,
  type CloudCommunity,
  type CloudCommunityMembership,
  type CloudCommunityPost,
  type CommunityVisibility,
} from '../utils/communityCloud';
import { auth, db } from '../utils/firebase';
import { probePublicCommunityRead, type PublicCommunityReadProbe } from '../utils/communityReadDiagnostic';
import { subscribeCommunityPostInteractions, toggleCommunityPostLike, addCommunityPostComment, deleteCommunityPostComment, submitCommunityPostReport, removeOwnCommunityPost, type CommunityPostLike, type CommunityPostComment } from '../utils/communityPostInteractions';
import { subscribeCommunityPostConnections, type CommunityPostConnection } from '../utils/communityPostConnections';
import { createPrivateCommunityGroup, sendCommunityGroupMessage, subscribeCommunityGroupMessages, subscribeMyCommunityGroups, type CloudCommunityGroup, type CloudCommunityGroupMessage } from '../utils/communityGroupsCloud';
import { issueCommunityGroupInvite } from '../utils/userNotifications';

import { subscribeSavedPublications } from '../utils/savedLibrary';
import { toggleCommunityPostSaveWithMetrics } from '../utils/communityOrganicMetrics';
import {
  OPEN_COMMUNITY_FROM_SQUARE_EVENT, subscribeCommunitySquareIds,
  withinCommunitySquareWindow, publishCommunityPostToSquare, removeCommunityPostFromSquare,
} from '../utils/communitySquareFeed';

type CommunityListTab = 'participating' | 'favorites' | 'trending';
type CommunityPageTab = 'wall' | 'notices' | 'about';

const selectCommunityDirectory = (
  entries: CommunityDirectoryItem[],
  tab: CommunityListTab,
  searchValue: string,
  favorites: ReadonlySet<string>,
): CommunityDirectoryItem[] => {
  const normalizedSearch = searchValue.trim().toLocaleLowerCase('pt-BR');
  const filtered = entries.filter(community => {
    const matches = !normalizedSearch ||
      `${community.name} ${community.description} ${community.category} ${community.location}`
        .toLocaleLowerCase('pt-BR').includes(normalizedSearch);
    if (!matches) return false;
    if (tab === 'participating') {
      return community.isOwner || community.isActiveMember;
    }
    // Private communities must never become publicly discoverable.
    const visible = community.visibility !== 'private' || community.isOwner || community.isActiveMember;
    if (!visible) return false;
    return tab !== 'favorites' || favorites.has(community.id);
  });
  return tab === 'trending'
    ? [...filtered].sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name, 'pt-BR'))
    : filtered;
};

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
    description: 'Qualquer Kairubido autenticado pode participar.',
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
  const { user, communities, publicCommunities, loading, error, activeCommunities } =
    useCommunityDirectory();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [listTab, setListTab] = useState<CommunityListTab>('trending');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<CommunityListTab>('trending');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [selectedPublicPreview, setSelectedPublicPreview] = useState<PublicDirectoryCommunity | null>(null);
  const [publicProbe, setPublicProbe] = useState<PublicCommunityReadProbe | null>(null);
  const [publicProbeBusy, setPublicProbeBusy] = useState(false);
  const [favoriteCommunityIds, setFavoriteCommunityIds] = useState<Set<string>>(new Set());
  const [favoriteBusyId, setFavoriteBusyId] = useState('');
  const [favoriteError, setFavoriteError] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [pageTab, setPageTab] = useState<CommunityPageTab>('wall');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [posts, setPosts] = useState<CloudCommunityPost[]>([]);
  const [postLikes, setPostLikes] = useState<CommunityPostLike[]>([]);
  const [postComments, setPostComments] = useState<CommunityPostComment[]>([]);
  const [postConnections, setPostConnections] = useState<CommunityPostConnection[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<CloudCommunityMembership[]>([]);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [myCommunityGroups, setMyCommunityGroups] = useState<CloudCommunityGroup[]>([]);
  const [groupsLoadError, setGroupsLoadError] = useState('');
  const [groupComposerOpen, setGroupComposerOpen] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupSaveError, setGroupSaveError] = useState('');
  const [groupSaveNotice, setGroupSaveNotice] = useState('');
  const [groupSelectedMemberIds, setGroupSelectedMemberIds] = useState<string[]>([]);
  const [groupInviteExistingId, setGroupInviteExistingId] = useState('');
  const [groupInviteTargetId, setGroupInviteTargetId] = useState('');
  const [activeGroupChatId, setActiveGroupChatId] = useState('');
  const [groupMessages, setGroupMessages] = useState<CloudCommunityGroupMessage[]>([]);
  const [groupMessageDraft, setGroupMessageDraft] = useState('');
  const [groupMessageError, setGroupMessageError] = useState('');
  const [groupMessageSending, setGroupMessageSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(initialCreateDraft);
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editRules, setEditRules] = useState('');
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [removeCoverRequested, setRemoveCoverRequested] = useState(false);
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [wallDraft, setWallDraft] = useState('');
  const [shareWallToSquare, setShareWallToSquare] = useState(true);
  const [squarePublishedIds, setSquarePublishedIds] = useState<Set<string>>(new Set());
  const [requestedSquareCommunityId, setRequestedSquareCommunityId] = useState('');
  const [requestedSquarePostId, setRequestedSquarePostId] = useState('');
  const [wallToolsOpen, setWallToolsOpen] = useState(false);
  const [wallMedia, setWallMedia] = useState<Array<{ file: File; preview: string }>>([]);
  const wallMediaRef = useRef<Array<{ file: File; preview: string }>>([]);
  useEffect(() => () => {
    wallMediaRef.current.forEach(item => URL.revokeObjectURL(item.preview));
    wallMediaRef.current = [];
  }, []);

  const clearWallMedia = () => {
    wallMediaRef.current.forEach(item => URL.revokeObjectURL(item.preview));
    wallMediaRef.current = [];
    setWallMedia([]);
    setWallToolsOpen(false);
  };

  const selectWallMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length) return;
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
    if (selected.some(file => !allowed.has(file.type) || file.size === 0 ||
      file.size > (file.type.startsWith('video/') ? 20 : 8) * 1024 * 1024)) {
      setMessage('Aceitamos imagens JPG/PNG/WebP até 8 MB e vídeos MP4/WebM até 20 MB.');
      return;
    }
    if (wallMediaRef.current.length + selected.length > 4) {
      setMessage('Você pode anexar até quatro fotos ou vídeos por publicação.');
      return;
    }
    const next = [...wallMediaRef.current, ...selected.map(file => ({ file, preview: URL.createObjectURL(file) }))];
    wallMediaRef.current = next;
    setWallMedia(next);
    setWallToolsOpen(false);
    setMessage('');
  };

  const removeWallMedia = (preview: string) => {
    URL.revokeObjectURL(preview);
    const next = wallMediaRef.current.filter(item => item.preview !== preview);
    wallMediaRef.current = next;
    setWallMedia(next);
  };
  const [message, setMessage] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const communityScrollRef = useRef<HTMLDivElement | null>(null);
  const communitySubscriptionVersion = useRef(0);
  const groupDirectorySubscriptionVersion = useRef(0);
  const groupMessageSubscriptionVersion = useRef(0);
  const mountRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchListenerRef = useRef<((event: Event) => void) | null>(null);

  useEffect(() => {
    setFavoriteCommunityIds(new Set());
    setFavoriteError('');
    if (!user?.uid) return;
    return onSnapshot(collection(db, 'users', user.uid, 'favorites'), snapshot => {
      const ids = new Set<string>();
      for (const entry of snapshot.docs) {
        const data = entry.data();
        if (data.kind === 'community' && typeof data.communityId === 'string' && data.communityId) {
          ids.add(data.communityId);
        }
      }
      setFavoriteCommunityIds(ids);
    }, () => setFavoriteError('Não foi possível sincronizar as comunidades favoritas.'));
  }, [user?.uid]);

  const toggleFavoriteCommunity = async (communityId: string): Promise<void> => {
    const viewer = auth.currentUser;
    if (!viewer || viewer.uid !== user?.uid) {
      setFavoriteError('Faça login para favoritar comunidades.');
      return;
    }
    if (favoriteBusyId) return;
    setFavoriteBusyId(communityId);
    setFavoriteError('');
    try {
      const reference = doc(db, 'users', viewer.uid, 'favorites', `community_${communityId}`);
      if (favoriteCommunityIds.has(communityId)) {
        await deleteDoc(reference);
      } else {
        await setDoc(reference, {
          kind: 'community',
          communityId,
          savedAt: serverTimestamp(),
        });
      }
    } catch {
      setFavoriteError('Não foi possível atualizar seu favorito. Tente novamente.');
    } finally {
      setFavoriteBusyId('');
    }
  };

  const selectedCommunity = communities.find(
    community => community.id === selectedCommunityId
  );
  const canParticipate = Boolean(
    selectedCommunity?.isOwner || selectedCommunity?.isActiveMember
  );

  useEffect(() => {
    if (!user) {
      setSavedPostIds(new Set());
      return;
    }
    return subscribeSavedPublications(
      items => setSavedPostIds(new Set(items.filter(item => item.sourceKind === 'community').map(item => item.sourceId))),
      error => console.warn('Não foi possível acompanhar Salvos das comunidades.', error)
    );
  }, [user?.uid]);

  useEffect(() => {
    setSquarePublishedIds(new Set());
    if (!selectedCommunityId) return;
    return subscribeCommunitySquareIds(
      selectedCommunityId,
      setSquarePublishedIds,
      error => console.warn('Não foi possível acompanhar a Praça para esta comunidade.', error),
    );
  }, [selectedCommunityId]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ communityId?: string; postId?: string }>).detail;
      const id = detail?.communityId;
      const postId = detail?.postId;
      if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        setRequestedSquareCommunityId(id);
        setRequestedSquarePostId(typeof postId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(postId) ? postId : '');
      }
    };
    window.addEventListener(OPEN_COMMUNITY_FROM_SQUARE_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMUNITY_FROM_SQUARE_EVENT, open);
  }, []);

  const inviteToExistingGroup = async (groupId: string): Promise<void> => {
    if (groupSaving || !auth.currentUser?.uid || !groupInviteExistingId || groupInviteTargetId !== groupId) return;
    const group = myCommunityGroups.find(item => item.id === groupId);
    if (!group || group.creatorId !== auth.currentUser.uid || group.memberIds.includes(groupInviteExistingId) || group.memberIds.length >= 50 ||
      !members.some(member => member.userId === groupInviteExistingId && member.status === 'active')) {
      setGroupSaveError('A seleção não está mais disponível para este grupo. Atualize os membros e tente novamente.');
      return;
    }
    setGroupInviteTargetId(groupId);
    setGroupSaving(true);
    setGroupSaveError('');
    setGroupSaveNotice('');
    try {
      const result = await issueCommunityGroupInvite(groupId, groupInviteExistingId);
      setGroupSaveNotice(result.created ? 'Convite enviado. A pessoa poderá aceitar ou recusar pelo sino.' : 'Esta pessoa já possui um convite pendente para o grupo.');
      setGroupInviteExistingId('');
      setGroupInviteTargetId('');
    } catch (error) {
      setGroupSaveError(error instanceof Error ? error.message : 'Não foi possível enviar o convite.');
    } finally {
      setGroupSaving(false);
      setGroupInviteTargetId('');
    }
  };

  const activeGroupAccessible = Boolean(
    user && myCommunityGroups.some(group =>
      group.id === activeGroupChatId &&
      group.communityId === selectedCommunityId &&
      group.memberIds.includes(user.uid)
    )
  );

  useEffect(() => {
    const version = ++groupMessageSubscriptionVersion.current;
    setGroupMessages([]);
    setGroupMessageError('');
    if (!groupsModalOpen || !selectedCommunityId || !canParticipate ||
        !activeGroupChatId || !activeGroupAccessible) return;
    const isCurrent = () => groupMessageSubscriptionVersion.current === version;
    try {
      const unsubscribe = subscribeCommunityGroupMessages(
        activeGroupChatId,
        values => { if (isCurrent()) setGroupMessages(values); },
        error => {
          if (isCurrent()) setGroupMessageError(error.message || 'Não foi possível carregar as mensagens.');
        }
      );
      return () => {
        ++groupMessageSubscriptionVersion.current;
        unsubscribe();
      };
    } catch (error) {
      if (isCurrent()) {
        setGroupMessageError(error instanceof Error ? error.message : 'Não foi possível abrir a conversa.');
      }
    }
  }, [groupsModalOpen, selectedCommunityId, canParticipate, activeGroupChatId, activeGroupAccessible, user?.uid]);

  const sendGroupChatMessage = async (): Promise<void> => {
    if (!activeGroupChatId || groupMessageSending) return;
    setGroupMessageSending(true);
    setGroupMessageError('');
    try {
      await sendCommunityGroupMessage(activeGroupChatId, groupMessageDraft);
      setGroupMessageDraft('');
    } catch (error) {
      setGroupMessageError(error instanceof Error ? error.message : 'Falha ao enviar mensagem.');
    } finally {
      setGroupMessageSending(false);
    }
  };

  const saveCommunityGroup = async (): Promise<void> => {
    if (!selectedCommunityId || !canParticipate || groupSaving) return;
    if (!auth.currentUser?.uid) {
      setGroupSaveError('Faça login novamente antes de criar um grupo.');
      return;
    }
    if (groupSelectedMemberIds.some(id => !members.some(member => member.userId === id && member.status === 'active'))) {
      setGroupSaveError('A seleção contém membros que não estão mais ativos. Atualize a lista antes de criar o grupo.');
      return;
    }
    if (new Set(groupSelectedMemberIds.filter(id => id !== auth.currentUser?.uid)).size > 49) {
      setGroupSaveError('Selecione no máximo 49 convidados por grupo (50 integrantes incluindo você).');
      return;
    }
    setGroupSaving(true);
    setGroupSaveError('');
    setGroupSaveNotice('');
    try {
      const groupId = await createPrivateCommunityGroup(selectedCommunityId, groupDraftName);
      const recipients = [...new Set(groupSelectedMemberIds)].filter(id => id !== auth.currentUser?.uid);
      const failed: string[] = [];
      for (const recipient of recipients) {
        try {
          await issueCommunityGroupInvite(groupId, recipient);
        } catch {
          failed.push(recipient);
        }
      }
      setGroupComposerOpen(false);
      setGroupDraftName('');
      setGroupSelectedMemberIds([]);
      if (failed.length) {
        setGroupSaveNotice(`Grupo criado. ${recipients.length - failed.length} convite(s) enviado(s); ${failed.length} falharam. Os convites não enviados precisarão ser reenviados quando a opção de reenvio estiver disponível.`);
      } else {
        setGroupSaveNotice(`Grupo criado. ${recipients.length} convite(s) enviado(s) pelo sino.`);
      }
    } catch (error) {
      setGroupSaveError(error instanceof Error ? error.message : 'Não foi possível criar o grupo.');
    } finally {
      setGroupSaving(false);
    }
  };

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
        searchInputRef.current.removeEventListener('input', searchListenerRef.current);
      }
      searchInputRef.current = null;
      searchListenerRef.current = null;
    };
    const synchronize = () => {
      const directHost = document.querySelector<HTMLElement>('#praca-communities-host');
      if (directHost) {
        detach();
        mountRef.current = directHost;
        setHost(current => (current === directHost ? current : directHost));
        return;
      }

      const modal = document.querySelector('#profile-social-hub-modal');
      const input = modal
        ? Array.from(modal.querySelectorAll<HTMLInputElement>('main input')).find(isSquareSearchInput) ?? null
        : null;
      if (!input) {
        setHost(null);
        return;
      }
      if (searchInputRef.current !== input) {
        detach();
        input.id = 'profile-square-search-input';
        input.placeholder = 'Buscar pessoas, publicações ou comunidades...';
        const listener = (event: Event) => setSearchValue((event.target as HTMLInputElement).value);
        input.addEventListener('input', listener);
        searchInputRef.current = input;
        searchListenerRef.current = listener;
        setSearchValue(input.value);
      }
      const searchContainer = input.parentElement;
      if (!searchContainer) return;
      let mount = searchContainer.parentElement?.querySelector<HTMLElement>(':scope > [data-kyrub-cloud-communities]');
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
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      detach();
      if (mountRef.current?.dataset.kyrubCloudCommunities === 'true') {
        mountRef.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    const version = ++communitySubscriptionVersion.current;
    setPosts([]);
    setPostLikes([]);
    setPostComments([]);
    setMembers([]);
    if (!selectedCommunityId) return;
    // Ignore late callbacks from a community that is no longer selected.
    const isCurrent = () => communitySubscriptionVersion.current === version;
    const report = (value: Error) => {
      if (!isCurrent()) return;
      console.warn('Não foi possível sincronizar a comunidade.', value);
      setMessage('Algumas informações da comunidade não puderam ser carregadas.');
    };
    const unsubscribePosts = subscribeCommunityPosts(
      selectedCommunityId,
      values => { if (isCurrent()) setPosts(values); },
      report
    );
    const unsubscribeMembers = subscribeCommunityMemberships(
      selectedCommunityId,
      values => { if (isCurrent()) setMembers(values); },
      report,
      { viewerId: user?.uid, ownerId: selectedCommunity?.ownerId, isOwner: selectedCommunity?.isOwner },
    );
    const unsubscribePostInteractions = subscribeCommunityPostInteractions(
      selectedCommunityId,
      values => { if (isCurrent()) setPostLikes(values); },
      values => { if (isCurrent()) setPostComments(values); },
      report,
    );
    return () => {
      ++communitySubscriptionVersion.current;
      unsubscribePosts();
      unsubscribeMembers();
      unsubscribePostInteractions();
    };
  }, [selectedCommunityId, selectedCommunity?.ownerId, selectedCommunity?.isOwner, user?.uid]);

  useEffect(() => {
    setPostConnections([]);
    if (!user?.uid || !selectedCommunityId) return;
    return subscribeCommunityPostConnections(user.uid, setPostConnections, error => {
      console.warn('Não foi possível acompanhar conexões do mural.', error);
      setPostConnections([]);
    });
  }, [user?.uid, selectedCommunityId]);

  useEffect(() => {
    const version = ++groupDirectorySubscriptionVersion.current;
    setMyCommunityGroups([]);
    setGroupsLoadError('');
    if (!groupsModalOpen || !selectedCommunityId || !canParticipate || !user) return;
    const isCurrent = () => groupDirectorySubscriptionVersion.current === version;
    try {
      const unsubscribe = subscribeMyCommunityGroups(
        selectedCommunityId,
        values => {
          if (isCurrent()) {
            setMyCommunityGroups(values.filter(group => group.communityId === selectedCommunityId));
          }
        },
        error => {
          if (!isCurrent()) return;
          console.warn('Não foi possível carregar grupos privados.', error);
          setGroupsLoadError('Não foi possível consultar seus grupos agora.');
        }
      );
      return () => {
        ++groupDirectorySubscriptionVersion.current;
        unsubscribe();
      };
    } catch {
      if (isCurrent()) setGroupsLoadError('Entre no Kyrub para consultar seus grupos.');
    }
  }, [groupsModalOpen, selectedCommunityId, canParticipate, user?.uid]);

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

  const publicOnlyCommunities = useMemo(() => {
    const authenticatedIds = new Set(communities.map(community => community.id));
    return publicCommunities.filter(community => !authenticatedIds.has(community.id));
  }, [communities, publicCommunities]);

  const selectPublicOnly = (tab: CommunityListTab, search: string, category = 'all') => {
    if (tab !== 'trending') return [];
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return publicOnlyCommunities.filter(community =>
      (category === 'all' || community.category.trim() === category) &&
      (!normalizedSearch ||
        [community.name, community.description, community.category]
          .join(' ').toLocaleLowerCase('pt-BR').includes(normalizedSearch))
    );
  };

  const visibleCommunities = useMemo(
    () => selectCommunityDirectory(communities, listTab, searchValue, favoriteCommunityIds),
    [communities, listTab, searchValue, favoriteCommunityIds],
  );
  const visiblePublicOnly = selectPublicOnly(listTab, searchValue);
  const catalogCategories = useMemo(
    () => [...new Set([
      ...selectCommunityDirectory(communities, 'trending', '', favoriteCommunityIds)
        .map(community => community.category.trim()),
      ...publicOnlyCommunities.map(community => community.category.trim()),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [communities, publicOnlyCommunities, favoriteCommunityIds],
  );
  const catalogCommunities = useMemo(
    () => selectCommunityDirectory(communities, catalogTab, catalogSearch, favoriteCommunityIds)
      .filter(community => catalogCategory === 'all' || community.category.trim() === catalogCategory),
    [communities, catalogTab, catalogSearch, catalogCategory, favoriteCommunityIds],
  );
  const catalogPublicOnly = selectPublicOnly(catalogTab, catalogSearch, catalogCategory);
  const catalogResultCount = catalogCommunities.length + catalogPublicOnly.length;

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

  const closeGroupsModal = () => {
    ++groupDirectorySubscriptionVersion.current;
    ++groupMessageSubscriptionVersion.current;
    setGroupsModalOpen(false);
    setMyCommunityGroups([]);
    setActiveGroupChatId('');
    setGroupMessages([]);
    setGroupMessageDraft('');
    setGroupMessageError('');
    setGroupComposerOpen(false);
    setGroupInviteExistingId('');
    setGroupInviteTargetId('');
  };

  const toggleGroupConversation = (groupId: string) => {
    ++groupMessageSubscriptionVersion.current;
    setGroupMessages([]);
    setGroupMessageError('');
    setGroupMessageDraft('');
    setActiveGroupChatId(current => current === groupId ? '' : groupId);
  };

  const openCommunity = (community: CloudCommunity) => {
    communityScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setShowBackToTop(false);
    // Invalidate all nested listeners before the next community becomes visible.
    closeGroupsModal();
    setMembersModalOpen(false);
    ++communitySubscriptionVersion.current;
    setPosts([]);
    setMembers([]);
    setSelectedCommunityId(community.id);
    clearWallMedia();
    setWallDraft('');
    setPageTab('wall');
    setMessage('');
  };

  useEffect(() => {
    if (!host || !requestedSquareCommunityId || loading) return;
    const community = communities.find(item => item.id === requestedSquareCommunityId);
    if (!community) {
      setMessage('Essa comunidade não está disponível para visita.');
      setRequestedSquareCommunityId('');
      return;
    }
    openCommunity(community);
    setRequestedSquareCommunityId('');
  }, [host, requestedSquareCommunityId, loading, communities]);

  useEffect(() => {
    if (!requestedSquarePostId || !selectedCommunityId ||
      pageTab !== 'wall' || !posts.some(post => post.id === requestedSquarePostId)) return;
    const postId = requestedSquarePostId;
    const frame = window.requestAnimationFrame(() => {
      const target = [...(communityScrollRef.current?.querySelectorAll<HTMLElement>(
        '[data-community-post-id]') || [])].find(item => item.dataset.communityPostId === postId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setRequestedSquarePostId('');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedSquarePostId, selectedCommunityId, pageTab, posts]);

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
          : 'Você agora participa da comunidade.'
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
    setEditName(selectedCommunity.name);
    setEditDescription(selectedCommunity.description);
    setEditCategory(selectedCommunity.category);
    setEditLocation(selectedCommunity.location);
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
    if (!selectedCommunity?.isOwner) return;
    if (!editName.trim() || !editDescription.trim() || !editCategory.trim() || !editRules.trim()) {
      setEditError('Informe nome, descrição, categoria e regras da comunidade.');
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      await saveCommunityProfile(selectedCommunity, {
        communityId: selectedCommunity.id,
        name: editName,
        description: editDescription,
        category: editCategory,
        location: editLocation,
        rules: editRules,
      }, coverBlob, removeCoverRequested);
      setEditOpen(false);
      setMessage('Informações da comunidade atualizadas.');
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
    if (!selectedCommunity || actionBusy === 'wall-post') return;
    const communityId = selectedCommunity.id;
    const content = wallDraft.trim();
    const attachments = [...wallMediaRef.current];
    if (!content && attachments.length === 0) {
      setMessage('Escreva algo ou adicione uma foto ou vídeo.');
      return;
    }
    await runAction('wall-post', async () => {
      const mediaUrls: string[] = [];
      for (const item of attachments) {
        mediaUrls.push(await uploadCommunityPostMedia(communityId, item.file));
      }
      await createCommunityPost({ communityId, content, mediaUrls, shareToSquare: selectedCommunity.visibility === 'public' && shareWallToSquare });
      if (selectedCommunityId === communityId) {
        setWallDraft('');
        setShareWallToSquare(true);
        clearWallMedia();
      }
      setMessage('Publicação adicionada ao mural.');
    });
  };

  const renderCard = (community: (typeof communities)[number], layout: 'rail' | 'catalog' = 'rail') => {
    const actionLabel = community.isOwner || community.isActiveMember
      ? 'Abrir'
      : community.isPendingMember
        ? 'Solicitado'
        : community.visibility === 'private'
          ? 'Por convite'
          : community.visibility === 'moderated'
            ? 'Solicitar'
            : 'Participar';
    return (
      <article
        key={community.id}
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 ${layout === 'catalog' ? 'min-w-0 w-full' : 'w-[206px] shrink-0'}`}
      >
        <button type="button" onClick={() => openCommunity(community)} className="text-left">
          <CommunityCover community={community} className="h-24" />
          <div className="relative p-3">
            {(community.isOwner || community.isActiveMember) && (
              <span className="absolute -top-7 right-2 rounded-full border border-emerald-500/30 bg-slate-950/90 px-2 py-1 text-xs font-black uppercase text-emerald-300">
                Você participa
              </span>
            )}
            <strong className="block line-clamp-2 min-h-8 text-sm font-black text-white">
              {community.name}
            </strong>
            <span className="mt-1 block text-xs text-slate-500">
              {community.memberCount.toLocaleString('pt-BR')} membros
            </span>
            <span className="mt-1 block truncate text-xs text-sky-300/75">
              {community.category}
            </span>
            {layout === 'catalog' && community.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                {community.description}
              </p>
            )}
          </div>
        </button>
        <button type="button"
          aria-pressed={favoriteCommunityIds.has(community.id)}
          aria-label={favoriteCommunityIds.has(community.id)
            ? `Remover ${community.name} dos favoritos`
            : `Favoritar comunidade ${community.name}`}
          disabled={favoriteBusyId === community.id}
          onClick={() => void toggleFavoriteCommunity(community.id)}
          className={`absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full border bg-slate-950/85 disabled:opacity-40 ${favoriteCommunityIds.has(community.id)
            ? 'border-rose-500/60 text-rose-300'
            : 'border-slate-600 text-white'}`}>
          <Heart className={`h-4 w-4 ${favoriteCommunityIds.has(community.id) ? 'fill-current' : ''}`} />
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
            className={`flex min-h-9 w-full items-center justify-center rounded-xl text-xs font-black uppercase disabled:opacity-45 ${
              community.isOwner || community.isActiveMember
                ? 'bg-slate-800 text-slate-200'
                : community.isPendingMember
                  ? 'border border-amber-500/25 bg-amber-500/10 text-amber-200'
                  : 'bg-sky-500 text-slate-950'
            }`}
          >
            {actionLabel}
          </button>
        </div>
      </article>
    );
  };

  /** Public discovery fallback. Never infer owner or membership from a card. */
  const renderPublicFallbackCard = (
    community: PublicDirectoryCommunity,
    layout: 'rail' | 'catalog' = 'rail',
  ) => (
    <article
      key={'public-' + community.id}
      data-public-community-fallback={community.id}
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 ${layout === 'catalog' ? 'min-w-0 w-full' : 'w-[206px] shrink-0'}`}
    >
      <button type="button" onClick={() => { setPublicProbe(null); setSelectedPublicPreview(community); }} className="text-left">
        <div className="flex h-24 items-center justify-center overflow-hidden bg-gradient-to-br from-sky-950 via-emerald-950 to-slate-800">
          {community.coverImage
            ? <img src={community.coverImage} alt="" aria-hidden="true" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
            : <Users className="h-9 w-9 text-sky-300" aria-hidden="true" />}
        </div>
        <div className="p-3">
          <strong className="block line-clamp-2 min-h-8 text-sm font-black text-white">{community.name}</strong>
          <span className="mt-1 block text-xs text-slate-400">{community.memberCount.toLocaleString('pt-BR')} membros</span>
          <span className="mt-1 block truncate text-xs text-sky-300/75">{community.category}</span>
          {layout === 'catalog' && community.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{community.description}</p>
          )}
        </div>
      </button>
      <div className="mt-auto border-t border-slate-800 p-2">
        <button type="button" onClick={() => { setPublicProbe(null); setSelectedPublicPreview(community); }}
          className="flex min-h-9 w-full items-center justify-center rounded-xl bg-slate-800 text-xs font-black uppercase text-slate-200">
          Conhecer
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
    { id: 'notices', label: 'Avisos', icon: Megaphone },
    { id: 'about', label: 'Sobre', icon: ShieldCheck },
  ];

  return (
    <>
      {groupsModalOpen && selectedCommunity && createPortal(
        <div className="fixed inset-0 z-[211] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur" role="presentation" onClick={closeGroupsModal}>
          <section role="dialog" aria-modal="true" aria-label="Grupos da comunidade" onClick={event => event.stopPropagation()} className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h3 className="text-base font-black text-white">Grupos</h3><p className="text-xs text-slate-400">{selectedCommunity.name}</p></div>
              <button type="button" onClick={closeGroupsModal} aria-label="Fechar grupos" className="rounded-xl border border-slate-700 p-2 text-slate-200"><X className="h-5 w-5" /></button>
            </div>
            {!groupComposerOpen ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">Organize conversas privadas com participantes desta comunidade.</p>
                {canParticipate && <button type="button" onClick={() => { setGroupDraftName(''); setGroupSelectedMemberIds([]); setGroupComposerOpen(true); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-sky-500 px-3 text-xs font-bold text-slate-950"><Plus className="h-4 w-4" /> Criar grupo</button>}
                {groupSaveError && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-xs text-red-200">{groupSaveError}</p>}
                {groupSaveNotice && <p role="status" className="rounded-xl border border-sky-800 bg-slate-900 p-3 text-xs text-sky-200">{groupSaveNotice}</p>}
                {groupsLoadError && <p role="alert" className="rounded-xl border border-amber-700 bg-slate-900 p-3 text-xs text-amber-300">{groupsLoadError}</p>}
                {!groupsLoadError && myCommunityGroups.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">Você ainda não participa de grupos nesta comunidade.</p>}
                {myCommunityGroups.map(group => <div key={group.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3"><p className="text-sm font-bold text-white">{group.name}</p><p className="text-xs text-slate-400">{group.memberIds.length} integrantes</p><button type="button" className="mt-2 rounded-lg border border-sky-700 px-3 py-2 text-xs text-sky-200" onClick={() => toggleGroupConversation(group.id)}> {activeGroupChatId === group.id ? "Fechar conversa" : "Abrir conversa"} </button>{activeGroupChatId === group.id && <div className="mt-3 space-y-2"><div role="log" aria-label={`Mensagens de ${group.name}`} className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-700 p-3">{groupMessages.length === 0 && <p className="text-xs text-slate-400">Nenhuma mensagem ainda.</p>}{groupMessages.map(message => <div key={message.id} className="rounded-lg bg-slate-800 p-2"><p className="text-xs text-sky-300">{message.authorId === auth.currentUser?.uid ? "Você" : members.find(member => member.userId === message.authorId)?.userName || "Integrante"}</p><p className="whitespace-pre-wrap break-words text-xs text-white">{message.text}</p></div>)}</div><textarea aria-label="Mensagem para o grupo" maxLength={3000} value={groupMessageDraft} onChange={event => setGroupMessageDraft(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white" rows={2} /><button type="button" disabled={groupMessageSending || !groupMessageDraft.trim()} onClick={() => void sendGroupChatMessage()} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Enviar mensagem</button>{groupMessageError && <p role="alert" className="text-xs text-red-300">{groupMessageError}</p>}</div>}{group.creatorId === auth.currentUser?.uid && <div className="mt-3 flex flex-wrap items-center gap-2"><select aria-label={`Convidar membro para ${group.name}`} value={groupInviteTargetId === group.id ? groupInviteExistingId : ""} onChange={event => { setGroupInviteTargetId(group.id); setGroupInviteExistingId(event.target.value); }} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white"><option value="">Selecione um membro</option>{members.filter(member => member.status === 'active' && member.userId !== auth.currentUser?.uid && !group.memberIds.includes(member.userId)).map(member => <option key={member.id} value={member.userId}>{member.userName}</option>)}</select><button type="button" disabled={groupInviteTargetId !== group.id || !groupInviteExistingId || groupSaving || group.memberIds.length >= 50} onClick={() => void inviteToExistingGroup(group.id)} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Convidar</button></div>}</div>)}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-300">Nome do grupo
                  <input value={groupDraftName} onChange={event => setGroupDraftName(event.target.value.slice(0,80))} maxLength={80} placeholder="Ex.: Equipe do projeto" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" />
                </label>
                <p className="text-xs font-bold text-slate-300">Selecionar membros ({groupSelectedMemberIds.length}/49 convidados)</p>
                {members.filter(member => member.status === 'active' && member.userId !== user?.uid).map(member => (
                  <label key={member.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-white">
                    <input type="checkbox" checked={groupSelectedMemberIds.includes(member.userId)} disabled={!groupSelectedMemberIds.includes(member.userId) && groupSelectedMemberIds.length >= 49} onChange={event => setGroupSelectedMemberIds(current => event.target.checked ? [...current,member.userId] : current.filter(id => id !== member.userId))} />
                    <span className="min-w-0 flex-1 truncate">{member.userName}</span>
                  </label>
                ))}
                <p className="text-xs text-slate-400">Os membros selecionados receberão um convite no sino e só entrarão após aceitar.</p>
                {groupSaveError && <p role="alert" className="text-xs text-red-300">{groupSaveError}</p>}
                <button type="button" disabled={groupSaving || !groupDraftName.trim()} onClick={() => void saveCommunityGroup()} className="min-h-10 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white disabled:opacity-50">{groupSaving ? 'Criando e enviando convites...' : 'Criar grupo e convidar'}</button>
                <button type="button" onClick={() => setGroupComposerOpen(false)} className="min-h-10 rounded-xl border border-slate-700 px-4 text-xs text-slate-200">Voltar</button>
              </div>
            )}
          </section>
        </div>, document.body
      )}
      {membersModalOpen && selectedCommunity && createPortal(
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur" role="presentation" onClick={() => setMembersModalOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Membros da comunidade" onClick={event => event.stopPropagation()} className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h3 className="text-base font-black text-white">Membros</h3><p className="text-xs text-slate-400">{selectedCommunity.name}</p></div>
              <button type="button" onClick={() => setMembersModalOpen(false)} aria-label="Fechar membros" className="rounded-xl border border-slate-700 p-2 text-slate-200"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2">
              {!selectedCommunity.isOwner && selectedCommunity.memberCount > members.filter(member => member.status === 'active').length && (
                <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
                  Exibindo o criador e seu perfil. Há {selectedCommunity.memberCount} participantes nesta comunidade;
                  as solicitações pendentes permanecem privadas.
                </p>
              )}
              {members.filter(member => member.status === 'active').map(member => (
                <div key={member.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <Avatar name={member.userName} url={member.userAvatar} />
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-white">{member.userName}</p><p className="text-xs text-slate-400">{member.role === 'owner' ? 'Criador' : member.role === 'moderator' ? 'Moderador' : 'Membro'}</p></div>
                </div>
              ))}
              {members.every(member => member.status !== 'active') && <p className="text-xs text-slate-400">Nenhum membro ativo encontrado.</p>}
            </div>
          </section>
        </div>, document.body
      )}
      {host &&
        createPortal(
          <section
            className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-4"
            id="square-communities"
            aria-label="Comunidades na Praça"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">
                  Comunidades
                </span>
                <h3 className="mt-1 text-base font-black text-white">
                  Encontre espaços para participar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCatalogTab('trending');
                  setCatalogSearch('');
                  setCatalogCategory('all');
                  setCatalogOpen(true);
                }}
                aria-label="Ver todas as comunidades"
                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-black uppercase text-slate-950"
              >
                Ver todas <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>


            <div className="flex gap-1.5 overflow-x-auto">
              {([
                ['participating', 'Participante'],
                ['favorites', 'Favoritos'],
                ['trending', 'Em alta'],
              ] as Array<[CommunityListTab, string]>).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setListTab(id)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black uppercase ${
                    listTab === id
                      ? 'bg-sky-500/15 text-sky-200'
                      : 'border border-slate-800 bg-slate-950 text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {(error || favoriteError) && (
              <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                {error || favoriteError}
              </p>
            )}

            <div className="flex gap-2.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex w-[154px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-sky-500/30 bg-sky-500/5 p-4 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500 text-slate-950">
                  <Plus className="h-5 w-5" />
                </span>
                <strong className="mt-3 text-xs font-black uppercase text-sky-200">
                  Criar comunidade
                </strong>
                <span className="mt-1 text-xs leading-relaxed text-slate-400">
                  Reúna pessoas em torno de um interesse.
                </span>
              </button>

              {visibleCommunities.map(community => renderCard(community))}
              {visiblePublicOnly.map(community => renderPublicFallbackCard(community))}

              {!loading && visibleCommunities.length + visiblePublicOnly.length === 0 && (
                <div className="flex min-h-[210px] min-w-[230px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-5 text-center">
                  <div>
                    <Users className="mx-auto h-7 w-7 text-slate-700" />
                    <p className="mt-2 text-xs font-black text-slate-400">
                      Nenhuma comunidade encontrada
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Crie uma ou procure na aba Descobrir.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>,
          host
        )}

      {selectedPublicPreview && createPortal(
        <div className="fixed inset-0 z-[205] flex items-center justify-center bg-slate-950/95 p-4"
          role="presentation" onClick={() => setSelectedPublicPreview(null)}>
          <section role="dialog" aria-modal="true" aria-label={`Conhecer ${selectedPublicPreview.name}`}
            onClick={event => event.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-xl font-black text-white">{selectedPublicPreview.name}</h3>
            <p className="text-xs text-sky-300">{selectedPublicPreview.category} · {selectedPublicPreview.memberCount} membros</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{selectedPublicPreview.description}</p>
            <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
              Esta comunidade consta na Praça pública, mas os dados completos não foram disponibilizados pela leitura autenticada.
              Por segurança, participar, editar e excluir permanecem indisponíveis até confirmar as permissões do registro.
            </p>
            <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs leading-5 text-slate-400">
                Diagnóstico opcional: compara a consulta do Firebase com o cache deste aparelho.
                Não modifica dados nem envia informações pessoais.
              </p>
              <button type="button" disabled={publicProbeBusy}
                onClick={() => {
                  if (!selectedPublicPreview || publicProbeBusy) return;
                  const targetId = selectedPublicPreview.id;
                  setPublicProbeBusy(true);
                  setPublicProbe(null);
                  void probePublicCommunityRead(targetId)
                    .then(result => setPublicProbe(result))
                    .catch(() => setPublicProbe(null))
                    .finally(() => setPublicProbeBusy(false));
                }}
                className="min-h-11 w-full rounded-xl border border-sky-600/50 bg-sky-950 text-sm font-bold text-sky-200 disabled:opacity-50">
                {publicProbeBusy ? 'Verificando acesso…' : 'Verificar leitura no meu aparelho'}
              </button>
              {publicProbe && (
                <div role="status" aria-label="Resultado do diagnóstico de acesso"
                  className="space-y-2 text-xs leading-5 text-slate-300">
                  <p><strong>Documento direto:</strong> {publicProbe.directServer}</p>
                  <p><strong>Proprietário da sessão:</strong> {publicProbe.ownerMatchesSession}</p>
                  <p><strong>Leitor canônico:</strong> {publicProbe.canonicalMapper}</p>
                  <p><strong>Consulta pública:</strong> {publicProbe.publicQuery}</p>
                  <p><strong>Consulta do proprietário:</strong> {publicProbe.ownerQuery}</p>
                  <p><strong>Cache:</strong> {publicProbe.cache}</p>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setSelectedPublicPreview(null)}
              className="min-h-11 w-full rounded-xl border border-slate-600 text-sm font-semibold text-white">
              Voltar
            </button>
          </section>
        </div>, document.body
      )}

      {catalogOpen && (
        <SquareDirectoryLayout
          ariaLabel="Catálogo de comunidades"
          title="Todas as comunidades"
          subtitle="Descubra espaços para participar no Kairube."
          searchId="community-catalog-search"
          searchLabel="Buscar comunidades"
          searchPlaceholder="Nome, categoria ou assunto..."
          searchValue={catalogSearch}
          onSearchChange={setCatalogSearch}
          selectedTab={catalogTab}
          onTabChange={setCatalogTab}
          categories={catalogCategories}
          category={catalogCategory}
          onCategoryChange={setCatalogCategory}
          onClose={() => setCatalogOpen(false)}
        >
          {(error || favoriteError) && (
            <p role="alert" className="mb-3 rounded-xl border border-amber-500/20 p-3 text-xs text-amber-200">
              {error || favoriteError}
            </p>
          )}
          <p className="mb-3 text-xs text-slate-400" aria-live="polite">
            {loading ? 'Carregando comunidades…' :
              `${catalogResultCount} ${catalogResultCount === 1 ? 'comunidade encontrada' : 'comunidades encontradas'}`}
          </p>
          <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {catalogCommunities.map(community => renderCard(community, 'catalog'))}
            {catalogPublicOnly.map(community => renderPublicFallbackCard(community, 'catalog'))}
          </div>
          {!loading && catalogResultCount === 0 && (
            <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
              Nenhuma comunidade encontrada. Experimente outra busca ou filtro.
            </p>
          )}
        </SquareDirectoryLayout>
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
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-300">
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
                  <span className="text-[11px] font-black uppercase text-slate-400">Nome</span>
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
                    <strong className="text-[11px] font-black uppercase text-amber-200">
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
                          <span className="truncate text-xs font-bold text-white">
                            {community.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {community.memberCount} membros
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="block">
                  <span className="text-[11px] font-black uppercase text-slate-400">Descrição</span>
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
                    <span className="text-[11px] font-black uppercase text-slate-400">Categoria</span>
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
                    <span className="text-[11px] font-black uppercase text-slate-400">Localização</span>
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
                  <legend className="text-[11px] font-black uppercase text-slate-400">Acesso</legend>
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
                              <strong className="block text-xs text-white">{details.label}</strong>
                              <span className="mt-0.5 block text-[11px] text-slate-500">
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
                  <span className="text-[11px] font-black uppercase text-slate-400">Regras</span>
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
                  <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {createError}
                  </p>
                )}
              </div>
              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button
                  type="submit"
                  disabled={createBusy}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-xs font-black uppercase text-slate-950 disabled:opacity-45"
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
            <section className="relative mx-auto flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border-x border-slate-800 bg-slate-950">
              <>
                  <div
                    id="community-page-scroll"
                    ref={communityScrollRef}
                    onScroll={event => setShowBackToTop(event.currentTarget.scrollTop > 240)}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                  >
                  <header className="border-b border-slate-800 bg-slate-900">
                    <div className="relative">
                      <CommunityCover community={selectedCommunity} className="h-36 sm:h-44" />
                      <button
                        type="button"
                        onClick={() => {
                          ++communitySubscriptionVersion.current;
                          closeGroupsModal();
                          setMembersModalOpen(false);
                                                setSelectedCommunityId('');
                        }}
                        className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-slate-950/80 text-white backdrop-blur"
                        aria-label={catalogOpen ? "Voltar para o catálogo de comunidades" : "Voltar para a Praça"}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-300">Comunidade</span>
                        <h2 className="mt-0.5 text-lg font-black text-white">{selectedCommunity.name}</h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                          {selectedCommunity.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <button type="button" onClick={() => setMembersModalOpen(true)} className="underline underline-offset-4 hover:text-sky-300" aria-label="Ver membros da comunidade">{selectedCommunity.memberCount} {selectedCommunity.memberCount === 1 ? 'membro' : 'membros'}</button>
                          <span>•</span>
                          <button type="button" onClick={() => { setGroupsModalOpen(true); setGroupComposerOpen(false); setGroupSaveNotice(''); setGroupSaveError(''); }} className="underline underline-offset-4 hover:text-sky-300" aria-label="Ver grupos da comunidade">Grupos</button>
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
                          className={`min-h-10 shrink-0 rounded-xl px-3 text-[11px] font-black uppercase disabled:opacity-45 ${
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
                                  : 'Participar'}
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
                          onClick={() => {
                            setPageTab(tab.id);
                            communityScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
                            setShowBackToTop(false);
                          }}
                          className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-black uppercase ${
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

                  <main className="p-4 pb-24">
                    {message && (
                      <p className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-200">
                        {message}
                      </p>
                    )}

                    {pageTab === 'wall' && (
                      <div className="space-y-3">
                        <SemeaduraJourneyPanel key={selectedCommunity.id} communityId={selectedCommunity.id} viewerId={user?.uid || ''} />
                        {canParticipate && (
                          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
                            <textarea
                              value={wallDraft}
                              onChange={event => setWallDraft(event.target.value.slice(0, 3000))}
                              rows={3}
                              placeholder="Publique no mural da comunidade..."
                              aria-label="Escrever publicação no mural"
                              className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-white outline-none"
                            />
                            {wallMedia.length > 0 && (
                              <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Prévia de anexos">
                                {wallMedia.map(({ file, preview }) => (
                                  <div key={preview} className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                                    {file.type.startsWith('video/') ? (
                                      <video src={preview} controls playsInline preload="metadata" className="h-28 w-full object-cover" />
                                    ) : (
                                      <img src={preview} alt={file.name} className="h-28 w-full object-cover" />
                                    )}
                                    <button type="button" aria-label={`Remover anexo ${file.name}`}
                                      onClick={() => removeWallMedia(preview)}
                                      disabled={actionBusy === 'wall-post'}
                                      className="absolute right-1 top-1 rounded-full bg-slate-950/90 p-2 text-white disabled:opacity-50">
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <button type="button" id="community-wall-attachment-button"
                                aria-label="Adicionar foto, vídeo ou câmera ao mural"
                                aria-expanded={wallToolsOpen}
                                onClick={() => setWallToolsOpen(open => !open)}
                                disabled={actionBusy === 'wall-post' || selectedCommunity.visibility === 'private'}
                                title={selectedCommunity.visibility === 'private'
                                  ? 'Anexos em comunidades privadas ainda não estão disponíveis' : 'Adicionar foto, vídeo ou câmera'}
                                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-600 bg-slate-950 text-slate-200 disabled:opacity-40">
                                <Plus className="h-5 w-5" />
                              </button>
                              <button
                                type="button"
                                disabled={actionBusy === 'wall-post' || (!wallDraft.trim() && wallMedia.length === 0)}
                                onClick={() => void submitWallPost()}
                                className="min-h-11 rounded-xl bg-sky-500 px-4 text-xs font-black uppercase text-slate-950 disabled:opacity-40"
                              >
                                {actionBusy === 'wall-post' ? 'Publicando…' : 'Publicar no mural'}
                              </button>
                            </div>
                            {selectedCommunity.visibility === 'public' && (
                              <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-sky-800/40 bg-sky-950/20 p-3 text-sm text-slate-200">
                                <input type="checkbox" checked={shareWallToSquare} onChange={event => setShareWallToSquare(event.target.checked)}
                                  disabled={actionBusy === 'wall-post'} className="h-4 w-4 accent-sky-400" />
                                <span>Exibir também na Praça por 24 horas <span className="block text-xs text-slate-400">Público, gratuito e orgânico. Você pode retirar depois.</span></span>
                              </label>
                            )}
                            {selectedCommunity.visibility === 'moderated' && (
                              <p className="mt-2 text-xs text-slate-400">Esta comunidade moderada não envia postagens automaticamente à Praça.</p>
                            )}
                            {selectedCommunity.visibility === 'private' && (
                              <p className="mt-2 text-xs text-amber-300">Para preservar a privacidade, esta comunidade nunca distribui publicações na Praça. Anexos estão indisponíveis.</p>
                            )}
                            {wallToolsOpen && (
                              <div role="group" aria-label="Escolher anexo para o mural"
                                className="mt-2 grid gap-1 rounded-2xl border border-slate-700 bg-slate-950 p-2">
                                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-xs font-semibold text-slate-200 hover:bg-slate-900">
                                  <ImagePlus className="h-4 w-4" /> Fotos da galeria
                                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                                    disabled={actionBusy === 'wall-post'} onChange={selectWallMedia} />
                                </label>
                                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-xs font-semibold text-slate-200 hover:bg-slate-900">
                                  <Video className="h-4 w-4" /> Vídeo
                                  <input type="file" accept="video/mp4,video/webm" className="hidden"
                                    disabled={actionBusy === 'wall-post'} onChange={selectWallMedia} />
                                </label>
                                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-xs font-semibold text-slate-200 hover:bg-slate-900">
                                  <Camera className="h-4 w-4" /> Câmera
                                  <input type="file" accept="image/*" capture="environment" className="hidden"
                                    disabled={actionBusy === 'wall-post'} onChange={selectWallMedia} />
                                </label>
                                <p className="px-3 py-1 text-xs text-slate-400">Até 4 anexos · Imagens 8 MB · Vídeos 20 MB</p>
                              </div>
                            )}
                          </section>
                        )}
                        {posts.map(post => (
                          <CommunityPostCard
                            key={post.id}
                            post={post}
                            viewerId={user?.uid || ''}
                            communityOwnerId={selectedCommunity.ownerId}
                            canParticipate={canParticipate}
                            likes={postLikes}
                            comments={postComments}
                            saved={savedPostIds.has(post.id)}
                            connection={postConnections.find(item => item.senderId === post.authorId || item.receiverId === post.authorId)}
                            onToggleSave={() => toggleCommunityPostSaveWithMetrics(post, savedPostIds.has(post.id))}
                            onToggleLike={liked => toggleCommunityPostLike(post, liked)}
                            onComment={(value, parentCommentId) => addCommunityPostComment(post, value, parentCommentId)}
                            onDeleteComment={deleteCommunityPostComment}
                            onReport={reason => submitCommunityPostReport(post, reason)}
                            onRemove={() => removeOwnCommunityPost(post)}
                            squarePublished={squarePublishedIds.has(post.id)}
                            onToggleSquare={selectedCommunity.visibility === 'public' && withinCommunitySquareWindow(Date.parse(post.createdAt), Date.now())
                              ? () => squarePublishedIds.has(post.id)
                                ? removeCommunityPostFromSquare(post)
                                : publishCommunityPostToSquare(post)
                              : undefined}
                          />
                        ))}
                        {posts.length === 0 && (
                          <div className="rounded-3xl border border-dashed border-slate-800 px-5 py-12 text-center">
                            <MessageCircle className="mx-auto h-8 w-8 text-slate-700" />
                            <p className="mt-3 text-xs font-black text-slate-400">O mural ainda está vazio</p>
                          </div>
                        )}
                      </div>
                    )}

                    {pageTab === 'notices' && (
                      <div className="space-y-3">
                        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                          <div className="flex items-center gap-2 text-amber-200">
                            <Megaphone className="h-4 w-4" />
                            <h3 className="text-xs font-black uppercase">Avisos da administração</h3>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-slate-400">
                            Regras, eventos e comunicados fixados aparecerão aqui em uma próxima etapa.
                          </p>
                        </section>
                      </div>
                    )}

                    {pageTab === 'about' && (
                      <div className="space-y-3">
                        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-xs font-black uppercase text-white">Sobre a comunidade</h3>
                            {selectedCommunity.isOwner && (
                              <button type="button" onClick={openEditor} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 text-[11px] font-black uppercase text-sky-200">
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </button>
                            )}
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-slate-300">{selectedCommunity.description}</p>
                          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Categoria</dt><dd className="mt-1 text-slate-300">{selectedCommunity.category}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Acesso</dt><dd className="mt-1 text-slate-300">{visibilityDetails(selectedCommunity.visibility).label}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Localização</dt><dd className="mt-1 text-slate-300">{selectedCommunity.location || 'Não definida'}</dd></div>
                            <div className="rounded-2xl bg-slate-950 p-3"><dt className="font-black uppercase text-slate-600">Criador</dt><dd className="mt-1 text-slate-300">{selectedCommunity.ownerName}</dd></div>
                          </dl>
                        </section>
                        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                          <h3 className="text-xs font-black uppercase text-white">Regras</h3>
                          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-400">{selectedCommunity.rules}</p>
                        </section>
                        {selectedCommunity.isOwner && pendingMembers.length > 0 && (
                          <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                            <h3 className="text-xs font-black uppercase text-amber-200">Solicitações de entrada</h3>
                            <div className="mt-3 space-y-2">
                              {pendingMembers.map(member => (
                                <div key={member.id} className="flex items-center gap-3 rounded-2xl bg-slate-950 p-3">
                                  <Avatar name={member.userName} url={member.userAvatar} />
                                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">{member.userName}</span>
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
                          <h3 className="text-xs font-black uppercase text-white">Participantes</h3>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {members.filter(member => member.status === 'active').slice(0, 20).map(member => (
                              <span key={member.id} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-[11px] text-slate-300">
                                <Avatar name={member.userName} url={member.userAvatar} />
                                {member.userName}
                              </span>
                            ))}
                          </div>
                        </section>
                      </div>
                    )}
                  </main>
                  </div>
                  {showBackToTop && (
                    <button
                      type="button"
                      aria-label="Voltar ao topo da comunidade"
                      aria-controls="community-page-scroll"
                      onClick={() => communityScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                      className="absolute bottom-6 left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-sky-400/40 bg-slate-900/95 text-sky-200 shadow-xl backdrop-blur-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                    >
                      <ArrowUp className="h-5 w-5" />
                    </button>
                  )}
              </>
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
              data-kyrub-community-editor="true"
              onSubmit={submitEdit}
              onClick={event => event.stopPropagation()}
              className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 shadow-2xl sm:rounded-3xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-300">Administração</span>
                  <h3 className="mt-1 text-lg font-black text-white">Editar comunidade</h3>
                </div>
                <button type="button" onClick={() => setEditOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500" aria-label="Fechar edição da comunidade">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="space-y-5 p-4">
                <section className="space-y-3" aria-label="Informações da comunidade">
                  <h4 className="text-sm font-black text-sky-300">Identidade da comunidade</h4>
                  <label className="block">
                    <span className="text-xs font-bold text-slate-300">Nome da comunidade</span>
                    <input type="text" required maxLength={80} value={editName}
                      onChange={event => setEditName(event.target.value.slice(0, 80))}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-sky-500"
                      placeholder="Nome da comunidade" />
                    <span className="mt-1 block text-right text-xs text-slate-500">{editName.length}/80</span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-slate-300">Descrição</span>
                    <textarea rows={3} required maxLength={500} value={editDescription}
                      onChange={event => setEditDescription(event.target.value.slice(0, 500))}
                      className="mt-1 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-sky-500"
                      placeholder="Apresente o propósito da comunidade" />
                    <span className="mt-1 block text-right text-xs text-slate-500">{editDescription.length}/500</span>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-300">Categoria</span>
                      <input type="text" required maxLength={80} value={editCategory}
                        onChange={event => setEditCategory(event.target.value.slice(0, 80))}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-sky-500" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-300">Localização (opcional)</span>
                      <input type="text" maxLength={120} value={editLocation}
                        onChange={event => setEditLocation(event.target.value.slice(0, 120))}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-sky-500" />
                    </label>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-xs leading-relaxed text-slate-400">
                    <strong className="block text-slate-200">Acesso: {visibilityDetails(selectedCommunity.visibility).label}</strong>
                    O tipo de acesso e o criador não mudam nesta edição. Renomear não altera os membros,
                    as publicações nem a identidade interna da comunidade.
                  </div>
                </section>
                <section>
                  <span className="text-xs font-bold text-slate-300">Imagem de capa</span>
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
                      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 text-[11px] font-black uppercase text-slate-950">
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
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[11px] font-black uppercase text-red-300 disabled:opacity-35"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover capa
                      </button>
                    </div>
                  </div>
                </section>
                <label className="block">
                  <span className="text-[11px] font-black uppercase text-slate-400">Regras da comunidade</span>
                  <textarea
                    value={editRules}
                    onChange={event => setEditRules(event.target.value.slice(0, 1200))}
                    rows={8}
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-sky-500/60"
                  />
                  <span className="mt-1 block text-right font-mono text-[11px] text-slate-600">{editRules.length}/1200</span>
                </label>
                {editError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{editError}</p>
                )}
              </div>
              <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
                <button type="submit" disabled={editBusy || !editName.trim() || !editDescription.trim() || !editCategory.trim() || !editRules.trim()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-xs font-black uppercase text-slate-950 disabled:opacity-40">
                  <Save className="h-4 w-4" />
                  {editBusy ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </footer>
            </form>
          </div>,
          document.body
        )}
    </>
  );
}
