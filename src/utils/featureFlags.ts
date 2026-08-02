const enabled = (value: unknown): boolean =>
  typeof value === 'string'
  && value.trim().toLocaleLowerCase('en-US') === 'true';

const explicitlyDisabled = (value: unknown): boolean =>
  typeof value === 'string'
  && ['false', '0', 'off', 'disabled'].includes(
    value.trim().toLocaleLowerCase('en-US')
  );

const identityVerificationSetting =
  import.meta.env.VITE_IDENTITY_VERIFICATION_ENABLED;

// Identity verification is part of the user profile and must be available in
// Preview and production by default. It may still be turned off explicitly
// during an emergency rollout by setting the flag to false/0/off/disabled.
export const identityVerificationEnabled =
  import.meta.env.DEV
  || enabled(identityVerificationSetting)
  || !explicitlyDisabled(identityVerificationSetting);
