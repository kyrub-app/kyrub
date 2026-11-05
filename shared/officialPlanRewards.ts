/** Privileged platform reward configuration. Ordinary product metadata cannot mint global XP. */
import type { KyrubAchievementDefinition } from './gamificationProgression.js';
export interface OfficialPlanRewards { xp: number; achievement?: Pick<KyrubAchievementDefinition, 'id' | 'title' | 'description' | 'badgeId'> }
export const parseOfficialPlanRewards = (value: unknown): OfficialPlanRewards => {
  if (value === undefined) return { xp: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['xp', 'achievement'].includes(key)) ||
    !Number.isSafeInteger((value as OfficialPlanRewards).xp) || (value as OfficialPlanRewards).xp < 0 || (value as OfficialPlanRewards).xp > 1000000) {
    throw new Error('OFFICIAL_PLAN_REWARDS_INVALID');
  }
  const { xp, achievement } = value as OfficialPlanRewards;
  if (achievement !== undefined && (!achievement || typeof achievement !== 'object' || Array.isArray(achievement) ||
    Object.keys(achievement).some(key => !['id', 'title', 'description', 'badgeId'].includes(key)) ||
    typeof achievement.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(achievement.id) ||
    typeof achievement.title !== 'string' || !achievement.title.trim() || achievement.title.length > 160 ||
    typeof achievement.description !== 'string' || achievement.description.length > 1000 ||
    (achievement.badgeId !== undefined && (typeof achievement.badgeId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(achievement.badgeId))))) throw new Error('OFFICIAL_PLAN_REWARDS_INVALID');
  return { xp, ...(achievement === undefined ? {} : { achievement }) };
};
