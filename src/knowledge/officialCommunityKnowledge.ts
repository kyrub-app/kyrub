import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import type {
  KyrubKnowledgeItem,
  KyrubKnowledgeSnapshot,
} from '../../shared/kyrubKnowledge';
import { db } from '../utils/firebase';

export interface KyrubOfficialKnowledgeConfig {
  officialProfileUid: string;
  communityIds: string[];
  enabled: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const runtimeEnv = (): Record<string, unknown> =>
  ((import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {});

export const getKyrubOfficialKnowledgeConfig = (): KyrubOfficialKnowledgeConfig => {
  const env = runtimeEnv();
  const officialProfileUid = clean(env.VITE_KYRUB_OFFICIAL_PROFILE_UID);
  const communityIds = Array.from(
    new Set(
      clean(env.VITE_KYRUB_OFFICIAL_COMMUNITY_IDS)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);

  return {
    officialProfileUid,
    communityIds,
    enabled: Boolean(officialProfileUid && communityIds.length > 0),
  };
};

const debateToKnowledgeItem = (
  communityId: string,
  debateId: string,
  data: Record<string, unknown>
): KyrubKnowledgeItem | null => {
  const title = clean(data.title);
  const content = clean(data.content);
  const authorId = clean(data.authorId);
  const updatedAt = clean(data.updatedAtIso) || clean(data.createdAtIso);
  if (!title || !content || !authorId || !updatedAt || data.status !== 'open') {
    return null;
  }

  return {
    schemaVersion: 1,
    id: `official-community:${communityId}:debate:${debateId}`,
    authority: 'official_product_reference',
    sourceKind: 'official_community',
    sourceEntityType: 'community_debate',
    sourceEntityId: debateId,
    communityId,
    title,
    content,
    status: 'active',
    version: updatedAt,
    updatedAt,
    tags: [],
  };
};

export const readOfficialCommunityKnowledge = async (
  config = getKyrubOfficialKnowledgeConfig()
): Promise<KyrubKnowledgeSnapshot> => {
  const warnings: string[] = [];
  const items: KyrubKnowledgeItem[] = [];

  if (!config.enabled) {
    return {
      source: 'official_communities',
      generatedAt: new Date().toISOString(),
      items,
      warnings: [
        'A identidade e as comunidades oficiais do Kyrub ainda não foram configuradas para leitura de conhecimento.',
      ],
    };
  }

  for (const communityId of config.communityIds) {
    try {
      const communitySnapshot = await getDoc(doc(db, 'communities', communityId));
      if (!communitySnapshot.exists()) {
        warnings.push(`Comunidade oficial configurada não encontrada: ${communityId}.`);
        continue;
      }

      const community = communitySnapshot.data() as Record<string, unknown>;
      if (clean(community.ownerId) !== config.officialProfileUid) {
        warnings.push(`Comunidade ignorada porque o proprietário não corresponde ao perfil oficial: ${communityId}.`);
        continue;
      }
      if (community.visibility !== 'public' && community.visibility !== 'moderated') {
        warnings.push(`Comunidade oficial ignorada porque não é descobrível: ${communityId}.`);
        continue;
      }

      const debateSnapshot = await getDocs(
        query(
          collection(db, 'community_debates'),
          where('communityId', '==', communityId)
        )
      );

      for (const debate of debateSnapshot.docs) {
        const data = debate.data() as Record<string, unknown>;
        // Only the official profile's authored body is authoritative. Community
        // comments and member-created debates never become product truth.
        if (clean(data.authorId) !== config.officialProfileUid) continue;
        const item = debateToKnowledgeItem(communityId, debate.id, data);
        if (item) items.push(item);
      }
    } catch (error) {
      console.warn('[Kyrub Knowledge] Official community read failed.', error);
      warnings.push(`Não foi possível ler a comunidade oficial ${communityId}.`);
    }
  }

  return {
    source: 'official_communities',
    generatedAt: new Date().toISOString(),
    items: items.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ),
    warnings,
  };
};
