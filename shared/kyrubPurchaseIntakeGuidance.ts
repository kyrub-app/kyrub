import { parseKyrubInventoryIntakeEntries } from './kyrubInventoryIntake.js';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

const hasPurchaseDocumentContext = (message: string): boolean =>
  /\b(nota fiscal|nf\b|compra|fornecedor|mercadoria|recebimento)\b/.test(
    normalizeText(message)
  );

const hasExplicitInventoryMutation = (message: string): boolean =>
  /\b(atualiz\w*|ajust\w*|dar entrada|de entrada|registre\w*|adicione\w*|inclua\w*|lance\w*|reponha\w*|repor|coloque\w*|transform\w*|processe\w*|converta\w*)\b/.test(
    normalizeText(message)
  );

export const shouldGuidePurchaseIntake = (
  userMessage: string,
  observedDocumentText: string
): boolean => {
  const purchaseContext =
    hasPurchaseDocumentContext(userMessage) ||
    hasPurchaseDocumentContext(observedDocumentText);
  if (!purchaseContext) return false;
  if (hasExplicitInventoryMutation(userMessage)) return false;
  return parseKyrubInventoryIntakeEntries(observedDocumentText).length > 0;
};

export const buildGuidedPurchaseIntakeReply = (
  originalReply: string,
  observedDocumentText: string
): string => {
  const entries = parseKyrubInventoryIntakeEntries(observedDocumentText);
  if (entries.length === 0) return originalReply;

  const itemSummary = entries
    .slice(0, 12)
    .map(entry => `- ${entry.name} — ${entry.quantity} ${entry.unit}`)
    .join('\n');
  const overflow = entries.length > 12
    ? `\n- +${entries.length - 12} item(ns) reconhecido(s)`
    : '';

  return [
    originalReply.trim(),
    '',
    `Encontrei ${entries.length} item(ns) nesta compra. Ainda não alterei seu estoque.`,
    '',
    itemSummary + overflow,
    '',
    'Antes de lançar, como você quer tratar esses itens?',
    '',
    '- Dar entrada como chegaram',
    '- Transformar ou porcionar algum item',
    '- Dividir um item entre destinos diferentes',
    '- Não controlar algum item no estoque',
    '',
    'Você pode decidir tudo agora ou simplesmente mandar dar entrada como veio e transformar depois.',
  ].join('\n');
};
