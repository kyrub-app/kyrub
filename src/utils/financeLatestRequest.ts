/**
 * One authority per mounted finance reader. The HTTP request is aborted when
 * its scope changes, and a generation number also fences already-resolved
 * responses that may complete after the abort.
 */
export type FinanceRequestTicket = {
  generation: number;
  signal: AbortSignal;
};

export const createFinanceLatestRequest = () => {
  let generation = 0;
  let current: AbortController | null = null;
  return {
    begin(): FinanceRequestTicket {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return { generation: ++generation, signal: controller.signal };
    },
    isCurrent(ticket: FinanceRequestTicket): boolean {
      return ticket.generation === generation && !ticket.signal.aborted;
    },
    invalidate(): void {
      current?.abort();
      current = null;
      generation++;
    },
  };
};
