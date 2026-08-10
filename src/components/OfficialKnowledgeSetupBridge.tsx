import { useEffect, useMemo, useState } from 'react';
import { Copy, Search, ShieldCheck, X } from 'lucide-react';
import { useCommunityDirectory } from '../hooks/useCommunityDirectory';
import {
  getKyrubOfficialKnowledgeConfig,
  readOfficialCommunityKnowledge,
  type KyrubOfficialKnowledgeConfig,
} from '../knowledge/officialCommunityKnowledge';
import type { KyrubKnowledgeSnapshot } from '../../shared/kyrubKnowledge';
import { searchKyrubKnowledge } from '../../shared/kyrubKnowledgeSearch';

const SETUP_QUERY_KEY = 'officialKnowledgeSetup';

const isSetupEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(SETUP_QUERY_KEY) === '1';
};

const confidenceLabel = (value: 'high' | 'medium' | 'low'): string => {
  if (value === 'high') return 'alta';
  if (value === 'medium') return 'média';
  return 'baixa';
};

const excerpt = (value: string): string => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}…`;
};

export function OfficialKnowledgeSetupBridge() {
  const { user, communities, loading } = useCommunityDirectory();
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [snapshot, setSnapshot] = useState<KyrubKnowledgeSnapshot | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<KyrubKnowledgeSnapshot | null>(null);
  const [activeBusy, setActiveBusy] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const enabled = isSetupEnabled();
  const activeConfig = useMemo(() => getKyrubOfficialKnowledgeConfig(), []);
  const ownedCommunities = useMemo(
    () => communities.filter(community => community.isOwner),
    [communities]
  );
  const searchResults = useMemo(
    () =>
      activeSnapshot && searchQuery.trim()
        ? searchKyrubKnowledge(activeSnapshot.items, searchQuery, 5)
        : [],
    [activeSnapshot, searchQuery]
  );

  useEffect(() => {
    if (!enabled || !activeConfig.enabled) {
      setActiveSnapshot(null);
      return;
    }

    let cancelled = false;
    setActiveBusy(true);
    void readOfficialCommunityKnowledge(activeConfig)
      .then(value => {
        if (!cancelled) setActiveSnapshot(value);
      })
      .finally(() => {
        if (!cancelled) setActiveBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeConfig, enabled]);

  useEffect(() => {
    if (!enabled || selectedCommunityId || ownedCommunities.length === 0) return;
    const preferred = ownedCommunities.find(
      community => community.name.trim().toLocaleLowerCase('pt-BR') === 'manual kyrub'
    );
    setSelectedCommunityId((preferred ?? ownedCommunities[0]).id);
  }, [enabled, ownedCommunities, selectedCommunityId]);

  const selectedCommunity = ownedCommunities.find(
    community => community.id === selectedCommunityId
  );

  useEffect(() => {
    if (!enabled || !user || !selectedCommunity) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setProbeBusy(true);
    const config: KyrubOfficialKnowledgeConfig = {
      officialProfileUid: user.uid,
      communityIds: [selectedCommunity.id],
      enabled: true,
      source: 'diagnostic_candidate',
    };

    void readOfficialCommunityKnowledge(config)
      .then(value => {
        if (!cancelled) setSnapshot(value);
      })
      .finally(() => {
        if (!cancelled) setProbeBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, selectedCommunity, user]);

  if (!enabled) return null;

  const configText =
    user && selectedCommunity
      ? `VITE_KYRUB_OFFICIAL_PROFILE_UID=${user.uid}\nVITE_KYRUB_OFFICIAL_COMMUNITY_IDS=${selectedCommunity.id}`
      : '';

  const copyConfig = async () => {
    if (!configText) return;
    try {
      await navigator.clipboard.writeText(configText);
      setCopyState('Identificadores copiados.');
    } catch {
      setCopyState('Não foi possível copiar automaticamente. Selecione os valores abaixo.');
    }
  };

  const closeSetup = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete(SETUP_QUERY_KEY);
    window.location.href = url.toString();
  };

  return (
    <div className="fixed inset-0 z-[260] overflow-y-auto bg-slate-950/95 p-3 backdrop-blur-md sm:p-6">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-sky-500/25 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <span className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-300">
              Configuração segura · Conhecimento Oficial
            </span>
            <h1 className="mt-1 text-lg font-black text-white">
              Identificar Comunidade Oficial Kyrub
            </h1>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Este modo não transforma uma comunidade em oficial. Ele mostra as âncoras ativas, permite comparar comunidades pertencentes ao perfil e prova quais Debates passam pelas regras de confiança da fundação.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSetup}
            aria-label="Fechar configuração"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[7px] font-black uppercase tracking-wide text-emerald-300">
                  Fonte oficial configurada
                </span>
                {activeConfig.enabled ? (
                  <>
                    <p className="mt-1 text-[9px] text-slate-300">
                      Origem da configuração: {activeConfig.source === 'environment' ? 'Environment Variables' : 'fallback versionado da PR'}.
                    </p>
                    <p className="mt-2 break-all font-mono text-[8px] text-slate-500">
                      profileUid: {activeConfig.officialProfileUid}
                    </p>
                    <p className="mt-1 break-all font-mono text-[8px] text-slate-500">
                      communityIds: {activeConfig.communityIds.join(', ')}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[9px] text-amber-200">
                    Nenhuma fonte oficial está configurada neste build.
                  </p>
                )}
              </div>
            </div>

            {activeConfig.enabled && (
              <div className="mt-3">
                {activeBusy ? (
                  <p className="text-[9px] text-slate-500">Validando a fonte configurada…</p>
                ) : activeSnapshot && activeSnapshot.items.length > 0 ? (
                  <div className="space-y-2">
                    {activeSnapshot.items.map(item => (
                      <div key={item.id} className="rounded-2xl border border-emerald-500/20 bg-slate-950 p-3">
                        <span className="text-[7px] font-black uppercase text-emerald-300">
                          Conhecimento oficial recuperado
                        </span>
                        <strong className="mt-1 block text-[10px] text-white">{item.title}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-200">
                    A fonte está configurada, mas nenhum Debate vigente passou pelas revalidações de proprietário e autor.
                  </p>
                )}
                {activeSnapshot?.warnings.map(warning => (
                  <p key={warning} className="mt-2 text-[8px] text-amber-300">
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </section>

          {activeSnapshot && activeSnapshot.items.length > 0 && (
            <section className="rounded-3xl border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
                  <Search className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[7px] font-black uppercase tracking-wide text-violet-300">
                    Teste determinístico de busca · Zero Gemini
                  </span>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                    Digite uma pergunta livre. O Kyrub mostra quais artigos oficiais possuem correspondência lexical, o ranking e por que cada resultado apareceu. Baixa confiança não deve ser tratada como resposta definitiva.
                  </p>
                </div>
              </div>

              <label className="mt-3 block">
                <span className="text-[8px] font-black uppercase text-slate-500">Pergunta de teste</span>
                <textarea
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  rows={3}
                  placeholder="Ex.: como faço para publicar minha loja?"
                  className="mt-2 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 p-3 text-[11px] text-white outline-none focus:border-violet-400"
                />
              </label>

              {searchQuery.trim() && searchResults.length === 0 && (
                <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-200">
                  Nenhuma correspondência lexical foi encontrada. Isso é um resultado válido: o mecanismo não deve inventar uma referência apenas para responder.
                </p>
              )}

              {searchResults.length > 0 && (
                <div className="mt-3 space-y-2">
                  {searchResults[0]?.confidence === 'low' && (
                    <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] leading-relaxed text-amber-200">
                      A melhor correspondência ainda é fraca. Uma futura resposta da Kyrubia deverá pedir interpretação adicional ou assumir explicitamente a incerteza, nunca transformar este ranking em verdade automática.
                    </p>
                  )}
                  {searchResults.map((result, index) => (
                    <article key={result.item.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[7px] font-black uppercase text-violet-300">
                          #{index + 1} · confiança {confidenceLabel(result.confidence)}
                        </span>
                        <span className="font-mono text-[8px] text-slate-500">
                          score {result.score.toFixed(2)} · cobertura {Math.round(result.coverage * 100)}%
                        </span>
                      </div>
                      <strong className="mt-1 block text-[10px] text-white">{result.item.title}</strong>
                      <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                        {excerpt(result.item.content)}
                      </p>
                      <p className="mt-2 text-[8px] text-slate-500">
                        Termos encontrados: {result.matchedTokens.join(', ') || '—'}
                      </p>
                      {result.titleMatchedTokens.length > 0 && (
                        <p className="mt-1 text-[8px] text-slate-600">
                          Também no título: {result.titleMatchedTokens.join(', ')}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {!user && !loading && (
            <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[10px] text-amber-200">
              Entre no Kyrub com o perfil proprietário da Comunidade Oficial para continuar o diagnóstico comparativo.
            </p>
          )}

          {loading && (
            <p className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[10px] text-slate-400">
              Carregando comunidades deste perfil…
            </p>
          )}

          {user && !loading && ownedCommunities.length === 0 && (
            <p className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[10px] text-amber-200">
              Este perfil não aparece como proprietário de nenhuma comunidade.
            </p>
          )}

          {ownedCommunities.length > 0 && (
            <section>
              <h2 className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                Comunidades deste perfil
              </h2>
              <div className="mt-2 grid gap-2">
                {ownedCommunities.map(community => (
                  <button
                    key={community.id}
                    type="button"
                    onClick={() => {
                      setSelectedCommunityId(community.id);
                      setCopyState('');
                    }}
                    className={`rounded-2xl border p-3 text-left ${
                      community.id === selectedCommunityId
                        ? 'border-sky-500/45 bg-sky-500/10'
                        : 'border-slate-800 bg-slate-950'
                    }`}
                  >
                    <strong className="block text-[10px] text-white">{community.name}</strong>
                    <span className="mt-1 block break-all font-mono text-[8px] text-slate-500">
                      communityId: {community.id}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {user && selectedCommunity && (
            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[10px] font-black uppercase text-white">Diagnóstico da comunidade selecionada</h2>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                    Estes identificadores não são senha, token ou chave privada. Esta seção apenas compara a comunidade selecionada usando as mesmas revalidações do leitor oficial.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2 rounded-2xl bg-slate-900 p-3 font-mono text-[9px] text-slate-300">
                <p className="break-all">VITE_KYRUB_OFFICIAL_PROFILE_UID={user.uid}</p>
                <p className="break-all">VITE_KYRUB_OFFICIAL_COMMUNITY_IDS={selectedCommunity.id}</p>
              </div>

              <button
                type="button"
                onClick={() => void copyConfig()}
                className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 text-[8px] font-black uppercase text-slate-950"
              >
                <Copy className="h-4 w-4" />
                Copiar identificadores
              </button>
              {copyState && <p className="mt-2 text-[8px] text-sky-200">{copyState}</p>}
            </section>
          )}

          {user && selectedCommunity && (
            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
              <h2 className="text-[10px] font-black uppercase text-white">
                Prova de recuperação da comunidade selecionada
              </h2>
              {probeBusy ? (
                <p className="mt-3 text-[9px] text-slate-500">Lendo Debates elegíveis…</p>
              ) : snapshot && snapshot.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {snapshot.items.map(item => (
                    <div key={item.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <span className="text-[7px] font-black uppercase text-emerald-300">
                        Conhecimento elegível
                      </span>
                      <strong className="mt-1 block text-[10px] text-white">{item.title}</strong>
                      <span className="mt-1 block text-[8px] text-slate-500">
                        Fonte: Debate oficial vigente
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-200">
                  Nenhum Debate elegível foi encontrado nesta comunidade com este perfil como autor oficial.
                </p>
              )}

              {snapshot?.warnings.map(warning => (
                <p key={warning} className="mt-2 text-[8px] text-amber-300">
                  {warning}
                </p>
              ))}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
