import { useEffect, useState } from 'react';
import {
  Bell, Briefcase, CheckSquare, Cherry, Compass, GraduationCap, LogIn, ShoppingBag,
  Sparkles, UserRound, Wallet, X,
} from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { RendaTab } from './tabs/RendaTab';
import { KyrubiaWelcomePanel } from './KyrubiaWelcomePanel';
import { JemboeHabilidadesTab } from './tabs/JemboeHabilidadesTab';
import { auth } from '../utils/firebase';
import { loadStorefrontOriginContext } from '../utils/storefrontOriginContext';

type GuestTab = 'habilidades' | 'renda' | 'praca' | 'cairubia';
type GuestPanel = 'deliveries' | 'freelas' | null;

interface PublicOpportunity {
  id: string;
  label: string;
  vehicleType?: 'bicycle' | 'motorcycle' | 'car';
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function KyrubGuestWorkspace() {
  const [tab, setTab] = useState<GuestTab>('renda');
  const [panel, setPanel] = useState<GuestPanel>(null);
  const [loginReason, setLoginReason] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [opportunities, setOpportunities] = useState<PublicOpportunity[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [origin] = useState(() => loadStorefrontOriginContext());

  useEffect(() => {
    if (panel !== 'deliveries') return;
    const controller = new AbortController();
    setDiscoveryLoading(true);
    setDiscoveryError('');
    void fetch('/api/delivery-opportunities/public', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw Error('PUBLIC_DELIVERY_DISCOVERY_UNAVAILABLE');
      return response.json() as Promise<{ opportunities?: PublicOpportunity[] }>;
    }).then(data => {
      if (!controller.signal.aborted) {
        setOpportunities(Array.isArray(data.opportunities) ? data.opportunities : []);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setOpportunities([]);
        setDiscoveryError('Não foi possível consultar as oportunidades agora.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setDiscoveryLoading(false);
    });
    return () => controller.abort();
  }, [panel]);

  const requestLogin = (reason: string) => {
    setPanel(null);
    setFeedback('');
    setLoginReason(reason);
  };

  const login = async () => {
    if (loginPending) return;
    setLoginPending(true);
    setFeedback('');
    try {
      // An authenticated session changes the top-level route to the complete
      // existing workspace. An opportunity is NEVER accepted automatically.
      await signInWithPopup(auth, provider);
    } catch {
      setFeedback('Não foi possível concluir o login. Tente novamente.');
    } finally {
      setLoginPending(false);
    }
  };

  const iconButtonClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition hover:text-orange-300';
  const openPanel = (target: GuestPanel) => {
    setPanel(target);
    setFeedback('');
  };

  return (
    <div id="kyrub-guest-workspace" data-kyrub-guest-workspace="true"
      className="flex min-h-[100dvh] flex-col bg-slate-950 text-slate-100">
      <header id="app-header" className="sticky top-0 z-40 flex items-center gap-2 border-b border-slate-900 bg-slate-950/95 px-3 py-3 backdrop-blur-md">
        <button type="button" className={iconButtonClass + ' mr-auto'} title="Meu perfil"
          aria-label="Abrir meu perfil" id="header-user-profile-trigger"
          onClick={() => requestLogin('acessar seu perfil')}>
          <UserRound className="h-4 w-4" />
        </button>
        <button type="button" className={iconButtonClass + ' text-orange-400'}
          title="Cairúbia" aria-label="Abrir Cairúbia" id="header-kyrubia-trigger"
          onClick={() => setTab('cairubia')}>
          <Sparkles className="h-4 w-4" />
        </button>
        <button type="button" className={iconButtonClass} title="Tarefas"
          aria-label="Abrir Tarefas" id="header-tasks-trigger"
          onClick={() => requestLogin('acessar e salvar suas tarefas')}>
          <CheckSquare className="h-4 w-4" />
        </button>
        <button type="button" className={iconButtonClass + ' text-orange-400'} title="Pitangas e XP"
          aria-label="Abrir Pitangas e XP" id="header-pitangas-trigger"
          onClick={() => requestLogin('consultar suas Pitangas e XP')}>
          <Cherry className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={iconButtonClass + ' text-teal-400'} title="Carteira"
          aria-label="Abrir Carteira" id="header-wallet-balance"
          onClick={() => requestLogin('consultar sua carteira')}>
          <Wallet className="h-4 w-4" />
        </button>
        <button type="button" className={iconButtonClass} title="Notificações"
          aria-label="Abrir notificações" onClick={() => requestLogin('consultar suas notificações')}>
          <Bell className="h-4 w-4" />
        </button>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 space-y-6 px-4 py-6 pb-28" data-kyrub-workspace={tab}>
        <div id="kyrub-guest-brand" className="flex min-h-10 items-center gap-2 border-b border-slate-800 pb-3" aria-label="Kyrub — ecossistema">
          <img src="/kyrub-logo.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
          <strong className="kyrub-brand-wordmark text-[1.6rem] leading-none">Kyrub</strong>
          <button
            id="kyrub-guest-signin"
            type="button"
            onClick={() => requestLogin('acessar sua conta')}
            aria-label="Entrar na conta Kyrub"
            className="ml-auto inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 text-xs font-bold text-slate-950 transition-colors hover:bg-orange-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Entrar
          </button>
        </div>
        {origin && (
          <a href={origin.path} className="block rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-xs font-bold text-orange-200">
            Voltar para {origin.storeName}
          </a>
        )}
        {tab === 'habilidades' && <JemboeHabilidadesTab />}
        {tab === 'renda' && (
          <RendaTab
            guestReadOnly
            onGuestBrowseDeliveries={() => openPanel('deliveries')}
            onGuestBrowseFreelas={() => openPanel('freelas')}
            onGuestLoginRequired={requestLogin}
            deliveries={[]}
            freelanceJobs={[]}
            setShowDeliveryModal={() => requestLogin('solicitar uma entrega')}
            setShowFazerEntregasModal={() => openPanel('deliveries')}
            setShowFreelaModal={() => requestLogin('solicitar um freela')}
            setShowFazerFreelasModal={() => openPanel('freelas')}
            setIsGestaoOpen={() => requestLogin('gerenciar sua loja')}
            setGestaoRole={() => undefined}
            triggerToast={message => setFeedback(message)}
          />
        )}
        {tab === 'praca' && (
          <section id="guest-praca" className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-orange-400">Praça</span>
              <h1 className="mt-2 text-2xl font-black">Explore lojas e ofertas</h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Veja vitrines públicas sem entrar. Publicar, conectar, avaliar ou salvar uma oferta exige identificação.
              </p>
            </div>
            <a href="/@kyrub-oficial" className="flex items-center justify-between rounded-3xl border border-slate-800 bg-slate-900 p-5 text-sm font-bold text-white">
              <span className="flex items-center gap-3"><ShoppingBag className="h-5 w-5 text-orange-400" /> Kyrub Oficial</span>
              <span className="text-orange-400">Ver vitrine →</span>
            </a>
          </section>
        )}
        {tab === 'cairubia' && (
          <section id="guest-cairubia" className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <KyrubiaWelcomePanel
              onSelectPrompt={() => requestLogin('conversar com a Cairúbia')}
              onConnectAi={() => requestLogin('conectar sua inteligência artificial')}
            />
            <button type="button" onClick={() => requestLogin('conversar com a Cairúbia')}
              className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-3 text-xs font-black uppercase">
              Entrar para conversar
            </button>
          </section>
        )}
        {feedback && (
          <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300">{feedback}</p>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-900 bg-slate-950/95 px-6 py-3 backdrop-blur-lg"
        aria-label="Navegação principal">
        {([
          ['habilidades', GraduationCap, 'Jemboé', 'Habilidades'],
          ['renda', Briefcase, 'Catu', 'Renda'],
          ['praca', Compass, 'Taba', 'Praça'],
        ] as const).map(([nextTab, Icon, label, meaning]) => (
          <button type="button" key={nextTab} onClick={() => setTab(nextTab)}
            aria-current={tab === nextTab ? 'page' : undefined}
            aria-label={`${label} — ${meaning}`}
            className={'flex flex-col items-center gap-0.5 text-[10px] font-bold uppercase ' +
              (tab === nextTab ? 'text-orange-500' : 'text-slate-500')}>
            <Icon className="h-5 w-5" />
            <span>{label}</span>
            <span className="text-[8px] font-medium normal-case">{meaning}</span>
          </button>
        ))}
      </nav>

      {panel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" role="presentation">
          <section role="dialog" aria-modal="true"
            aria-label={panel === 'deliveries' ? 'Oportunidades de entrega' : 'Oportunidades de freela'}
            className="max-h-[85dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">{panel === 'deliveries' ? 'Fazer entregas' : 'Fazer freela'}</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Fechar" className={iconButtonClass}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {panel === 'deliveries' ? (
              <>
                <p className="text-xs leading-5 text-slate-400">
                  Consulta pública com dados reduzidos. Endereços, valores contratuais e aceite só aparecem após identificação e verificações de elegibilidade.
                </p>
                {discoveryLoading && <p role="status" className="text-xs text-slate-300">Consultando oportunidades…</p>}
                {discoveryError && <p role="alert" className="text-xs text-amber-300">{discoveryError}</p>}
                {!discoveryLoading && !discoveryError && opportunities.length === 0 && (
                  <p className="rounded-xl bg-slate-950 p-4 text-xs text-slate-400">Nenhuma entrega está disponível na consulta pública neste momento.</p>
                )}
                {opportunities.map(job => (
                  <article key={job.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <h3 className="text-sm font-black">{job.label}</h3>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">Referência: {job.id.slice(0, 12)}</p>
                    <button type="button" onClick={() => requestLogin('aceitar uma entrega')}
                      className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-xs font-black uppercase">
                      Aceitar entrega
                    </button>
                  </article>
                ))}
              </>
            ) : (
              <p className="rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-400">
                A listagem pública de freelas ainda não está disponível. Você pode conhecer a categoria sem login; para candidatar-se ou anunciar serviços, será necessário entrar.
              </p>
            )}
          </section>
        </div>
      )}

      {loginReason && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="guest-login-title"
            className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6">
            <div className="text-[10px] font-bold uppercase tracking-wide text-orange-400">{loginReason === 'acessar seu perfil' ? 'Minha conta' : 'Acesso ao Kyrub'}</div>
            <h2 id="guest-login-title" className="mt-1 text-lg font-black">{loginReason === 'acessar seu perfil' ? 'Perfil e identidade' : 'Entre para continuar'}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Para {loginReason}, você precisa fazer login. A navegação pública continua disponível sem conta.
            </p>
            {feedback && <p role="alert" className="mt-3 text-xs text-red-300">{feedback}</p>}
            <button type="button" onClick={() => void login()} disabled={loginPending}
              className="mt-5 w-full rounded-xl bg-orange-600 p-3 text-xs font-black uppercase disabled:opacity-60">
              {loginPending ? 'Entrando…' : 'Entrar com Google'}
            </button>
            <button type="button" onClick={() => { setLoginReason(''); setFeedback(''); }}
              className="mt-2 w-full rounded-xl border border-slate-700 p-3 text-xs font-bold">
              Continuar explorando
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
