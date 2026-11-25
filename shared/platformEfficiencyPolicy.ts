// Runtime configuration, not observed usage, invoices or cost savings.
export const NOTIFICATION_FOREGROUND_POLL_MS=15000;
export const NOTIFICATION_HIDDEN_NO_ALERTS_POLL_MS=60000;

export function notificationPollInterval(hidden:boolean,browserAlerts:boolean){
 return hidden&&!browserAlerts?NOTIFICATION_HIDDEN_NO_ALERTS_POLL_MS:NOTIFICATION_FOREGROUND_POLL_MS;
}

export function projectNotificationPollingPolicy(){
 return {
  foregroundPerHour:3600000/NOTIFICATION_FOREGROUND_POLL_MS,
  hiddenWithoutAlertsPerHour:3600000/NOTIFICATION_HIDDEN_NO_ALERTS_POLL_MS,
  basis:'configured_interval' as const,
 };
}
