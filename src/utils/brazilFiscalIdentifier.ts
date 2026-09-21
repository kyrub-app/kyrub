export type BrazilFiscalTaxIdentifierKind = 'cpf' | 'cnpj' | 'unknown';

const ALLOWED_FISCAL_IDENTIFIER_PATTERN = /^[A-Z0-9.\-/\s]+$/;
const CPF_DIGIT_COUNT = 11;
const CNPJ_CHARACTER_COUNT = 14;

export const normalizeBrazilFiscalTaxIdentifier = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getBrazilFiscalTaxIdentifierKind = (
  value: string
): BrazilFiscalTaxIdentifierKind => {
  const raw = value.trim().toUpperCase();
  if (!raw || !ALLOWED_FISCAL_IDENTIFIER_PATTERN.test(raw)) return 'unknown';

  const compact = normalizeBrazilFiscalTaxIdentifier(raw);
  if (/^\d{11}$/.test(compact)) return 'cpf';
  if (/^[A-Z0-9]{12}\d{2}$/.test(compact)) return 'cnpj';
  return 'unknown';
};

export const isValidBrazilCpf = (value: string): boolean => {
  const compact = normalizeBrazilFiscalTaxIdentifier(value);
  if (!/^\d{11}$/.test(compact)) return false;
  if (/^(\d)\1{10}$/.test(compact)) return false;

  const digits = compact.split('').map(Number);
  const calculateDigit = (length: number, initialWeight: number): number => {
    const total = digits
      .slice(0, length)
      .reduce((sum, digit, index) => sum + digit * (initialWeight - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const firstDigit = calculateDigit(9, 10);
  if (firstDigit !== digits[9]) return false;
  const secondDigit = calculateDigit(10, 11);
  return secondDigit === digits[10];
};

const cnpjCharacterValue = (character: string): number =>
  character.charCodeAt(0) - 48;

const calculateCnpjDigit = (characters: string, weights: number[]): number => {
  const total = [...characters].reduce(
    (sum, character, index) => sum + cnpjCharacterValue(character) * weights[index],
    0
  );
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

export const isValidBrazilCnpj = (value: string): boolean => {
  const raw = value.trim().toUpperCase();
  if (!raw || !ALLOWED_FISCAL_IDENTIFIER_PATTERN.test(raw)) return false;

  const compact = normalizeBrazilFiscalTaxIdentifier(raw);
  if (compact.length !== CNPJ_CHARACTER_COUNT) return false;
  if (!/^[A-Z0-9]{12}\d{2}$/.test(compact)) return false;
  if (new Set(compact).size === 1) return false;

  const base = compact.slice(0, 12);
  const firstDigit = calculateCnpjDigit(
    base,
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  const secondDigit = calculateCnpjDigit(
    `${base}${firstDigit}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );

  return compact.slice(12) === `${firstDigit}${secondDigit}`;
};

export const isValidBrazilFiscalTaxIdentifier = (value: string): boolean => {
  const kind = getBrazilFiscalTaxIdentifierKind(value);
  if (kind === 'cpf') return isValidBrazilCpf(value);
  if (kind === 'cnpj') return isValidBrazilCnpj(value);
  return false;
};

export const validateBrazilFiscalIssuerIdentity = (
  legalName: string,
  taxIdentifier: string
): Exclude<BrazilFiscalTaxIdentifierKind, 'unknown'> => {
  if (!legalName.trim()) {
    throw new Error('Informe o nome ou a razão social do emissor fiscal.');
  }

  const kind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  if (kind === 'unknown' || !isValidBrazilFiscalTaxIdentifier(taxIdentifier)) {
    throw new Error(
      'Informe um CPF ou CNPJ válido. O cadastro também aceita o CNPJ alfanumérico vigente.'
    );
  }

  return kind;
};

export const BRAZIL_FISCAL_IDENTIFIER_LENGTHS = {
  cpf: CPF_DIGIT_COUNT,
  cnpj: CNPJ_CHARACTER_COUNT,
} as const;
