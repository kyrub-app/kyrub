/**
 * A tiny per-component request generation guard. Async requests are still
 * allowed to finish, but only the most recent generation may publish UI state.
 * Invalidating on effect cleanup prevents unmounted / previous-period results
 * from replacing the next selection.
 */
export type FinanceRequestGuard = {
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
  snapshot(): number;
};
export const createFinanceRequestGuard = (): FinanceRequestGuard => {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (request: number) => request === generation,
    invalidate: () => { generation++; },
    snapshot: () => generation,
  };
};
