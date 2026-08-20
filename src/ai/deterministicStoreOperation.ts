import type { StoreOperationalStatus, StoreOperationProposal, StoreOperationWeekday } from '../../shared/storeOperationAction';

const WEEKDAYS: Array<[RegExp, StoreOperationWeekday, string]> = [
  [/\bsegunda(?:-feira)?\b/i, 'monday', 'segunda-feira'],
  [/\bter[cç]a(?:-feira)?\b/i, 'tuesday', 'terça-feira'],
  [/\bquarta(?:-feira)?\b/i, 'wednesday', 'quarta-feira'],
  [/\bquinta(?:-feira)?\b/i, 'thursday', 'quinta-feira'],
  [/\bsexta(?:-feira)?\b/i, 'friday', 'sexta-feira'],
  [/\bs[aá]bado\b/i, 'saturday', 'sábado'],
  [/\bdomingo\b/i, 'sunday', 'domingo'],
];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/\s+/g, ' ')
  .trim();

const actionId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `store-operation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const normalizeTime = (hourText: string, minuteText?: string): string | null => {
  const hour = Number.parseInt(hourText, 10);
  const minute = minuteText ? Number.parseInt(minuteText, 10) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const parseStatus = (message: string): StoreOperationalStatus | undefined => {
  const intent = normalize(message);
  if (/\b(?:abra|abrir|marque|deixe|coloque)\b.*\b(?:loja|estabelecimento|negocio)\b.*\b(?:aberta|aberto)\b/.test(intent) || /\b(?:abra|abrir)\s+(?:a\s+)?(?:minha\s+)?loja\b/.test(intent)) {
    return 'open';
  }
  if (/\b(?:feche|fechar|marque|deixe|coloque)\b.*\b(?:loja|estabelecimento|negocio)\b.*\b(?:fechada|fechado)\b/.test(intent) || /\b(?:feche|fechar)\s+(?:a\s+)?(?:minha\s+)?loja\b/.test(intent)) {
    return 'closed';
  }
  if (/\b(?:marque|deixe|coloque)\b.*\b(?:loja|estabelecimento|negocio)\b.*\b(?:atrasada|atrasado)\b/.test(intent)) {
    return 'delayed';
  }
  return undefined;
};

const parseOpeningHours = (message: string): StoreOperationProposal['openingHours'] => {
  const weekday = WEEKDAYS.find(([pattern]) => pattern.test(message));
  if (!weekday) return undefined;
  const [, day] = weekday;
  const intent = normalize(message);

  if (/\b(?:fechado|fechada|nao abrimos|nao abre|sem atendimento)\b/.test(intent)) {
    return [{ day, enabled: false, opensAt: '', closesAt: '' }];
  }

  const match = /(?:das?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:as|às|ate|até|a|-)\s*(\d{1,2})(?::(\d{2}))?\s*h?/i.exec(message);
  if (!match) return undefined;
  const opensAt = normalizeTime(match[1], match[2]);
  const closesAt = normalizeTime(match[3], match[4]);
  if (!opensAt || !closesAt || opensAt === closesAt) return undefined;
  return [{ day, enabled: true, opensAt, closesAt }];
};

const statusLabel = (status: StoreOperationalStatus): string => ({
  open: 'aberta',
  delayed: 'com atendimento atrasado',
  closed: 'fechada',
})[status];

const weekdayLabel = (day: StoreOperationWeekday): string =>
  WEEKDAYS.find(([, candidate]) => candidate === day)?.[2] ?? day;

export const resolveKyrubiaDeterministicStoreOperation = (
  message: string,
  currentStatus: StoreOperationalStatus
): { reply: string; proposal: StoreOperationProposal } | null => {
  const status = parseStatus(message);
  const openingHours = parseOpeningHours(message);
  if (!status && !openingHours?.length) return null;

  const proposal: StoreOperationProposal = {
    id: actionId(),
    type: 'update_store_operation',
    expectedCurrentStatus: currentStatus,
    ...(status ? { status } : {}),
    ...(openingHours?.length ? { openingHours } : {}),
    requiresConfirmation: true,
    origin: 'kyrubia',
  };

  const summary = [
    status ? `- Estado da loja: ${statusLabel(status)}` : '',
    ...(openingHours ?? []).map(item => item.enabled
      ? `- ${weekdayLabel(item.day)}: ${item.opensAt} às ${item.closesAt}`
      : `- ${weekdayLabel(item.day)}: fechado`),
  ].filter(Boolean).join('\n');

  return {
    reply: `Tudo pronto para atualizar a operação da sua loja:\n${summary}\n\nRevise e confirme antes de eu salvar essa mudança.`,
    proposal,
  };
};
