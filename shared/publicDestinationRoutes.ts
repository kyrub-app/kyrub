// Canonical public addresses are typed; recognizing a path never grants access.
// Keep existing storefront URLs unchanged. Social/card publication requires
// server-side identity resolution and visibility checks before enabling routes.
export type PublicDestinationKind = 'store' | 'profile' | 'community' | 'card';
export type PublicDestination = { kind: PublicDestinationKind; identifier: string };
export const PUBLIC_ADDRESS_ORIGIN = 'https://kyrub.com';
const prefixes: Record<PublicDestinationKind, string> = {
  store: '/@', profile: '/kairubido/', community: '/comunidade/', card: '/cartao/',
};
const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const profilePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
function validIdentifier(kind: PublicDestinationKind, value: string): boolean {
  return value.length > 0 && value.length <= 120 &&
    (kind === 'profile' ? profilePattern : identifierPattern).test(value);
}
export function buildPublicDestinationPath(kind: PublicDestinationKind, identifier: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(prefixes, kind) || !validIdentifier(kind, identifier)) return null;
  return prefixes[kind] + identifier;
}
export function buildPublicDestinationUrl(kind: PublicDestinationKind, identifier: string): string | null {
  const path = buildPublicDestinationPath(kind, identifier);
  return path ? PUBLIC_ADDRESS_ORIGIN + path : null;
}
export function parsePublicDestinationPath(path: string): PublicDestination | null {
  for (const kind of Object.keys(prefixes) as PublicDestinationKind[]) {
    const prefix = prefixes[kind];
    if (!path.startsWith(prefix)) continue;
    const identifier = path.slice(prefix.length);
    if (validIdentifier(kind, identifier)) return { kind, identifier };
  }
  return null;
}
export function parsePublicDestinationUrl(url: string): PublicDestination | null {
  if (!url.startsWith(PUBLIC_ADDRESS_ORIGIN + '/')) return null;
  return parsePublicDestinationPath(url.slice(PUBLIC_ADDRESS_ORIGIN.length));
}
// A card is an independent public capability. Its permanent identifier must
// not be derived from mutable profile names, store slugs or community names.
export type PublicCardSelection = {
  profile: boolean;
  storeIds: readonly string[];
  communityIds: readonly string[];
};
