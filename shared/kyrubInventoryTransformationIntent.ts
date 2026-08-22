import {
  normalizeKyrubInventoryTransformationProposal,
  type KyrubInventoryTransformationLoss,
  type KyrubInventoryTransformationOutput,
  type KyrubInventoryTransformationProposal,
  type KyrubInventoryTransformationUnit,
} from './kyrubInventoryTransformation.js';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

const cleanName = (value: string): string =>
  value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^\s*(?:de|do|da|dos|das)\s+/i, '')
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const unitFrom = (value: string): KyrubInventoryTransformationUnit | null => {
  const normalized = normalizeText(value).replace(/\./g, '').trim();
  if (['un', 'und', 'unid', 'unidade', 'unidades'].includes(normalized)) return 'un';
  if (normalized === 'kg') return 'kg';
  if (normalized === 'g') return 'g';
  if (normalized === 'l') return 'l';
  if (normalized === 'ml') return 'ml';
  return null;
};

const numberFrom = (value: string): number | null => {
  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return null;
  let normalized = compact;
  if (compact.includes(',') && compact.includes('.')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const lineItem = (
  raw: string
): { name: string; quantity: number; unit: KyrubInventoryTransformationUnit } | null => {
  const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
  const quantityFirst = line.match(
    /^(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?(.+?)\s*$/i
  );
  if (quantityFirst) {
    const quantity = numberFrom(quantityFirst[1]);
    const unit = unitFrom(quantityFirst[2]);
    const name = cleanName(quantityFirst[3]);
    return quantity && unit && name ? { name, quantity, unit } : null;
  }

  const nameFirst = line.match(
    /^(.+?)\s*(?:[-–—:;]\s*|\s{2,})(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s*$/i
  );
  if (!nameFirst) return null;
  const name = cleanName(nameFirst[1]);
  const quantity = numberFrom(nameFirst[2]);
  const unit = unitFrom(nameFirst[3]);
  return quantity && unit && name ? { name, quantity, unit } : null;
};

const outputKindFromHeading = (
  heading: string
): KyrubInventoryTransformationOutput['kind'] => {
  const normalized = normalizeText(heading);
  if (/subproduto|sobra aproveitavel|retalho/.test(normalized)) return 'byproduct';
  if (/produto final|finalizado|acabado/.test(normalized)) return 'finished';
  return 'intermediate';
};

const structuredProposal = (
  message: string,
  conversationId: string
): KyrubInventoryTransformationProposal | null => {
  const sections = new Map<string, string[]>();
  let current = '';
  for (const rawLine of message.split(/\r?\n/)) {
    const heading = rawLine.match(
      /^\s*(consome|consumir|entrada|insumo|insumos|produz|produzir|produto intermediario|produto final|subproduto|subprodutos|perda|perdas)\s*:\s*$/i
    );
    if (heading) {
      current = normalizeText(heading[1]);
      sections.set(current, []);
      continue;
    }
    if (current && rawLine.trim()) sections.get(current)?.push(rawLine);
  }

  const inputLines = [...sections.entries()]
    .filter(([heading]) => /consome|consumir|entrada|insumo/.test(heading))
    .flatMap(([, lines]) => lines);
  const outputSections = [...sections.entries()]
    .filter(([heading]) => /produz|produzir|produto intermediario|produto final|subproduto/.test(heading));
  const lossLines = [...sections.entries()]
    .filter(([heading]) => /perda/.test(heading))
    .flatMap(([, lines]) => lines);

  const inputs = inputLines.map(lineItem);
  const outputs = outputSections.flatMap(([heading, lines]) =>
    lines.map(line => {
      const item = lineItem(line);
      return item ? { ...item, kind: outputKindFromHeading(heading) } : null;
    })
  );
  const losses = lossLines.map(line => {
    const item = lineItem(line);
    return item ? { ...item } : null;
  });

  if (
    inputs.length === 0 || outputs.length === 0 ||
    inputs.some(item => !item) || outputs.some(item => !item) || losses.some(item => !item)
  ) return null;

  return normalizeKyrubInventoryTransformationProposal({
    id: `inventory-transform-${stableHash(`${conversationId}:${message}`)}`,
    type: 'transform_inventory',
    inputs,
    outputs,
    losses,
    source: { kind: 'manual_transformation' },
    requiresConfirmation: true,
  });
};

const naturalProposal = (
  message: string,
  conversationId: string
): KyrubInventoryTransformationProposal | null => {
  const main = message.match(
    /(?:transforme|transformar|processe|processar|converta|converter)\s+(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?(.+?)\s+(?:em|para)\s+(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?(.+?)(?=(?:\s*[,;.]\s*|\s+e\s+)(?:registre|com|gerando|gere|e\s+gere|mais)\b|$)/i
  );
  if (!main) return null;

  const inputQuantity = numberFrom(main[1]);
  const inputUnit = unitFrom(main[2]);
  const inputName = cleanName(main[3]);
  const outputQuantity = numberFrom(main[4]);
  const outputUnit = unitFrom(main[5]);
  const outputName = cleanName(main[6]);
  if (!inputQuantity || !inputUnit || !inputName || !outputQuantity || !outputUnit || !outputName) {
    return null;
  }

  const losses: KyrubInventoryTransformationLoss[] = [];
  const lossPattern = /(?:perda|desperdicio|descarte)(?:\s+de)?\s+(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?([^,;.]+)/gi;
  for (const match of message.matchAll(lossPattern)) {
    const quantity = numberFrom(match[1]);
    const unit = unitFrom(match[2]);
    const name = cleanName(match[3]);
    if (!quantity || !unit || !name) return null;
    losses.push({ name, quantity, unit });
  }

  const outputs: KyrubInventoryTransformationOutput[] = [{
    name: outputName,
    quantity: outputQuantity,
    unit: outputUnit,
    kind: 'intermediate',
  }];

  const byproductPattern = /(?:subproduto|sobra aproveitavel|retalho)(?:\s+de)?\s+(\d[\d.,]*)\s*(un(?:d|id)?|unidade(?:s)?|kg|g|l|ml)\s+(?:de\s+)?([^,;.]+)/gi;
  for (const match of message.matchAll(byproductPattern)) {
    const quantity = numberFrom(match[1]);
    const unit = unitFrom(match[2]);
    const name = cleanName(match[3]);
    if (!quantity || !unit || !name) return null;
    outputs.push({ name, quantity, unit, kind: 'byproduct' });
  }

  return normalizeKyrubInventoryTransformationProposal({
    id: `inventory-transform-${stableHash(`${conversationId}:${message}`)}`,
    type: 'transform_inventory',
    inputs: [{ name: inputName, quantity: inputQuantity, unit: inputUnit }],
    outputs,
    losses,
    source: { kind: 'processing' },
    requiresConfirmation: true,
  });
};

export const buildKyrubInventoryTransformationProposal = (
  message: string,
  conversationId: string
): KyrubInventoryTransformationProposal | null => {
  const normalized = normalizeText(message);
  if (!/\b(transform|process|convert)/.test(normalized)) return null;
  return structuredProposal(message, conversationId) ?? naturalProposal(message, conversationId);
};
