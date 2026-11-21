import { parsePublicDestinationPath } from '../../shared/publicDestinationRoutes';

export type KyrubAppRoute =
  | {
      kind: 'public-storefront';
      slug: string;
      canonicalPath: string;
    }
  | {
      kind: 'public-profile' | 'public-community' | 'public-card';
      identifier: string;
      canonicalPath: string;
    }
  | {
      kind: 'invalid-public-social';
      canonicalPath: string;
    }
  | {
      kind: 'staff-app';
      canonicalPath: '/staff';
      legacyRedirect: boolean;
    }
  | {
      kind: 'default';
      canonicalPath: string;
    };

const PUBLIC_STOREFRONT_PREFIX = '/@';
const OPERATIONAL_PATH = '/staff';
const LEGACY_OPERATIONAL_PATH = '/app';

export const normalizeStorefrontSlug = (value: string): string =>
  decodeURIComponent(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export const buildPublicStorefrontPath = (slug: string): string => {
  const normalizedSlug = normalizeStorefrontSlug(slug);
  return normalizedSlug ? `${PUBLIC_STOREFRONT_PREFIX}${normalizedSlug}` : '';
};

export const buildPublicStorefrontUrl = (
  origin: string,
  slug: string
): string => {
  const path = buildPublicStorefrontPath(slug);
  if (!path) return '';
  return `${origin.replace(/\/$/, '')}${path}`;
};

export const resolveKyrubAppRoute = (pathname: string): KyrubAppRoute => {
  const cleanPath =
    `/${pathname}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

  // Category namespaces take precedence over old /:slug/staff aliases.
  if (cleanPath === '/kairubido' || cleanPath.startsWith('/kairubido/') ||
      cleanPath === '/comunidade' || cleanPath.startsWith('/comunidade/') ||
      cleanPath === '/cartao' || cleanPath.startsWith('/cartao/')) {
    const destination = parsePublicDestinationPath(cleanPath);
    if (destination?.kind === 'profile' || destination?.kind === 'community' || destination?.kind === 'card') {
      return {kind: destination.kind === 'profile' ? 'public-profile' : destination.kind === 'community' ? 'public-community' : 'public-card',
        identifier:destination.identifier,canonicalPath:cleanPath};
    }
    return {kind:'invalid-public-social',canonicalPath:cleanPath};
  }

  const isLegacyOperationalPath =
    cleanPath === LEGACY_OPERATIONAL_PATH ||
    cleanPath.startsWith(`${LEGACY_OPERATIONAL_PATH}/`) ||
    (cleanPath !== OPERATIONAL_PATH && cleanPath.endsWith(OPERATIONAL_PATH));

  if (isLegacyOperationalPath) {
    return {
      kind: 'staff-app',
      canonicalPath: OPERATIONAL_PATH,
      legacyRedirect: true,
    };
  }

  if (
    cleanPath === OPERATIONAL_PATH ||
    cleanPath.startsWith(`${OPERATIONAL_PATH}/`)
  ) {
    return {
      kind: 'staff-app',
      canonicalPath: OPERATIONAL_PATH,
      legacyRedirect: false,
    };
  }

  if (cleanPath.startsWith(PUBLIC_STOREFRONT_PREFIX)) {
    const slugSegment =
      cleanPath.slice(PUBLIC_STOREFRONT_PREFIX.length).split('/')[0] ?? '';
    const slug = normalizeStorefrontSlug(slugSegment);
    if (slug) {
      return {
        kind: 'public-storefront',
        slug,
        canonicalPath: buildPublicStorefrontPath(slug),
      };
    }
  }

  return {
    kind: 'default',
    canonicalPath: cleanPath,
  };
};
