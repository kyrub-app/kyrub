/**
 * The Official Kyrub storefront is the exclusive public purchase destination
 * for Pro and Business. Keep this separate from the legacy Plan Center router,
 * which remains available for historical plan and subscription information.
 */
export const KYRUB_OFFICIAL_STORE_PLANS_URL =
  'https://www.kyrub.com/@kyrub-oficial' as const;

export const getOfficialStorePlansUrl = (): string =>
  KYRUB_OFFICIAL_STORE_PLANS_URL;
