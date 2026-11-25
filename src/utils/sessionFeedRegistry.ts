// One in-memory upstream per currently authenticated session. No disk cache.
// Key by session object, not UID, so a fresh login never reuses an old feed.
type Stop = () => void;
type Consumer<T> = { change: (value: T) => void; error: (error: Error) => void };
type Session<T, K extends object> = {
  key: K;
  consumers: Set<Consumer<T>>;
  latest?: T;
  stop?: Stop;
  stopped: boolean;
};
export function createSessionFeedRegistry<T, K extends object>(
  current: () => K | null,
  start: (key: K, change: (value: T) => void, error: (error: Error) => void) => Stop,
  empty: () => T,
  copy: (value: T) => T,
) {
  let session: Session<T, K> | undefined;
  const deliver = (fn: () => void) => {
    try { fn(); } catch (error) { console.error('Feed consumer callback failed', error); }
  };
  const close = (s: Session<T, K>, retract: boolean) => {
    if (s.stopped) return;
    s.stopped = true;
    if (session === s) session = undefined;
    s.latest = undefined;
    const consumers = [...s.consumers];
    s.consumers.clear();
    s.stop?.();
    if (retract) consumers.forEach(c => deliver(() => c.change(empty())));
  };
  const isCurrent = (s: Session<T, K>) => {
    if (s.stopped || session !== s) return false;
    if (current() !== s.key) { close(s, true); return false; }
    return true;
  };
  return {
    invalidate() {
      if (session && current() !== session.key) close(session, true);
    },
    subscribe(change: Consumer<T>['change'], error: Consumer<T>['error']): Stop {
      const key = current();
      if (session && session.key !== key) close(session, true);
      if (!key) { change(empty()); return () => {}; }
      const consumer = {change, error};
      let s = session;
      const fresh = !s;
      if (!s) {
        s = {key, consumers: new Set(), stopped: false};
        session = s;
      }
      const active = s;
      active.consumers.add(consumer);
      if (fresh) {
        try {
          active.stop = start(key, value => {
            if (!isCurrent(active)) return;
            active.latest = copy(value);
            for (const c of [...active.consumers]) {
              if (!isCurrent(active)) break;
              if (active.consumers.has(c)) deliver(() => c.change(copy(value)));
            }
          }, failure => {
            if (!isCurrent(active)) return;
            for (const c of [...active.consumers]) {
              if (!isCurrent(active)) break;
              if (active.consumers.has(c)) deliver(() => c.error(failure));
            }
          });
          if (active.stopped) active.stop();
        } catch (failure) {
          const err = failure instanceof Error ? failure : new Error(String(failure));
          for (const c of [...active.consumers]) deliver(() => c.error(err));
          close(active, true);
        }
      } else if (isCurrent(active) && active.latest !== undefined) {
        deliver(() => change(copy(active.latest!)));
      }
      return () => {
        active.consumers.delete(consumer);
        if (!active.consumers.size) close(active, false);
      };
    },
  };
}
