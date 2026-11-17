/**
 * Learning goals for the existing Kyrubia Educadora conversation experience.
 * These are not vendor course records or provider enrolment actions.
 * User reviews the draft and explicitly sends it to the regular Kyrubia chat.
 */
export type KyrubiaLearningTrackId = 'earn' | 'entrepreneurship' | 'kyrub';

export interface KyrubiaLearningTrack {
  id: KyrubiaLearningTrackId;
  title: string;
  description: string;
  starterPrompt: string;
}

export const KYRUBIA_LEARNING_TRACKS: readonly KyrubiaLearningTrack[] = [
  {
    id: 'earn',
    title: 'Aprender para gerar renda',
    description: 'Descubra uma habilidade e organize um plano prático para começar.',
    starterPrompt: 'Quero aprender uma habilidade para gerar renda. Pergunte meus interesses, experiências e tempo disponível antes de montar uma trilha prática com exercícios e próximos passos. Não presuma matrícula ou acesso a cursos externos.',
  },
  {
    id: 'entrepreneurship',
    title: 'Aprender a empreender',
    description: 'Estude vendas, precificação e gestão de um pequeno negócio.',
    starterPrompt: 'Quero aprender a empreender. Ajude-me a escolher por onde começar, estudar vendas, precificação, caixa e organização do negócio. Sugira atividades que eu possa executar manualmente no Kyrub, sem afirmar que meus dados foram alterados.',
  },
  {
    id: 'kyrub',
    title: 'Aprender a usar o Kyrub',
    description: 'Aprenda a usar loja, produtos, caixa, CRM e marketplace.',
    starterPrompt: 'Quero aprender a usar o Kyrub. Pergunte qual recurso preciso aprender primeiro e me guie passo a passo por loja, produtos, caixa, CRM ou marketplace. Explique o modo manual e não afirme operações concluídas sem confirmação do aplicativo.',
  },
];
