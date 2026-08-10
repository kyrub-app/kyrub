import { recordCurrentUserActivityEvent } from './kyrubActivityBrowser';

export const STORE_SETTINGS_SAVE_ACTION_ID = 'store.settings.save';

export function recordStoreSettingsSaveAttempt(): void {
  recordCurrentUserActivityEvent({
    type: 'interaction.action_attempted',
    domain: 'store',
    source: 'client_observation',
    screenId: 'store:settings',
    actionId: STORE_SETTINGS_SAVE_ACTION_ID,
  });
}

export function recordStoreSettingsSaveConfirmed(): void {
  recordCurrentUserActivityEvent({
    type: 'result.action_succeeded',
    domain: 'store',
    source: 'authoritative_write_ack',
    screenId: 'store:settings',
    actionId: STORE_SETTINGS_SAVE_ACTION_ID,
  });
}
