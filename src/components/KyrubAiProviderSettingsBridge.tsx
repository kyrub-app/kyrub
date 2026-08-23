import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  deleteUserAiProviderCredential,
  loadUserAiProviderSettings,
  saveUserAiProviderCredential,
  setPreferredUserAiProvider,
  testUserAiProviderCredential,
  type UserAiProviderId,
  type UserAiProviderMetadata,
  type UserAiProviderSettings,
} from '../ai/userAiProviderSettings';

const PROVIDERS: Array<{
  id: UserAiProviderId;
  name: string;
  description: string;
  helpUrl: string;
  helpText: string;
}> = [
  {
    id: 'google-gemini',
    name: 'Gemini',
    description: 'Para quem possui acesso à API Gemini pelo Google AI Studio.',
    helpUrl: 'https://ai.google.dev/gemini-api/docs/get-started?hl=pt-br',
    helpText: 'Como obter uma chave no Google AI Studio',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Para quem possui uma conta de API da OpenAI. ChatGPT e API são produtos cobrados separadamente.',
    helpUrl: 'https://help.openai.com/pt-br/articles/4936850-where-do-i-find-my-openai-api-key',
    helpText: 'Como obter uma chave da OpenAI',
  },
  {
    id: 'anthropic',
    name: 'Claude / Anthropic',
    description: 'Para quem possui acesso à API da Anthropic pelo Console da Anthropic.',
    helpUrl: 'https://docs.anthropic.com/pt/docs/claude-code/sdk',
    helpText: 'Como obter uma chave da Anthropic',
  },
];

type BusyAction =
  | { provider: UserAiProviderId; action: 'save' | 'test' | 'delete' | 'prefer' }
  | null;

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null;

const emptySettings = (): UserAiProviderSettings => ({
  providers: PROVIDERS.map(provider => ({
    provider: provider.id,
    configured: false,
    status: 'not_configured',
  })),
  preferredProvider: null,
});

const statusText = (metadata: UserAiProviderMetadata): string => {
  if (metadata.status === 'available') return 'Conectada';
  if (metadata.status === 'saved') return 'Salva · teste necessário';
  if (metadata.status === 'invalid') return 'Credencial recusada';
  return 'Não conectada';
};

const statusClass = (metadata: UserAiProviderMetadata): string => {
  if (metadata.status === 'available') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200';
  }
  if (metadata.status === 'invalid') {
    return 'border-red-500/25 bg-red-500/10 text-red-200';
  }
  if (metadata.status === 'saved') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-400';
};

export function KyrubAiProviderSettingsBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [settings, setSettings] = useState<UserAiProviderSettings>(emptySettings);
  const [draftKeys, setDraftKeys] = useState<Partial<Record<UserAiProviderId, string>>>({});
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let currentWorkspace: HTMLElement | null = null;
    let currentHost: HTMLDivElement | null = null;

    const sync = () => {
      const workspace = document.getElementById('kyrub-ai-workspace');
      if (workspace === currentWorkspace && currentHost?.isConnected) return;
      currentHost?.remove();
      currentHost = null;
      currentWorkspace = workspace;
      setHost(null);
      if (!workspace) return;

      const nextHost = document.createElement('div');
      nextHost.id = 'kyrub-ai-provider-settings-host';
      workspace.insertBefore(nextHost, workspace.firstChild);
      currentHost = nextHost;
      setHost(nextHost);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(sync, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  const metadataByProvider = useMemo(
    () => new Map(settings.providers.map(item => [item.provider, item])),
    [settings.providers]
  );

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    try {
      setSettings(await loadUserAiProviderSettings());
      setNotice(null);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error
          ? error.message
          : 'Não foi possível carregar suas integrações de IA.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !user) return;
    void refresh();
  }, [open, user?.uid]);

  useEffect(() => {
    if (user) return;
    setOpen(false);
    setAdvancedOpen(false);
    setDraftKeys({});
    setSettings(emptySettings());
  }, [user]);

  const save = async (provider: UserAiProviderId) => {
    const apiKey = (draftKeys[provider] ?? '').trim();
    if (!apiKey) {
      setNotice({ type: 'error', message: 'Cole uma chave de API antes de salvar.' });
      return;
    }
    setBusy({ provider, action: 'save' });
    try {
      await saveUserAiProviderCredential(provider, apiKey);
      setNotice({
        type: 'success',
        message: 'Chave protegida no cofre. Agora teste a conexão.',
      });
      await refresh();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar a credencial.',
      });
    } finally {
      setDraftKeys(current => ({ ...current, [provider]: '' }));
      setBusy(null);
    }
  };

  const test = async (provider: UserAiProviderId) => {
    setBusy({ provider, action: 'test' });
    try {
      await testUserAiProviderCredential(provider);
      setNotice({ type: 'success', message: 'Conexão validada pelo provedor.' });
      await refresh();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível testar a conexão.',
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: UserAiProviderId) => {
    setBusy({ provider, action: 'delete' });
    try {
      if (settings.preferredProvider === provider) {
        await setPreferredUserAiProvider(null);
      }
      await deleteUserAiProviderCredential(provider);
      setNotice({ type: 'success', message: 'Credencial removida do cofre.' });
      await refresh();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível remover a credencial.',
      });
    } finally {
      setBusy(null);
    }
  };

  const prefer = async (provider: UserAiProviderId) => {
    setBusy({ provider, action: 'prefer' });
    try {
      await setPreferredUserAiProvider(provider);
      setNotice({ type: 'success', message: 'IA preferida atualizada.' });
      await refresh();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível alterar a IA preferida.',
      });
    } finally {
      setBusy(null);
    }
  };

  if (!host) return null;

  const noticeClass = notice?.type === 'success'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
    : notice?.type === 'error'
      ? 'border-red-500/25 bg-red-500/10 text-red-100'
      : 'border-violet-500/25 bg-violet-500/10 text-violet-100';

  return createPortal(
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!user}
          className="flex items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-200 disabled:opacity-40"
        >
          <PlugZap className="h-4 w-4" />
          Minha IA
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[360] flex items-end justify-center bg-slate-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Como usar IA na Kyrubia"
        >
          <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-950 p-4 shadow-2xl sm:rounded-3xl sm:p-5">
            <header className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-300">
                  Kyrubia · escolha como usar IA
                </span>
                <h2 className="mt-1 text-xl font-black text-white">Como você quer usar a IA?</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Você não precisa entender de API para usar a Kyrubia. A conexão com uma IA própria é uma opção avançada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setAdvancedOpen(false);
                  setDraftKeys({});
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400"
                aria-label="Fechar configurações de IA"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <section className="rounded-3xl border border-violet-500/25 bg-violet-500/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
                    <CircleDollarSign className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-black uppercase text-amber-200">
                    Em preparação
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-black text-white">Usar Créditos Kyrubia</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Caminho simples: sem chave, sem console de desenvolvedor e sem configuração técnica. Você compra créditos e a Kyrubia cuida da IA por você.
                </p>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  O saldo e a cobrança por Créditos Kyrubia ainda serão ativados em uma próxima etapa. Nada será cobrado nesta tela agora.
                </p>
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-slate-300">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-black text-white">Usar minha própria IA</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Opção avançada para quem já possui acesso de API ao Gemini, OpenAI ou Anthropic e quer usar a própria conta na Kyrubia.
                </p>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(current => !current)}
                  className="mt-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-200"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {advancedOpen ? 'Ocultar configuração avançada' : 'Configurar minha própria IA'}
                </button>
              </section>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs leading-relaxed text-slate-400">
              <strong className="text-slate-200">Importante:</strong> assinar ChatGPT, Gemini ou Claude não significa necessariamente ter acesso de API incluído. A API pode ter cadastro, limites e cobrança próprios definidos pelo provedor.
            </div>

            {notice && (
              <div className={`mt-3 rounded-2xl border px-3 py-2.5 text-xs ${noticeClass}`}>
                {notice.message}
              </div>
            )}

            {advancedOpen && (
              <>
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-100">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Sua chave é enviada autenticadamente ao servidor, criptografada no cofre e nunca é exibida novamente. Quando sua própria IA é usada, a inferência não consome Créditos Kyrubia. Fallback pago não acontece silenciosamente.
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {PROVIDERS.map(provider => {
                    const metadata = metadataByProvider.get(provider.id) ?? {
                      provider: provider.id,
                      configured: false,
                      status: 'not_configured' as const,
                    };
                    const isBusy = busy?.provider === provider.id;
                    const preferred = settings.preferredProvider === provider.id;
                    const available = metadata.status === 'available';
                    return (
                      <section
                        key={provider.id}
                        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-black text-white">{provider.name}</h3>
                              {preferred && (
                                <span className="flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-1 text-[9px] font-black uppercase text-violet-200">
                                  <Star className="h-3 w-3" /> Preferida
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500">{provider.description}</p>
                            <a
                              href={provider.helpUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black text-violet-300 hover:text-violet-200"
                            >
                              {provider.helpText} <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${statusClass(metadata)}`}>
                            {statusText(metadata)}
                          </span>
                        </div>

                        {metadata.masked && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                            <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                            <span>{metadata.masked}</span>
                          </div>
                        )}

                        <label className="mt-3 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                          Chave de API
                        </label>
                        <div className="mt-1.5 flex gap-2">
                          <input
                            type="password"
                            autoComplete="off"
                            value={draftKeys[provider.id] ?? ''}
                            onChange={event => setDraftKeys(current => ({
                              ...current,
                              [provider.id]: event.target.value.slice(0, 4096),
                            }))}
                            placeholder={metadata.configured ? 'Substituir chave salva…' : 'Cole aqui a chave de API…'}
                            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-500/60"
                          />
                          <button
                            type="button"
                            onClick={() => void save(provider.id)}
                            disabled={isBusy || !(draftKeys[provider.id] ?? '').trim()}
                            className="rounded-xl bg-violet-500 px-3 py-2.5 text-xs font-black text-white disabled:opacity-40"
                          >
                            {busy?.provider === provider.id && busy.action === 'save'
                              ? <LoaderCircle className="h-4 w-4 animate-spin" />
                              : 'Salvar'}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {metadata.configured && (
                            <button
                              type="button"
                              onClick={() => void test(provider.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black text-slate-300 disabled:opacity-40"
                            >
                              {busy?.provider === provider.id && busy.action === 'test'
                                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                              Testar conexão
                            </button>
                          )}
                          {available && !preferred && (
                            <button
                              type="button"
                              onClick={() => void prefer(provider.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-200 disabled:opacity-40"
                            >
                              <Star className="h-3.5 w-3.5" /> Usar como preferida
                            </button>
                          )}
                          {metadata.configured && (
                            <button
                              type="button"
                              onClick={() => void remove(provider.id)}
                              disabled={isBusy}
                              className="flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] font-black text-red-200 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remover
                            </button>
                          )}
                        </div>

                        {available && (
                          <div className="mt-3 flex items-center gap-2 text-[10px] text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Chave validada diretamente com o provedor.
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <p className="text-[10px] leading-relaxed text-slate-500">
                Por enquanto, anexos continuam fora do roteamento da IA própria até a normalização multimodal ficar pronta.
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-[10px] font-black text-slate-300 disabled:opacity-40"
              >
                {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Atualizar
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    host
  );
}
