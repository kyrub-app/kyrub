import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../utils/firebase';
import { calculatePitangueiraJourney, SEEDS_PER_BOSQUE, type SemeaduraPostKind } from '../../shared/pitangueiraJourney';

export const SEMEADURA_UI_ENABLED = import.meta.env?.VITE_SEMEADURA_UI_ENABLED === 'true';

type SemeaduraStatus = {
  count: number;
  closed: boolean;
  seeded: boolean;
  canSemear: boolean;
  authorId: string;
  pitangueiras: number;
  bosqueCompleted: boolean;
};

export async function requestSemeadura(
  action: 'status' | 'semear' | 'journey' | 'community-journey',
  target?: { kind: SemeaduraPostKind; postId: string } | { communityId: string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Faça login para semear.');
  const response = await fetch('/api/action-execute?transport=semeadura', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(target ?? {}) }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(
    response.status === 409
      ? 'Esta publicação não aceita semeaduras agora.'
      : 'Semeadura indisponível. Tente novamente.',
  );
  return response.json() as Promise<Record<string, unknown>>;
}

const normalizeSemeadura = (raw: Record<string, unknown>): SemeaduraStatus => {
  const count = raw.count;
  if (!Number.isSafeInteger(count) || Number(count) < 0 ||
      Number(count) > SEEDS_PER_BOSQUE ||
      typeof raw.authorId !== 'string' ||
      typeof raw.closed !== 'boolean' ||
      typeof raw.seeded !== 'boolean' ||
      typeof raw.canSemear !== 'boolean' ||
      raw.closed !== (count === SEEDS_PER_BOSQUE)) {
    throw new Error('Resposta de semeadura inconsistente.');
  }
  return {
    count: Number(count),
    closed: raw.closed,
    seeded: raw.seeded,
    canSemear: raw.canSemear,
    authorId: raw.authorId,
    pitangueiras: Math.floor(Number(count) / 1000),
    bosqueCompleted: raw.closed,
  };
};

export function SemearButton({
  kind, postId, viewerId, className, compact = false,
}: {
  kind: SemeaduraPostKind;
  postId: string;
  viewerId: string;
  className?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<SemeaduraStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const target = holderRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [kind, postId]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = normalizeSemeadura(await requestSemeadura('status', { kind, postId }, signal));
    if (!signal?.aborted) {
      setState(next);
      setError('');
    }
  }, [kind, postId]);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError('');
    if (viewerId && visible) {
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError('Não foi possível carregar as sementes.');
      });
    }
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; postId?: string }>).detail;
      if (detail?.kind === kind && detail.postId === postId && viewerId && visible) {
        void refresh(controller.signal).catch(() => undefined);
      }
    };
    window.addEventListener('kyrub-semeadura-updated', sync);
    return () => {
      controller.abort();
      window.removeEventListener('kyrub-semeadura-updated', sync);
    };
  }, [kind, postId, viewerId, visible, refresh]);

  const semear = async () => {
    if (!state?.canSemear || inFlight.current || !viewerId) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await requestSemeadura('semear', { kind, postId });
      if (result.status !== 'accepted' && result.status !== 'already_seeded' &&
          result.status !== 'closed') {
        throw new Error('Resultado de semeadura desconhecido.');
      }
      // Query the authoritative status after the write. Never infer account
      // awards or allow an optimistic increment on a potentially failed write.
      try {
        await refresh();
      } catch {
        // An accepted write is not a failure when the follow-up status read
        // times out. The immutable receipt prevents duplicate seed credits.
        setError('Semente recebida; o progresso ainda não foi atualizado.');
      }
      window.dispatchEvent(new CustomEvent('kyrub-semeadura-updated', {
        detail: { kind, postId },
      }));
    } catch {
      setError('Não foi possível semear. Tente novamente.');
      await refresh().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const journey = calculatePitangueiraJourney(state?.count ?? 0);
  const label = state?.closed
    ? 'Bosque concluído'
    : state?.seeded
      ? 'Semeado'
      : state?.authorId === viewerId
        ? 'Sua publicação'
        : state && !state.canSemear
          ? 'Participe para semear'
          : 'Semear';
  const compactLabel = state?.closed ? 'Concluído' : state?.seeded ? 'Semeado' : 'Semear';
  return (
    <div ref={holderRef} className="min-w-0">
      <button type="button"
        aria-label={`${label} · ${state?.count ?? 0} sementes recebidas`}
        aria-pressed={Boolean(state?.seeded)}
        title={`${(state?.count ?? 0).toLocaleString('pt-BR')} de ${SEEDS_PER_BOSQUE.toLocaleString('pt-BR')} sementes · ${journey.pitangueiras} pitangueiras · teto de 1 bosque por publicação`}
        disabled={!state || !state.canSemear || busy || !viewerId}
        onClick={() => void semear()}
        className={className ?? 'flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs font-bold text-emerald-300 disabled:opacity-60'}>
        {!compact && (state?.closed ? (
          <span aria-hidden="true" title="Bosque concluído">🌲</span>
        ) : (
          <img src="/kyrub-pitanga-seed.svg" alt="" aria-hidden="true" title="Semente da pitangueira" className="h-[18px] w-[18px] shrink-0 object-contain" />
        ))}
        <span className={compact ? 'whitespace-nowrap' : 'truncate'}>{compact
          ? compactLabel
          : !viewerId ? 'Entre para semear' : !visible || !state ? 'Sementes…' : label + ' · ' + state.count.toLocaleString('pt-BR')}</span>
      </button>
      {error && <p role="status" className="mt-1 text-[10px] text-amber-300">{error}</p>}
    </div>
  );
}
