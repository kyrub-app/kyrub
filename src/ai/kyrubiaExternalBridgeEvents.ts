export const KYRUBIA_EXTERNAL_BRIDGE_OPEN_EVENT = 'kyrubia-external-bridge-open';

export const openKyrubiaExternalBridge = (): void => {
  window.dispatchEvent(new Event(KYRUBIA_EXTERNAL_BRIDGE_OPEN_EVENT));
};
