export type PreviewCommunityVisibility = 'public' | 'moderated' | 'private';

export interface PreviewCommunity {
  id: string;
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: PreviewCommunityVisibility;
  rules: string;
  coverImage: string;
  createdAt: string;
  memberCount: number;
  isMember: boolean;
  isOwner: boolean;
  activityLabel: string;
}

export interface PreviewCommunityPost {
  id: string;
  communityId: string;
  authorName: string;
  content: string;
  mediaUrls: string[];
  createdAt: string;
}

export interface PreviewCommunityDiscussion {
  id: string;
  communityId: string;
  authorName: string;
  title: string;
  content: string;
  createdAt: string;
  replyCount: number;
  pinned: boolean;
  resolved: boolean;
}

export const COMMUNITY_PREVIEW_UPDATED_EVENT =
  'kyrub-community-preview-updated';
export const OPEN_COMMUNITY_PREVIEW_CREATE_EVENT =
  'kyrub-open-community-preview-create';

const COMMUNITIES_STORAGE_KEY = 'kyrub_preview_communities_v1';
const POSTS_STORAGE_KEY = 'kyrub_preview_community_posts_v1';
const DISCUSSIONS_STORAGE_KEY = 'kyrub_preview_community_discussions_v1';

const seedCommunities: PreviewCommunity[] = [
  {
    id: 'preview-empreendedores-locais',
    name: 'Empreendedores locais',
    description:
      'Trocas práticas entre pessoas que estão construindo negócios, serviços e projetos na própria região.',
    category: 'Negócios e oportunidades',
    location: 'Sua região',
    visibility: 'public',
    rules:
      'Respeite os membros, evite spam e mantenha as discussões relacionadas ao propósito da comunidade.',
    coverImage: '',
    createdAt: '2026-08-01T12:00:00.000Z',
    memberCount: 428,
    isMember: false,
    isOwner: false,
    activityLabel: '18 discussões hoje',
  },
  {
    id: 'preview-gastronomia-receitas',
    name: 'Gastronomia e receitas',
    description:
      'Receitas, técnicas, fornecedores, experiências e oportunidades para quem gosta de cozinhar.',
    category: 'Gastronomia',
    location: 'Brasil',
    visibility: 'public',
    rules:
      'Compartilhe conteúdo autoral ou informe a fonte. Publicidade repetitiva será removida.',
    coverImage: '',
    createdAt: '2026-08-02T12:00:00.000Z',
    memberCount: 936,
    isMember: false,
    isOwner: false,
    activityLabel: '42 novas respostas',
  },
  {
    id: 'preview-profissionais-autonomos',
    name: 'Profissionais autônomos',
    description:
      'Indicações, dúvidas, ferramentas, parcerias e oportunidades para profissionais independentes.',
    category: 'Profissões',
    location: 'Brasil',
    visibility: 'moderated',
    rules:
      'Não publique dados pessoais de terceiros. Vagas e oportunidades devem conter informações claras.',
    coverImage: '',
    createdAt: '2026-08-03T12:00:00.000Z',
    memberCount: 671,
    isMember: false,
    isOwner: false,
    activityLabel: '27 oportunidades recentes',
  },
];

const canUseStorage = (): boolean => typeof window !== 'undefined';

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseArray = <T>(raw: string | null): T[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
};

const normalizeCommunity = (community: PreviewCommunity): PreviewCommunity => ({
  ...community,
  coverImage: cleanString(community.coverImage),
});

const dispatchPreviewUpdate = (): void => {
  if (!canUseStorage()) return;
  window.dispatchEvent(new Event(COMMUNITY_PREVIEW_UPDATED_EVENT));
};

const ensureCommunities = (): PreviewCommunity[] => {
  if (!canUseStorage()) return seedCommunities.map(normalizeCommunity);
  const stored = parseArray<PreviewCommunity>(
    localStorage.getItem(COMMUNITIES_STORAGE_KEY)
  ).map(normalizeCommunity);
  if (stored.length > 0) return stored;
  localStorage.setItem(COMMUNITIES_STORAGE_KEY, JSON.stringify(seedCommunities));
  return seedCommunities.map(normalizeCommunity);
};

export const loadPreviewCommunities = (): PreviewCommunity[] =>
  ensureCommunities().map(community => ({ ...community }));

const savePreviewCommunities = (communities: PreviewCommunity[]): void => {
  if (!canUseStorage()) return;
  localStorage.setItem(
    COMMUNITIES_STORAGE_KEY,
    JSON.stringify(communities.map(normalizeCommunity))
  );
  dispatchPreviewUpdate();
};

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);

