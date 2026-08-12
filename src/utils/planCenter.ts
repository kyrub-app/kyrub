export const isPlanCenterLocation = (
  hostname: string,
  pathname: string,
  search = typeof globalThis.location !== 'undefined'
    ? globalThis.location.search
    : ''
): boolean => {
  const normalizedHost = hostname.trim().toLowerCase();
  const normalizedPath = pathname.trim().toLowerCase();
  const previewRequested =
    normalizedHost.endsWith('.vercel.app') &&
    new URLSearchParams(search).get('kyrub_plans_preview') === '1';

  return (
    normalizedHost === 'planos.kyrub.com' ||
    normalizedHost === 'planos.localhost' ||
    ((normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') &&
      (normalizedPath === '/planos' || normalizedPath.startsWith('/planos/'))) ||
    previewRequested
  );
};

export const getPlanCenterUrl = (
  location: Pick<Location, 'hostname' | 'origin'> = globalThis.location
): string => {
  const hostname = location.hostname.trim().toLowerCase();
  if (hostname.endsWith('.vercel.app')) {
    return `${location.origin}/?kyrub_plans_preview=1`;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${location.origin}/planos`;
  }
  return 'https://planos.kyrub.com';
};
