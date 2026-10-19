import React from 'react';

export interface KyrubClubeChallengeCard {
  id: string;
  title: string;
  progressLabel: string;
  rewardLabel: string;
}

export interface KyrubClubeAchievementCard {
  id: string;
  title: string;
  unlocked: boolean;
}

export interface KyrubClubeRewardCard {
  id: string;
  title: string;
  costLabel: string;
}

export interface KyrubClubePanelProps {
  kCoins: number;
  xp: number;
  level: number;
  challenges: KyrubClubeChallengeCard[];
  achievements: KyrubClubeAchievementCard[];
  history: string[];
  rewards: KyrubClubeRewardCard[];
}

export const KyrubClubePanel: React.FC<KyrubClubePanelProps> = ({
  kCoins,
  xp,
  level,
  challenges,
  achievements,
  history,
  rewards,
}) => (
  <section aria-label="Kyrub Clube" className="space-y-6">
    <header>
      <p className="text-sm font-medium text-slate-500">Gamificação Kyrub</p>
      <h1 className="text-2xl font-semibold text-slate-950">Kyrub Clube</h1>
      <p className="mt-1 text-sm text-slate-600">
        K-Coins, XP, nível, desafios, conquistas e recompensas em economias separadas.
      </p>
    </header>

    <div className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl border p-4">
        <span className="text-xs uppercase tracking-wide text-slate-500">K-Coins</span>
        <strong className="mt-1 block text-2xl">{kCoins}</strong>
      </article>
      <article className="rounded-2xl border p-4">
        <span className="text-xs uppercase tracking-wide text-slate-500">XP</span>
        <strong className="mt-1 block text-2xl">{xp}</strong>
      </article>
      <article className="rounded-2xl border p-4">
        <span className="text-xs uppercase tracking-wide text-slate-500">Nível</span>
        <strong className="mt-1 block text-2xl">{level}</strong>
      </article>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="kyrub-clube-challenges">
        <h2 id="kyrub-clube-challenges" className="text-lg font-semibold">Desafios</h2>
        <div className="mt-3 space-y-3">
          {challenges.map(challenge => (
            <article key={challenge.id} className="rounded-2xl border p-4">
              <h3 className="font-medium">{challenge.title}</h3>
              <p className="text-sm text-slate-600">{challenge.progressLabel}</p>
              <p className="text-sm font-medium">{challenge.rewardLabel}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="kyrub-clube-achievements">
        <h2 id="kyrub-clube-achievements" className="text-lg font-semibold">Conquistas</h2>
        <div className="mt-3 space-y-2">
          {achievements.map(achievement => (
            <div key={achievement.id} className="rounded-2xl border p-4">
              <span>{achievement.title}</span>
              <span className="ml-2 text-sm text-slate-500">
                {achievement.unlocked ? 'Conquistada' : 'Bloqueada'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>

    <section aria-labelledby="kyrub-clube-rewards">
      <h2 id="kyrub-clube-rewards" className="text-lg font-semibold">Recompensas</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rewards.map(reward => (
          <article key={reward.id} className="rounded-2xl border p-4">
            <h3 className="font-medium">{reward.title}</h3>
            <p className="text-sm text-slate-600">{reward.costLabel}</p>
          </article>
        ))}
      </div>
    </section>

    <section aria-labelledby="kyrub-clube-history">
      <h2 id="kyrub-clube-history" className="text-lg font-semibold">Histórico</h2>
      <ul className="mt-3 space-y-2">
        {history.map((item, index) => (
          <li key={`${index}-${item}`} className="rounded-2xl border p-3 text-sm text-slate-700">{item}</li>
        ))}
      </ul>
    </section>
  </section>
);

export default KyrubClubePanel;
