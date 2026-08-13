export type KyrubiaDeterministicTaskDraft = {
  title: string;
  content: string;
  reminderDateTime: string | null;
};

export type KyrubiaDeterministicTaskResult = {
  reply: string;
  taskDraft: KyrubiaDeterministicTaskDraft;
};

const cleanValue = (value: string): string => {
  const trimmed = value.trim().replace(/[.!]\s*$/u, '').trim();
  if (trimmed.length < 2) return trimmed;

  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];

  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }

  return trimmed;
};

const pad = (value: number): string => String(value).padStart(2, '0');

const formatLocalMinute = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
  `T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const EXPLICIT_RELATIVE_TIME =
  /\b(hoje|amanh[aã])\s+(?:a\s+partir\s+d(?:e|as?)\s+)?(?:[àa]s?|as)\s+(\d{1,2})(?:(?::|h)(\d{2}))?\s*h?\b/iu;

const parseExplicitReminder = (
  taskText: string,
  now: Date
): { reminderDateTime: string | null; titleText: string } => {
  const match = EXPLICIT_RELATIVE_TIME.exec(taskText);
  if (!match) {
    return { reminderDateTime: null, titleText: taskText };
  }

  const hour = Number(match[2]);
  const minute = match[3] ? Number(match[3]) : 0;
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { reminderDateTime: null, titleText: taskText };
  }

  const reminder = new Date(now);
  reminder.setSeconds(0, 0);
  if (match[1]?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'amanha') {
    reminder.setDate(reminder.getDate() + 1);
  }
  reminder.setHours(hour, minute, 0, 0);

  const titleText = [
    taskText.slice(0, match.index),
    taskText.slice(match.index + match[0].length),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .trim()
    .replace(/[,;:]\s*$/u, '')
    .trim();

  return {
    reminderDateTime: formatLocalMinute(reminder),
    titleText: titleText || taskText,
  };
};

const EXPLICIT_TASK_PATTERN =
  /^\s*(?:crie|criar|adicione|adicionar|fa[cç]a|salve|salvar)\s+(?:uma\s+)?tarefa\s+(?:para\s+|chamada\s+|intitulada\s+|com\s+o\s+t[ií]tulo\s+)?(.+?)\s*$/isu;

const REQUIRES_GENERATIVE_REASONING =
  /\b(?:com\s+base\s+(?:nisso|nisto|no\s+que|na\s+conversa)|usando\s+o\s+que\s+conversamos|a\s+partir\s+do\s+que\s+falamos|resuma|elabore|planeje|crie\s+um\s+plano)\b/iu;

export const resolveKyrubiaDeterministicTask = (
  message: string,
  now = new Date()
): KyrubiaDeterministicTaskResult | null => {
  const match = EXPLICIT_TASK_PATTERN.exec(message);
  if (!match) return null;

  const rawTaskText = cleanValue(match[1] ?? '');
  if (!rawTaskText || REQUIRES_GENERATIVE_REASONING.test(rawTaskText)) return null;

  const scheduling = parseExplicitReminder(rawTaskText, now);
  const title = cleanValue(scheduling.titleText);
  if (!title) return null;

  const reminderSummary = scheduling.reminderDateTime
    ? ` com lembrete em ${scheduling.reminderDateTime.replace('T', ' às ')}`
    : '';

  return {
    reply:
      `Tudo pronto para criar a tarefa “${title}”${reminderSummary}. ` +
      'Revise e confirme antes de eu salvá-la nas suas tarefas.',
    taskDraft: {
      title,
      content: rawTaskText,
      reminderDateTime: scheduling.reminderDateTime,
    },
  };
};
