// In-memory request suppression. The clock here is only a scheduling hint;
// the server chooses the actual period and never trusts a browser month.
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit',
});
function localMonth(now: number): string {
  const parts = formatter.formatToParts(new Date(now));
  return parts.find(p=>p.type==='year')?.value + '-' + parts.find(p=>p.type==='month')?.value;
}
export function createMonthlyPresenceSession<K extends object>(retryMs = 60_000) {
  let owner: K | null = null;
  let confirmedMonth = '';
  let disabled = false;
  let retryAt = 0;
  const synchronize = (next: K | null) => {
    if (owner === next) return;
    owner = next;
    confirmedMonth = '';
    disabled = false;
    retryAt = 0;
  };
  return {
    synchronize,
    shouldRequest(next: K, now: number) {
      synchronize(next);
      return !disabled && confirmedMonth !== localMonth(now) && now >= retryAt;
    },
    attempted(next: K, now: number) {
      if (owner === next) retryAt = now + retryMs;
    },
    acknowledge(next: K, value: unknown) {
      if (owner !== next || !value || typeof value !== 'object') return;
      const reply = value as {status?:unknown;month?:unknown};
      if (reply.status === 'disabled') disabled = true;
      if (reply.status === 'confirmed' && typeof reply.month === 'string' &&
          /^\d{4}-(0[1-9]|1[0-2])$/.test(reply.month)) confirmedMonth = reply.month;
    },
  };
}
