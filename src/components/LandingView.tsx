import {
  ArrowLeft,
  ArrowRight,
  Bike,
  BriefcaseBusiness,
  LogIn,
  NotebookPen,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { loadStorefrontOriginContext } from '../utils/storefrontOriginContext';

interface LandingViewProps {
  showLoginModal: boolean;
  setShowLoginModal: (val: boolean) => void;
  handleLogin: (provider: 'google' | 'apple') => void;
  setCurrentPath: (path: string) => void;
}

const rendaCards = [
  {
    icon: Bike,
    title: 'Fazer entregas',
    description:
      'Conheça oportunidades locais de entrega e use seu tempo disponível para gerar renda.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Fazer freelas',
    description:
      'Encontre trabalhos, serviços e demandas de pessoas ou negócios próximos.',
  },
  {
    icon: ShoppingBag,
    title: 'Ativar minha loja',
    description:
      'Transforme uma atividade, produto ou serviço em uma vitrine dentro do Kyrub.',
  },
];

const ecosystemCards = [
  {
    icon: NotebookPen,
    title: 'Notas e tarefas',
    description: 'Organize ideias, lembretes e atividades pessoais ou compartilhadas.',
  },
  {
    icon: Users,
    title: 'Pessoas e conexões',
    description: 'Descubra pessoas, converse e construa sua rede dentro do ecossistema.',
  },
  {
    icon: Store,
    title: 'Lojas e ofertas',
    description: 'Conheça vitrines, produtos e serviços publicados no Kyrub.',
  },
];

export function LandingView(props: LandingViewProps) {
  const origin = loadStorefrontOriginContext();

  const requestLogin = (): void => {
    props.setShowLoginModal(false);
    props.handleLogin('google');
  };

  const handleStaffAccess = (): void => {
    window.history.pushState({}, '', '/staff');
    props.setCurrentPath('/staff');
  };

  return (
    <div
      id="landing-page"
      className="min-h-[100dvh] bg-slate-950 text-white"
      data-kyrub-guest-entry="renda"
    >
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
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

          <button
            type="button"
            onClick={requestLogin}
            className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-[10px] font-black uppercase text-slate-950"
            id="guest-renda-google-login"
          >
            <LogIn className="h-4 w-4" />
            Entrar
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 pb-16 pt-4 sm:px-6">
        {origin && (
          <a
            href={origin.path}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/[0.09] px-4 text-orange-200"
            id="guest-return-to-origin-store"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <strong className="block truncate text-xs font-black">
                  Voltar para {origin.storeName}
                </strong>
                <span className="block text-[9px] text-orange-200/65">
                  Retome a vitrine e o carrinho de onde parou
                </span>
              </span>
            </span>
            <Store className="h-4 w-4 shrink-0" />
          </a>
        )}

        <section className="overflow-hidden rounded-[2rem] border border-orange-500/20 bg-gradient-to-br from-orange-500/[0.12] via-slate-900 to-slate-950 p-6 sm:p-9">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10 text-orange-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-5 font-mono text-[9px] font-black uppercase tracking-[0.2em] text-orange-400">
            Renda é a sua porta de entrada
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-black leading-tight tracking-tight sm:text-5xl">
            Descubra o que você pode fazer, prestar ou vender no Kyrub.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base sm:leading-7">
            Você pode conhecer o ecossistema sem login. Quando decidir salvar uma informação, assumir uma oportunidade, ativar sua loja ou concluir uma compra, o Kyrub pede sua autenticação e continua a ação com a mesma conta.
          </p>
        </section>

        <section aria-labelledby="guest-renda-title">
          <div className="mb-3 flex items-end justify-between gap-3 px-1">
            <div>
              <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-orange-400">
                Oportunidades
              </span>
              <h2 id="guest-renda-title" className="mt-1 text-lg font-black">
                Por onde você quer começar?
              </h2>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {rendaCards.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="flex min-h-56 flex-col rounded-3xl border border-slate-800 bg-slate-900 p-5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-orange-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-black">{title}</h3>
                <p className="mt-2 flex-1 text-[11px] leading-5 text-slate-500">
                  {description}
                </p>
                <button
                  type="button"
                  onClick={requestLogin}
                  className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[10px] font-black uppercase text-slate-300 transition hover:border-orange-500/40 hover:text-white"
                >
                  Quero começar
                  <ArrowRight className="h-4 w-4" />
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
          <div className="max-w-3xl">
            <span className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-teal-400">
              Explore sem compromisso
            </span>
            <h2 className="mt-1 text-lg font-black">O Kyrub é maior que a área de Renda</h2>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              A mesma identidade acompanha você entre ferramentas pessoais, relações sociais, vitrines e atividades comerciais. Navegar e conhecer não exige cadastro antecipado.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {ecosystemCards.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
              >
                <Icon className="h-5 w-5 text-teal-400" />
                <h3 className="mt-3 text-sm font-black">{title}</h3>
                <p className="mt-1 text-[10px] leading-5 text-slate-500">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-center">
          <p className="text-xs leading-5 text-slate-400">
            Quando você entrar com Google, essa mesma conta será usada tanto no Kyrub quanto para identificar suas compras nas vitrines.
          </p>
          <button
            type="button"
            onClick={requestLogin}
            className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-xs font-black text-slate-950"
          >
            <LogIn className="h-4 w-4" />
            Entrar com Google
          </button>
        </section>

        <button
          type="button"
          onClick={handleStaffAccess}
          className="mx-auto block text-[9px] font-bold uppercase tracking-wider text-slate-700 transition-colors hover:text-slate-500"
        >
          Acesso operacional
        </button>
      </main>
    </div>
  );
}
