import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { KyrubKnowledgeSnapshot } from '../../shared/kyrubKnowledge';
import { searchKyrubKnowledge } from '../../shared/kyrubKnowledgeSearch';
import type {
  KyrubSemanticConfidence,
  KyrubSemanticSelection,
} from '../../shared/kyrubKnowledgeSemantic';
import {
  getKyrubOfficialKnowledgeConfig,
  readOfficialCommunityKnowledge,
} from '../knowledge/officialCommunityKnowledge';
import { auth } from '../utils/firebase';

const SEMANTIC_QUERY_KEY = 'officialKnowledgeSemantic';

const isSemanticSetupEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(SEMANTIC_QUERY_KEY) === '1';
};

const confidenceLabel = (value: KyrubSemanticConfidence): string => {
  if (value === 'high') return 'alta';
  if (value === 'medium') return 'média';
  return 'baixa';
};

const excerpt = (value: string): string => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= 280 ? compact : `${compact.slice(0, 277)}…`;
};

type SemanticApiResponse = {
  status?: string;
  message?: string;
  provider?: string;
  model?: string;
  selection?: KyrubSemanticSelection;
};

export function OfficialKnowledgeSemanticSetupBridge() {
  const enabled = isSemanticSetupEnabled();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [snapshot, setSnapshot] = useState<KyrubKnowledgeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticSelection, setSemanticSelection] = useState<KyrubSemanticSelection | null>(null);
  const [semanticError, setSemanticError] = useState('');

  const config = useMemo(() => getKyrubOfficialKnowledgeConfig(), []);
  const lexicalResults = useMemo(
    () => snapshot && query.trim()
      ? searchKyrubKnowledge(snapshot.items, query, 5)
      : [],
    [query, snapshot]
  );
  const needsSemantic = Boolean(
    query.trim() &&
    (lexicalResults.length === 0 || lexicalResults[0]?.confidence === 'low')
  );
  const semanticItems = useMemo(() => {
    if (!snapshot || !semanticSelection) return [];
    const byId = new Map(snapshot.items.map(item => [item.id, item]));
    return semanticSelection.candidateIds.flatMap(id => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }, [semanticSelection, snapshot]);

  useEffect(() => {
    if (!enabled) return;
    return onAuthStateChanged(auth, setUser);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !config.enabled) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void readOfficialCommunityKnowledge(config)
      .then(value => {
        if (!cancelled) setSnapshot(value);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config, enabled]);

  useEffect(() => {
    setSemanticSelection(null);
    setSemanticError('');
  }, [query]);

  if (!enabled) return null;

  const closeSetup = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete(SEMANTIC_QUERY_KEY);
    window.location.href = url.toString();
  };

  const interpretMeaning = async () => {
    if (!user || !snapshot || !query.trim() || semanticBusy) return;
    setSemanticBusy(true);
    setSemanticSelection(null);
    setSemanticError('');

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/official-knowledge-semantic', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          candidates: snapshot.items.slice(0, 12).map(item => ({
            id: item.id,
            title: item.title,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as SemanticApiResponse;
      if (!response.ok || payload.status !== 'ok' || !payload.selection) {
        throw new Error(payload.message || 'A interpretação semântica está indisponível agora.');
      }
      setSemanticSelection(payload.selection);
    } catch (error) {
      setSemanticError(
        error instanceof Error
          ? error.message
          : 'A interpretação semântica está indisponível agora.'
      );
    } finally {
      setSemanticBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[270] overflow-y-auto bg-slate-950/95 p-3 backdrop-blur-md sm:p-6">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-fuchsia-500/25 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <span className="text-[8px] font-black uppercase tracking-[0.18em] text-fuchsia-300">
              Diagnóstico · Interpretação semântica controlada
            </span>
            <h1 className="mt-1 text-lg font-black text-white">
              Significado → fonte oficial
            </h1>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              O lexical continua sendo a primeira tentativa. Se a confiança for baixa, você pode pedir uma interpretação semântica. A IA escolhe apenas IDs de artigos oficiais; ela não responde e não recebe o conteúdo do Manual KYRUB.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSetup}
            aria-label="Fechar diagnóstico"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <strong className="text-[9px] uppercase text-emerald-300">Fonte da verdade preservada</strong>
                <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                  {loading
                    ? 'Validando Manual KYRUB…'
                    : snapshot
                      ? `${snapshot.items.length} artigo(s) oficial(is) disponível(is).`
                      : 'Nenhuma fonte oficial foi carregada.'}
                </p>
              </div>
            </div>
          </section>

          {!user && (
            <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-200">
              Entre no Kyrub para usar este diagnóstico.
            </p>
          )}

          {user && snapshot && snapshot.items.length > 0 && (
            <section className="rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4">
              <div className="flex items-start gap-3">
                <Search className="mt-0.5 h-5 w-5 shrink-0 text-fuchsia-300" />
                <div>
                  <strong className="text-[9px] uppercase text-fuchsia-300">Pergunta humana</strong>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                    Primeiro vemos o que o lexical consegue provar sozinho. Gemini não é chamado enquanto você digita.
                  </p>
                </div>
              </div>

              <textarea
                value={query}
                onChange={event => setQuery(event.target.value)}
                rows={3}
                placeholder="Ex.: o que falta pra minha loja aparecer pras pessoas?"
                className="mt-3 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 p-3 text-[11px] text-white outline-none focus:border-fuchsia-400"
              />

              {query.trim() && (
                <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-[7px] font-black uppercase text-slate-500">Resultado lexical</span>
                  {lexicalResults[0] ? (
                    <>
                      <strong className="mt-1 block text-[10px] text-white">{lexicalResults[0].item.title}</strong>
                      <p className="mt-1 text-[8px] text-slate-500">
                        confiança {confidenceLabel(lexicalResults[0].confidence)} · score {lexicalResults[0].score.toFixed(2)} · cobertura {Math.round(lexicalResults[0].coverage * 100)}%
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[9px] text-amber-200">Nenhuma correspondência lexical.</p>
                  )}
                </div>
              )}

              {needsSemantic && (
                <div className="mt-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                    <p className="text-[9px] leading-relaxed text-slate-300">
                      O lexical assumiu incerteza. Ao tocar abaixo, <strong>a pergunta e somente os IDs/títulos dos artigos</strong> serão enviados ao Gemini. O corpo dos FAQs não sai do Kyrub nesta etapa.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={semanticBusy}
                    onClick={() => void interpretMeaning()}
                    className="mt-3 min-h-10 w-full rounded-xl bg-sky-400 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-50"
                  >
                    {semanticBusy ? 'Interpretando significado…' : 'Interpretar significado'}
                  </button>
                </div>
              )}

              {!needsSemantic && query.trim() && (
                <p className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[9px] text-emerald-200">
                  A busca lexical já atingiu confiança suficiente; este diagnóstico não chama Gemini automaticamente.
                </p>
              )}

              {semanticError && (
                <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-200">
                  {semanticError} Nenhum artigo será tratado como correto por causa dessa falha.
                </p>
              )}

              {semanticSelection && (
                <div className="mt-3 rounded-2xl border border-sky-500/20 bg-slate-950 p-3">
                  <span className="text-[7px] font-black uppercase text-sky-300">
                    Seleção semântica · confiança {confidenceLabel(semanticSelection.confidence)}
                  </span>
                  {semanticItems.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {semanticItems.map((item, index) => (
                        <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                          <span className="text-[7px] font-black uppercase text-slate-500">Candidato #{index + 1}</span>
                          <strong className="mt-1 block text-[10px] text-white">{item.title}</strong>
                          <p className="mt-2 text-[9px] leading-relaxed text-slate-400">{excerpt(item.content)}</p>
                          <p className="mt-2 text-[8px] text-emerald-300">
                            Conteúdo recuperado localmente após o ID ser escolhido.
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[9px] text-amber-200">
                      O interpretador não encontrou artigo suficientemente compatível. Nenhuma resposta deve ser inventada.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
