import type {
  KyrubErpContextSnapshot,
  KyrubErpInventoryMovementSummary,
} from './kyrubErpContext';

export type KyrubiaInventoryHistoryResult = {
  reply: string;
  matchedCount: number;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const HISTORY_NOUN = /\b(historico|movimentacao|movimentacoes|entrada|entradas|saida|saidas|perda|perdas|desperdicio|desperdicios|correcao|correcoes|ajuste|ajustes)\b/;
const HISTORY_ASK = /\b(qual|quais|liste|listar|mostre|mostrar|consulte|consultar|ultima|ultimas|ultimo|ultimos|recentes|aconteceu|aconteceram|movimentei|movido)\b/;

export const isKyrubInventoryHistoryReadIntent = (message: string): boolean => {
  const text = normalize(message);
  return /\b(estoque|insumo|insumos|ingrediente|ingredientes)\b/.test(text) &&
    HISTORY_NOUN.test(text) &&
    HISTORY_ASK.test(text);
};

const kindLabel = (kind: KyrubErpInventoryMovementSummary['kind']): string => {
  if (kind === 'intake') return 'Entrada';
  if (kind === 'outflow') return 'Saída';
  if (kind === 'loss') return 'Perda/desperdício';
  return 'Correção física';
};

const signedQuantity = (
  quantityDelta: number,
  unit: string
): string => {
  const sign = quantityDelta > 0 ? '+' : '';
  return `${sign}${quantityDelta.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`;
};

const movementMatchesIntent = (
  movement: KyrubErpInventoryMovementSummary,
  intent: string
): boolean => {
  if (/\b(perda|perdas|desperdicio|desperdicios)\b/.test(intent)) {
    return movement.kind === 'loss';
  }
  if (/\b(entrada|entradas)\b/.test(intent)) return movement.kind === 'intake';
  if (/\b(saida|saidas)\b/.test(intent)) return movement.kind === 'outflow';
  if (/\b(correcao|correcoes|ajuste|ajustes)\b/.test(intent)) {
    return movement.kind === 'correction';
  }
  return true;
};

const movementItemMatchesIntent = (
  movement: KyrubErpInventoryMovementSummary,
  intent: string
): boolean => {
  const namedLine = movement.lines.find(line => {
    const name = normalize(line.name);
    return name.length > 2 && intent.includes(name);
  });
  const mentionsAnyKnownItem = movement.lines.some(line => {
    const name = normalize(line.name);
    return name.length > 2 && intent.includes(name);
  });
  return namedLine !== undefined || !mentionsAnyKnownItem;
};

const formatDate = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatMovement = (movement: KyrubErpInventoryMovementSummary): string => {
  const lines = movement.lines
    .map(line =>
      `  • ${line.name}: ${signedQuantity(line.quantityDelta, line.unit)} ` +
      `(${line.previousQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} → ` +
      `${line.resultingQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${line.unit})`
    )
    .join('\n');
  const truncated = movement.linesTruncated
    ? '\n  • Há outros itens nessa movimentação que não cabem no resumo recente.'
    : '';
  return `- ${kindLabel(movement.kind)} · ${formatDate(movement.createdAt)}\n${lines || '  • Sem linhas disponíveis no resumo.'}${truncated}`;
};

export const resolveKyrubInventoryHistoryRead = (
  message: string,
  context?: KyrubErpContextSnapshot
): KyrubiaInventoryHistoryResult | null => {
  if (!isKyrubInventoryHistoryReadIntent(message)) return null;
  if (!context || context.availability.inventoryMovements !== true) {
    return {
      reply: 'O histórico recente do estoque está temporariamente indisponível para consulta.',
      matchedCount: 0,
    };
  }

  const movements = context.inventoryMovements ?? [];
  if (movements.length === 0) {
    return {
      reply: 'Ainda não há movimentações recentes de estoque registradas neste resumo.',
      matchedCount: 0,
    };
  }

  const intent = normalize(message);
  const filtered = movements
    .filter(movement => movementMatchesIntent(movement, intent))
    .filter(movement => movementItemMatchesIntent(movement, intent))
    .slice(0, 10);

  if (filtered.length === 0) {
    return {
      reply: 'Não encontrei movimentações recentes que correspondam a essa consulta de estoque.',
      matchedCount: 0,
    };
  }

  const truncation = context.inventoryMovementsTruncated === true
    ? '\n\nEste é o resumo recente; podem existir movimentações mais antigas no ledger completo do estoque.'
    : '';
  return {
    reply: `Movimentações recentes do estoque:\n${filtered.map(formatMovement).join('\n')}${truncation}`,
    matchedCount: filtered.length,
  };
};
