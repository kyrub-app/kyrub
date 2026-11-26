// Session-local subscription reconciliation. A failed listener is never a
// source of cached data; retry only on an explicit upstream refresh.
type Stop = () => void;
type Slot<T> = { value: T; stop?: Stop; failed: boolean };

export function createDetailSubscriptionRegistry<T>(
  start: (value: T, isCurrent: () => boolean, fail: () => void) => Stop,
  clear: (value: T) => void,
) {
  const slots = new Map<string, Slot<T>>();
  let closed = false;
  const remove = (key: string, slot: Slot<T>) => {
    slots.delete(key); // invalidate queued callbacks before unsubscribe
    slot.stop?.();
    clear(slot.value);
  };
  return {
    reconcile(desired: ReadonlyMap<string, T>, retryFailed = false) {
      if (closed) return;
      for (const [key, slot] of slots) {
        if (!desired.has(key) || (retryFailed && slot.failed)) remove(key, slot);
      }
      for (const [key, value] of desired) {
        if (slots.has(key)) continue;
        const slot: Slot<T> = {value, failed: false};
        slots.set(key, slot);
        const isCurrent = () => !closed && slots.get(key) === slot && !slot.failed;
        const fail = () => {
          if (!isCurrent()) return;
          slot.failed = true;
          slot.stop?.();
          clear(value);
        };
        try {
          slot.stop = start(value, isCurrent, fail);
          if (slot.failed || closed || slots.get(key) !== slot) slot.stop();
        } catch {
          fail();
        }
      }
    },
    close() {
      closed = true;
      for (const [key, slot] of slots) remove(key, slot);
    },
  };
}
