export type KyrubEconomyKind =
  | 'k_coin'
  | 'kyrub_xp'
  | 'store_loyalty_points'
  | 'kyrubia_credits';

export type KyrubEconomyFundingAuthority =
  | 'kyrub'
  | 'store'
  | 'sponsor'
  | 'partner'
  | 'user_purchase';

export interface KyrubEconomyDescriptor {
  kind: KyrubEconomyKind;
  monetaryBalance: boolean;
  purchasableWithMoney: boolean;
  convertibleToKCoin: boolean;
  fundingAuthorities: readonly KyrubEconomyFundingAuthority[];
}

export const KYRUB_ECONOMIES: Readonly<Record<KyrubEconomyKind, KyrubEconomyDescriptor>> = {
  k_coin: {
    kind: 'k_coin',
    monetaryBalance: false,
    purchasableWithMoney: false,
    convertibleToKCoin: true,
    fundingAuthorities: ['kyrub', 'store', 'sponsor', 'partner'],
  },
  kyrub_xp: {
    kind: 'kyrub_xp',
    monetaryBalance: false,
    purchasableWithMoney: false,
    convertibleToKCoin: false,
    fundingAuthorities: ['kyrub'],
  },
  store_loyalty_points: {
    kind: 'store_loyalty_points',
    monetaryBalance: false,
    purchasableWithMoney: false,
    convertibleToKCoin: false,
    fundingAuthorities: ['store'],
  },
  kyrubia_credits: {
    kind: 'kyrubia_credits',
    monetaryBalance: false,
    purchasableWithMoney: true,
    convertibleToKCoin: false,
    fundingAuthorities: ['user_purchase'],
  },
};

export const assertNoAutomaticEconomyConversion = (
  from: KyrubEconomyKind,
  to: KyrubEconomyKind
): void => {
  if (from === to) return;
  throw new Error(`AUTOMATIC_ECONOMY_CONVERSION_FORBIDDEN:${from}->${to}`);
};

export const isKCoinFinancialBalance = (): false => false;
