import type { KyrubStoreProfilePatch } from '../../shared/kyrubActions';

export type KyrubiaDeterministicStoreProfileUpdate = {
  patch: KyrubStoreProfilePatch;
  field: keyof KyrubStoreProfilePatch;
};

const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const cleanExplicitValue = (value: string | undefined): string =>
  (value ?? '')
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

const hasUpdateVerb = (message: string): boolean =>
  /\b(mude|mudar|altere|alterar|troque|trocar|atualize|atualizar|defina|definir|coloque|colocar)\b/
    .test(normalized(message));

const profileFieldSignals = (message: string): Array<keyof KyrubStoreProfilePatch> => {
  const intent = normalized(message);
  const signals: Array<keyof KyrubStoreProfilePatch> = [];
  if (/\bnome\s+(?:da\s+)?(?:minha\s+)?loja\b/.test(intent)) signals.push('name');
  if (/\bdescricao\s+(?:da\s+)?(?:minha\s+)?loja\b/.test(intent)) signals.push('description');
  if (/\bendereco\s+(?:da\s+)?(?:minha\s+)?loja\b/.test(intent)) signals.push('address');
  if (/\bcontato\s+(?:da\s+)?(?:minha\s+)?loja\b/.test(intent)) signals.push('contact');
  if (/\b(?:palavras[- ]?chave|keywords)\s+(?:da\s+)?(?:minha\s+)?loja\b/.test(intent)) {
    signals.push('keywords');
  }
  return signals;
};

const explicitValueAfter = (
  message: string,
  fieldPattern: RegExp
): string => cleanExplicitValue(fieldPattern.exec(message)?.[1]);

export const resolveKyrubiaDeterministicStoreProfileUpdate = (
  message: string
): KyrubiaDeterministicStoreProfileUpdate | null => {
  if (!hasUpdateVerb(message)) return null;

  const fields = profileFieldSignals(message);
  if (fields.length !== 1) return null;
  const field = fields[0];

  if (field === 'name') {
    const name = explicitValueAfter(
      message,
      /\bnome\s+(?:da\s+)?(?:minha\s+)?loja\s*(?:para|como|:|=)\s*(.+)$/i
    );
    return name.length >= 2 ? { field, patch: { name } } : null;
  }

  if (field === 'description') {
    const description = explicitValueAfter(
      message,
      /\bdescri[cç][aã]o\s+(?:da\s+)?(?:minha\s+)?loja\s*(?:para|como|:|=)\s*(.+)$/i
    );
    return description ? { field, patch: { description } } : null;
  }

  if (field === 'address') {
    const address = explicitValueAfter(
      message,
      /\bendere[cç]o\s+(?:da\s+)?(?:minha\s+)?loja\s*(?:para|como|:|=)\s*(.+)$/i
    );
    return address ? { field, patch: { address } } : null;
  }

  if (field === 'contact') {
    const contact = explicitValueAfter(
      message,
      /\bcontato\s+(?:da\s+)?(?:minha\s+)?loja\s*(?:para|como|:|=)\s*(.+)$/i
    );
    return contact ? { field, patch: { contact } } : null;
  }

  const rawKeywords = explicitValueAfter(
    message,
    /\b(?:palavras[- ]?chave|keywords)\s+(?:da\s+)?(?:minha\s+)?loja\s*(?:para|como|:|=)\s*(.+)$/i
  );
  const keywords = rawKeywords
    .split(/[,;\n]+/)
    .map(item => item.trim().toLocaleLowerCase('pt-BR'))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 30);

  return keywords.length > 0 ? { field, patch: { keywords } } : null;
};
