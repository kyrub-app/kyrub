import type {
  KyrubiaActiveObjective,
  KyrubiaObjectiveScope,
} from './objectiveStore';

export type KyrubiaObjectiveCommand =
  | { kind: 'create'; statement: string }
  | { kind: 'show_linked' }
  | { kind: 'list_active' }
  | { kind: 'set_next_step'; nextStep: string }
  | { kind: 'add_progress'; summary: string }
  | { kind: 'complete' };

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const compact = (value: string, maximum: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maximum);

const extract = (message: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
};

export const resolveKyrubiaObjectiveCommand = (
  message: string
): KyrubiaObjectiveCommand | null => {
  const createStatement = extract(message, [
    /^\s*(?:meu|nosso)\s+objetivo\s+(?:é|e)\s*[:\-]?\s*(.+)\s*$/iu,
    /^\s*(?:defina|registre|crie)\s+(?:isto\s+|isso\s+)?(?:como\s+)?(?:um\s+)?objetivo\s*[:\-]\s*(.+)\s*$/iu,
  ]);
  if (createStatement) {
    return { kind: 'create', statement: createStatement };
  }

  const nextStep = extract(message, [
    /^\s*(?:o\s+)?pr[oó]ximo\s+passo\s+(?:do|desse|deste)\s+objetivo\s+(?:é|e)\s*[:\-]?\s*(.+)\s*$/iu,
    /^\s*(?:defina|registre)\s+(?:o\s+)?pr[oó]ximo\s+passo\s+(?:do|desse|deste)\s+objetivo\s+(?:como\s+)?[:\-]?\s*(.+)\s*$/iu,
  ]);
  if (nextStep) return { kind: 'set_next_step', nextStep };

  const progress = extract(message, [
    /^\s*(?:registre|adicione|inclua)\s+(?:no|ao)\s+progresso\s+(?:do|desse|deste)\s+objetivo\s*[:\-]\s*(.+)\s*$/iu,
    /^\s*(?:registre|adicione|inclua)\s+(?:como\s+)?progresso\s*[:\-]\s*(.+)\s*$/iu,
  ]);
  if (progress) return { kind: 'add_progress', summary: progress };

  const intent = normalize(message);

  if (
    /^(?:quais|liste|mostre) (?:sao )?(?:os )?(?:meus |nossos )?objetivos ativos$/.test(intent) ||
    /^(?:quais|liste|mostre) (?:os )?objetivos ativos$/.test(intent)
  ) {
    return { kind: 'list_active' };
  }

  if (
    /^(?:qual|qual e) (?:o )?(?:meu|nosso) objetivo(?: ativo)?$/.test(intent) ||
    /^qual objetivo (?:esta|estamos) (?:ativo|seguindo) (?:neste|nesse) chat$/.test(intent) ||
    /^o que estamos tentando (?:concluir|fazer|alcancar)$/.test(intent) ||
    /^como estamos (?:com|no) (?:o )?objetivo$/.test(intent)
  ) {
    return { kind: 'show_linked' };
  }

  if (
    /^(?:conclua|finalize) (?:o|este|esse|nosso|meu)? ?objetivo$/.test(intent) ||
    /^marque (?:o|este|esse|nosso|meu) objetivo como concluido$/.test(intent)
  ) {
    return { kind: 'complete' };
  }

  return null;
};

export const inferKyrubiaObjectiveScope = (
  statement: string
): KyrubiaObjectiveScope => {
  const intent = normalize(statement);
  const ownStoreScope = [
    'minha loja',
    'minha empresa',
    'meu negocio',
    'meus produtos',
    'meu catalogo',
    'meu estoque',
    'meus pedidos',
  ].some(term => intent.includes(term));

  return ownStoreScope
    ? { kind: 'own_store', storeId: null }
    : { kind: 'user' };
};

export const renderKyrubiaObjective = (
  objective: KyrubiaActiveObjective
): string => {
  const lines = [
    `${objective.status === 'active' ? 'Objetivo ativo' : 'Objetivo concluído'}: “${objective.statement}”.`,
  ];

  if (objective.progress.length > 0) {
    lines.push('Progresso registrado:');
    objective.progress.slice(-5).forEach(entry => {
      lines.push(`- ${entry.summary}`);
    });
  } else {
    lines.push('Progresso registrado: ainda não há marcos adicionados a este objetivo.');
  }

  if (objective.nextStep) {
    lines.push(`Próximo passo registrado: ${objective.nextStep}`);
  }

  if (objective.status === 'completed') {
    lines.push('Ele foi marcado como concluído na memória de objetivos da Kyrubia.');
  }

  lines.push(
    'Objetivos organizam continuidade e progresso histórico; não autorizam ações nem substituem o estado atual do Kyrub.'
  );
  return lines.join('\n');
};

export const renderKyrubiaObjectiveList = (
  objectives: KyrubiaActiveObjective[]
): string => {
  if (objectives.length === 0) {
    return 'Você não tem objetivos ativos registrados na Kyrubia neste dispositivo.';
  }

  const items = objectives
    .slice(0, 8)
    .map((objective, index) => {
      const next = objective.nextStep
        ? ` — próximo passo: ${compact(objective.nextStep, 70)}`
        : '';
      return `${index + 1}. ${objective.title}${next}`;
    })
    .join('\n');

  return `Você tem ${objectives.length} objetivo${objectives.length === 1 ? '' : 's'} ativo${objectives.length === 1 ? '' : 's'}:\n${items}`;
};

export const buildKyrubiaObjectiveContext = (
  objective?: KyrubiaActiveObjective
): string | null => {
  if (!objective || objective.status !== 'active') return null;
  const progress = objective.progress.at(-1)?.summary;
  const details = [
    `Objetivo ativo: ${compact(objective.statement, 100)}`,
    progress ? `Último progresso: ${compact(progress, 60)}` : '',
    objective.nextStep
      ? `Próximo passo: ${compact(objective.nextStep, 60)}`
      : '',
    'Contexto de continuidade; não autoriza ações nem prova estado atual.',
  ].filter(Boolean);
  return compact(details.join(' | '), 220);
};
