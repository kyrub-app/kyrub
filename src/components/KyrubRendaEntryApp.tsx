import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  BriefcaseBusiness,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  NotebookPen,
  ShoppingBag,
  Sparkles,
  Store,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  loadStorefrontOriginContext,
  type StorefrontOriginContext,
} from '../utils/storefrontOriginContext';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const incomePaths = [
  {
    icon: Bike,
    eyebrow: 'Kyrub Entregas',
    title: 'Faça entregas e gere renda',
    description:
      'Encontre oportunidades locais de entrega e acompanhe seus ganhos dentro do ecossistema.',
  },
  {
    icon: BriefcaseBusiness,
    eyebrow: 'Kyrub Freelas',
    title: 'Encontre trabalhos e serviços',
    description:
      'Descubra demandas de negócios próximos ou ofereça suas habilidades para outras pessoas.',
  },
  {
    icon: ShoppingBag,
    eyebrow: 'Kyrub Ofertas',
    title: 'Ative sua própria loja',
    description:
      'Transforme produtos, serviços ou uma atividade profissional em uma vitrine dentro do Kyrub.',
  },
];

export function KyrubRendaEntryApp() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authResolved, setAuthResolved] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [origin] = useState<StorefrontOriginContext | null>(() =>
    loadStorefrontOriginContext()
  );

  useEffect(
    () =>
      onAuthStateChanged(auth, currentUser => {
        setUser(currentUser);
        setAuthResolved(true);
      }),
    []
  );

  const login = async (): Promise<void> => {
    if (loginPending) return;
    setLoginPending(true);
    setLoginError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Kyrub Renda Google login failed.', error);
      setLoginError('Não foi possível concluir o login com Google.');
    } finally {
      setLoginPending(false);
    }
  };

  const openFullApp = (): void => {
    window.location.assign('/?app=1');
  };

  if (!authResolved) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        <LoaderCircle className="h-7 w-7 animate-spin text-orange-400" />
      </main>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white" id="kyrub-renda-entry">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/kyrub-logo.svg"
              alt=""
              aria-hidden="true"
              className="h-10 w-10 rounded-xl object-cover"
            />
            <div className="min-w-0">
              <span className="block font-mono text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                Meu Kyrub
              </span>
              <strong className="block truncate text-base font-black">Renda</strong>
            </div>
          </div>

          {user ? (
            <button
              type="button"
              onClick={openFullApp}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-black uppercase text-slate-200"
              id="renda-entry-open-full-app"
            >
              Meu painel
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void login()}
              disabled={loginPending}
              className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-60"
              id="renda-entry-google-login"
            >
              {loginPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              Entrar
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-12 pt-4 sm:px-6">
        {origin && (
          <a
            href={origin.path}
            id="kyrub-return-to-origin-store"
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/[0.09] px-4 text-orange-200 shadow-lg shadow-orange-950/10"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <strong className="block truncate text-xs font-black">
                  Voltar para {origin.storeName}
                </strong>
                <span className="block text-[9px] text-orange-200/65">
                  Seu carrinho e a loja de origem continuam preservados
                </span>
              </span>
            </span>
            <Store className="h-4 w-4 shrink-0" />
          </a>
        )}

        <section className="overflow-hidden rounded-[2rem] border border-orange-500/20 bg-gradient-to-br from-orange-500/[0.11] via-slate-900 to-slate-950 p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10 text-orange-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-5 font-mono text-[9px] font-black uppercase tracking-[0.2em] text-orange-400">
            Comece por aqui
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Encontre formas de gerar renda com o que você já sabe ou pode fazer.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
            Explore o Kyrub sem precisar criar uma conta agora. O login só aparece quando uma ação precisar ser salva, assumida ou vinculada a você.
          </p>

          {user && (
            <div className="mt-5 flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3 text-[10px] leading-5 text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Você já está autenticado. Essa mesma conta vale para o Kyrub e para suas compras nas vitrines.
              </span>
            </div>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Caminhos para gerar renda">
          {incomePaths.map(({ icon: Icon, eyebrow, title, description }) => (
            <article
              key={eyebrow}
              className="flex min-h-52 flex-col rounded-3xl border border-slate-800 bg-slate-900 p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-orange-400">
                <Icon className="h-5 w-5" />
              </div>
              <span className="mt-4 font-mono text-[8px] font-black uppercase tracking-[0.16em] text-orange-400">
                {eyebrow}
              </span>
              <h2 className="mt-1 text-base font-black">{title}</h2>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">{description}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-teal-400">
              <NotebookPen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black">O Kyrub vai além da Renda</h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Notas, conexões, lojas, pedidos e outras ferramentas continuam no mesmo ecossistema. Sua conta é única entre essas experiências.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={user ? openFullApp : () => void login()}
            disabled={loginPending}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-xs font-black text-slate-200 transition hover:border-orange-500/40 hover:text-white disabled:opacity-60"
          >
            {user ? 'Explorar meu painel completo' : 'Entrar para usar recursos pessoais'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </section>

        {loginError && (
          <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {loginError}
          </p>
        )}
      </main>
    </div>
  );
}
