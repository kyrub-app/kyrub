import { useEffect, useState } from 'react';
import {
  KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
  type KyrubiaOperationalWorkflowMessageDetail,
} from '../ai/operationalWorkflowStore';
import {
  KyrubAiNoteActionBridge as LegacyKyrubAiNoteActionBridge,
} from './KyrubAiNoteActionBridgeLegacy';

export function KyrubAiNoteActionBridge() {
  const [continuation, setContinuation] = useState<
    KyrubiaOperationalWorkflowMessageDetail | null
  >(null);

  useEffect(() => {
    let timeoutId: number | undefined;
    const handleContinuation = (event: Event) => {
      const detail = (
        event as CustomEvent<KyrubiaOperationalWorkflowMessageDetail>
      ).detail;
      if (!detail?.message) return;
      setContinuation(detail);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setContinuation(null), 15_000);
    };

    window.addEventListener(
      KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
      handleContinuation
    );
    return () => {
      window.removeEventListener(
        KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
        handleContinuation
      );
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <>
      <LegacyKyrubAiNoteActionBridge />
      {continuation && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[110] mx-auto max-w-md rounded-2xl border border-violet-500/30 bg-slate-950/95 p-4 text-sm leading-relaxed text-violet-100 shadow-2xl backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-black uppercase tracking-wider text-violet-300">
                Kyrubia · próximo produto
              </span>
              <p className="mt-1">{continuation.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setContinuation(null)}
              className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300"
            >
              Fechar
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
