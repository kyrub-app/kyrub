export type StoreOwnedPixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'evp';

export interface StoreOwnedPixConfigurationInput {
  keyType: StoreOwnedPixKeyType;
  key: string;
  recipientName: string;
  recipientCity: string;
  enabled?: boolean;
}

export interface StoreOwnedPixConfiguration {
  keyType: StoreOwnedPixKeyType;
  key: string;
  recipientName: string;
  recipientCity: string;
  enabled: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const digits = (value: string): string => value.replace(/\D+/gu, '');

const cpfCheckDigit = (base: string, factor: number): number => {
  let total = 0;
  for (const character of base) {
    total += Number(character) * factor;
    factor -= 1;
  }
  const remainder = (total * 10) % 11;
  return remainder === 10 ? 0 : remainder;
};

const validCpf = (value: string): boolean => {
  if (!/^\d{11}$/u.test(value) || /^(\d)\1{10}$/u.test(value)) return false;
  const first = cpfCheckDigit(value.slice(0, 9), 10);
  const second = cpfCheckDigit(value.slice(0, 10), 11);
  return first === Number(value[9]) && second === Number(value[10]);
};

const cnpjCheckDigit = (base: string, weights: readonly number[]): number => {
  const sum = [...base].reduce(
    (total, character, index) => total + Number(character) * weights[index],
    0
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

const validCnpj = (value: string): boolean => {
  if (!/^\d{14}$/u.test(value) || /^(\d)\1{13}$/u.test(value)) return false;
  const first = cnpjCheckDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjCheckDigit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(value[12]) && second === Number(value[13]);
};

const normalizePhone = (value: string): string => {
  const hasPlus = value.trim().startsWith('+');
  const numeric = digits(value);
  const withCountry = numeric.startsWith('55') ? numeric : `55${numeric}`;
  if (!hasPlus && numeric.startsWith('55') && (numeric.length === 12 || numeric.length === 13)) {
    return `+${numeric}`;
  }
  if (!/^55\d{10,11}$/u.test(withCountry)) throw new Error('STORE_PIX_PHONE_INVALID');
  return `+${withCountry}`;
};

const normalizeKey = (type: StoreOwnedPixKeyType, value: unknown): string => {
  const input = clean(value);
  if (!input) throw new Error('STORE_PIX_KEY_REQUIRED');

  if (type === 'cpf') {
    const normalized = digits(input);
    if (!validCpf(normalized)) throw new Error('STORE_PIX_CPF_INVALID');
    return normalized;
  }
  if (type === 'cnpj') {
    const normalized = digits(input);
    if (!validCnpj(normalized)) throw new Error('STORE_PIX_CNPJ_INVALID');
    return normalized;
  }
  if (type === 'email') {
    const normalized = input.toLocaleLowerCase('en-US');
    if (
      normalized.length > 77 ||
      !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu.test(normalized)
    ) {
      throw new Error('STORE_PIX_EMAIL_INVALID');
    }
    return normalized;
  }
  if (type === 'phone') return normalizePhone(input);
  if (type === 'evp') {
    const normalized = input.toLocaleLowerCase('en-US');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
      throw new Error('STORE_PIX_EVP_INVALID');
    }
    return normalized;
  }
  throw new Error('STORE_PIX_KEY_TYPE_INVALID');
};

const brCodeText = (value: unknown, maximum: number, errorCode: string): string => {
  const normalized = clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/[^A-Z0-9 .\-/]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized || normalized.length > maximum) throw new Error(errorCode);
  return normalized;
};

export const isStoreOwnedPixKeyType = (value: unknown): value is StoreOwnedPixKeyType =>
  value === 'cpf' || value === 'cnpj' || value === 'email' || value === 'phone' || value === 'evp';

export const normalizeStoreOwnedPixConfiguration = (
  value: unknown
): StoreOwnedPixConfiguration => {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  if (!isStoreOwnedPixKeyType(record.keyType)) {
    throw new Error('STORE_PIX_KEY_TYPE_INVALID');
  }
  return {
    keyType: record.keyType,
    key: normalizeKey(record.keyType, record.key),
    recipientName: brCodeText(record.recipientName, 25, 'STORE_PIX_RECIPIENT_NAME_INVALID'),
    recipientCity: brCodeText(record.recipientCity, 15, 'STORE_PIX_RECIPIENT_CITY_INVALID'),
    enabled: record.enabled !== false,
  };
};

export const maskStoreOwnedPixKey = (
  keyType: StoreOwnedPixKeyType,
  keyInput: string
): string => {
  const key = clean(keyInput);
  if (!key) return '';
  if (keyType === 'email') {
    const [local, domain = ''] = key.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (keyType === 'phone') return `${key.slice(0, 3)}••••••${key.slice(-4)}`;
  if (keyType === 'evp') return `${key.slice(0, 8)}••••${key.slice(-4)}`;
  return `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
};
