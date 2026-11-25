// Ephemeral queue scoped to the exact authenticated session object.
// Never transfer pending events, acknowledgements or retries to a new account.
type Actor = { uid: string };
type Event = { id: string; actorUid: string };
type Batch<K, T> = { owner: K; events: T[]; controller: AbortController };

export function createActivitySessionQueue<K extends Actor, T extends Event>(max: number) {
  let owner: K | null = null;
  let pending: T[] = [];
  let inFlight: Batch<K, T> | null = null;
  const synchronize = (next: K | null) => {
    if (next === owner) return false;
    inFlight?.controller.abort();
    inFlight = null;
    pending = [];
    owner = next;
    return true;
  };
  return {
    synchronize,
    enqueue(next: K | null, event: T) {
      synchronize(next);
      if (!owner || event.actorUid !== owner.uid || pending.some(item => item.id === event.id) ||
          inFlight?.events.some(item => item.id === event.id)) return false;
      pending = [...pending, event].slice(-max);
      return true;
    },
    size: () => pending.length,
    begin(next: K | null, count: number) {
      synchronize(next);
      if (!owner || inFlight || !pending.length) return null;
      const batch: Batch<K, T> = {owner, events: pending.slice(0, count), controller: new AbortController()};
      inFlight = batch;
      return batch;
    },
    isCurrent(next: K | null, batch: Batch<K, T>) {
      return next === owner && batch.owner === owner && inFlight === batch && !batch.controller.signal.aborted;
    },
    finish(next: K | null, batch: Batch<K, T>, acknowledged: boolean) {
      synchronize(next);
      if (inFlight !== batch) return false;
      if (acknowledged) {
        const ids = new Set(batch.events.map(event => event.id));
        pending = pending.filter(event => !ids.has(event.id));
      }
      inFlight = null;
      return true;
    },
  };
}