export const createPreviewCommunity = (input: {
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: PreviewCommunityVisibility;
  rules: string;
}): PreviewCommunity => {
  const name = input.name.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 500);
  if (!name) throw new Error('Informe o nome da comunidade.');
  if (!description) throw new Error('Informe uma descrição para a comunidade.');

  const communities = loadPreviewCommunities();
  const normalizedName = name.toLocaleLowerCase('pt-BR');
  if (
    communities.some(
      community => community.name.toLocaleLowerCase('pt-BR') === normalizedName
    )
  ) {
    throw new Error('Já existe uma comunidade com esse nome neste preview.');
  }

  const now = new Date().toISOString();
  const id = `preview-${slugify(name) || 'comunidade'}-${Date.now()}`;
  const community: PreviewCommunity = {
    id,
    name,
    description,
    category: input.category.trim().slice(0, 60) || 'Outros interesses',
    location: input.location.trim().slice(0, 80),
    visibility: input.visibility,
    rules:
      input.rules.trim().slice(0, 800) ||
      'Respeite os membros e mantenha as publicações relacionadas ao propósito da comunidade.',
    coverImage: '',
    createdAt: now,
    memberCount: 1,
    isMember: true,
    isOwner: true,
    activityLabel: 'Criada agora',
  };

  savePreviewCommunities([community, ...communities]);
  return community;
};

export const updatePreviewCommunity = (input: {
  communityId: string;
  rules: string;
  coverImage: string;
}): PreviewCommunity => {
  const communityId = input.communityId.trim();
  const rules = input.rules.trim().slice(0, 800);
  const coverImage = input.coverImage.trim();
  if (!communityId) throw new Error('A comunidade não foi identificada.');
  if (!rules) throw new Error('Informe ao menos uma regra para a comunidade.');
  if (coverImage.length > 2_500_000) {
    throw new Error('A imagem de capa ficou muito grande para este preview local.');
  }

  const communities = loadPreviewCommunities();
  const target = communities.find(community => community.id === communityId);
  if (!target) throw new Error('Comunidade não encontrada.');
  if (!target.isOwner) {
    throw new Error('Somente o criador pode editar esta comunidade.');
  }

  const updated: PreviewCommunity = {
    ...target,
    rules,
    coverImage,
    activityLabel: 'Configurações atualizadas agora',
  };
  savePreviewCommunities(
    communities.map(community =>
      community.id === communityId ? updated : community
    )
  );
  return updated;
};

export const setPreviewCommunityMembership = (
  communityId: string,
  isMember: boolean
): PreviewCommunity | null => {
  const communities = loadPreviewCommunities();
  let updated: PreviewCommunity | null = null;
  const next = communities.map(community => {
    if (community.id !== communityId || community.isOwner) return community;
    updated = {
      ...community,
      isMember,
      memberCount: Math.max(
        0,
        community.memberCount +
          (isMember === community.isMember ? 0 : isMember ? 1 : -1)
      ),
    };
    return updated;
  });
  savePreviewCommunities(next);
  return updated;
};

export const loadPreviewCommunityPosts = (
  communityId?: string
): PreviewCommunityPost[] => {
  if (!canUseStorage()) return [];
  const posts = parseArray<PreviewCommunityPost>(
    localStorage.getItem(POSTS_STORAGE_KEY)
  );
  const filtered = communityId
    ? posts.filter(post => post.communityId === communityId)
    : posts;
  return [...filtered].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
};

export const addPreviewCommunityPost = (input: {
  communityId: string;
  authorName: string;
  content: string;
  mediaUrls?: string[];
}): PreviewCommunityPost => {
  const content = input.content.trim().slice(0, 3000);
  const mediaUrls = Array.from(new Set(input.mediaUrls ?? [])).slice(0, 9);
  if (!content && mediaUrls.length === 0) {
    throw new Error('Escreva algo ou adicione uma imagem.');
  }

  const post: PreviewCommunityPost = {
    id: `community-post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    communityId: input.communityId,
    authorName: input.authorName.trim().slice(0, 80) || 'Você',
    content,
    mediaUrls,
    createdAt: new Date().toISOString(),
  };
  const posts = loadPreviewCommunityPosts();
  if (canUseStorage()) {
    localStorage.setItem(POSTS_STORAGE_KEY, JSON.stringify([post, ...posts]));
    dispatchPreviewUpdate();
  }
  return post;
};

export const loadPreviewCommunityDiscussions = (
  communityId?: string
): PreviewCommunityDiscussion[] => {
  if (!canUseStorage()) return [];
  const discussions = parseArray<PreviewCommunityDiscussion>(
    localStorage.getItem(DISCUSSIONS_STORAGE_KEY)
  );
  const filtered = communityId
    ? discussions.filter(item => item.communityId === communityId)
    : discussions;
  return [...filtered].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
};

export const addPreviewCommunityDiscussion = (input: {
  communityId: string;
  authorName: string;
  title: string;
  content: string;
}): PreviewCommunityDiscussion => {
  const title = input.title.trim().slice(0, 140);
  const content = input.content.trim().slice(0, 3000);
  if (!title) throw new Error('Informe o título da discussão.');
  if (!content) throw new Error('Explique o assunto da discussão.');

  const discussion: PreviewCommunityDiscussion = {
    id: `community-discussion-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    communityId: input.communityId,
    authorName: input.authorName.trim().slice(0, 80) || 'Você',
    title,
    content,
    createdAt: new Date().toISOString(),
    replyCount: 0,
    pinned: false,
    resolved: false,
  };
  const discussions = loadPreviewCommunityDiscussions();
  if (canUseStorage()) {
    localStorage.setItem(
      DISCUSSIONS_STORAGE_KEY,
      JSON.stringify([discussion, ...discussions])
    );
    dispatchPreviewUpdate();
  }
  return discussion;
};
