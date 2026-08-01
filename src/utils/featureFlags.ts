const enabled = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().toLocaleLowerCase('en-US') === 'true';

export const identityVerificationEnabled =
  import.meta.env.DEV
  || enabled(import.meta.env.VITE_IDENTITY_VERIFICATION_ENABLED);
