import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bike,
  BriefcaseBusiness,
  HeartHandshake,
  MessageCircleMore,
  NotebookPen,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Users,
  WalletCards,
  X,
} from 'lucide-react';

interface LandingViewProps {
  showLoginModal: boolean;
  setShowLoginModal: (val: boolean) => void;
  handleLogin: (provider: 'google' | 'apple') => void;
  setCurrentPath: (path: string) => void;
}

const featureCards = [
  {
    icon: Store,
    title: 'Criar e gerenciar sua loja',
    description:
      'Configure sua vitrine, organize o atendimento e acompanhe a operação do seu negócio.',
  },
  {
    icon: ShoppingBag,
    title: 'Explorar lojas e ofertas',
    description:
      'Descubra negócios, produtos e serviços publicados por pessoas da comunidade Kyrub.',
  },
  {
    icon: Star,
    title: 'Vender produtos e serviços',
    description:
      'Apresente suas ofertas, alcance novos clientes e desenvolva novas oportunidades de venda.',
  },
  {
    icon: Users,
    title: 'Conversar e se conectar',
    description:
      'Encontre usuários reais, envie solicitações e construa sua rede de contatos.',
  },
  {
    icon: MessageCircleMore,
    title: 'Usar o chat social',
    description:
      'Converse com suas conexões em um espaço integrado à experiência social do Kyrub.',
  },
  {
    icon: NotebookPen,
    title: 'Organizar notas e tarefas',
    description:
      'Crie notas, checklists e lembretes, além de compartilhar atividades com suas conexões.',
  },
  {
    icon: PackageCheck,
    title: 'Acompanhar pedidos',
    description:
      'Organize o fluxo de vendas e acompanhe cada etapa do atendimento e da produção.',
  },
  {
    icon: Bike,
    title: 'Encontrar entregas',
    description:
      'Solicite entregas locais ou encontre oportunidades para realizar fretes e gerar renda.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Contratar ou fazer freelas',
    description:
      'Publique demandas profissionais ou encontre trabalhos e serviços na sua região.',
  },
  {
    icon: WalletCards,
    title: 'Acessar sua carteira',
    description:
      'Visualize saldo e movimentações em uma área financeira integrada à sua conta.',
  },
];

const trustItems = [
  {
    icon: ShieldCheck,
    title: 'Seguro e confiável',
    description: 'Sua conta e seus dados protegidos.',
  },
  {
    icon: HeartHandshake,
    title: 'Feito para pessoas',
    description: 'Uma experiência simples e inclusiva.',
  },
  {
    icon: Users,
    title: 'Comunidade conectada',
    description: 'Relacionamentos, negócios e colaboração.',
  },
  {
    icon: Sparkles,
    title: 'Oportunidades reais',
    description: 'Comércio, serviços e novas fontes de renda.',
  },
];

function KyrubBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <img
        src="/kyrub-logo.svg"
        alt=""
        aria-hidden="true"
        className={`${compact ? 'h-9 w-9' : 'h-11 w-11'} rounded-xl object-cover`}
      />
      <span className={`${compact ? 'text-lg' : 'text-xl'} font-black tracking-tight text-white`}>
        Kyrub
      </span>
    </span>
  );
}

export function LandingView(props: LandingViewProps) {
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const currentYear = new Date().getFullYear();

  const closeAbout = () => setIsAboutOpen(false);

  useEffect(() => {
    if (!isAboutOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAbout();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isAboutOpen]);

  const handleStaffAccess = () => {
    window.history.pushState({}, '', '/staff');
    props.setCurrentPath('/staff');
  };

  return (
    <div
      id="landing-page"
      className="relative min-h-[100dvh] overflow-hidden bg-[#050505] text-white"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-22rem] h-[44rem] w-[44rem] -translate-x-1/2 rounded-full bg-orange-500/10 blur-[140px]" />
        <div className="absolute bottom-[-18rem] right-[-14rem] h-[36rem] w-[36rem] rounded-full bg-orange-500/[0.045] blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.016)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.016)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6 lg:px-10">
        <a
          href="#landing-page"
          aria-label="Kyrub — início"
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <KyrubBrand compact />
        </a>

        <button
          type="button"
          onClick={() => setIsAboutOpen(true)}
          aria-haspopup="dialog"
          className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2.5 text-xs font-bold text-slate-300 transition-colors hover:border-orange-500/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          Sobre Kyrub
        </button>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl items-center px-5 pb-12 pt-4 sm:px-8 sm:pb-16 sm:pt-8 lg:min-h-[calc(100dvh-92px)] lg:px-10 lg:pb-20 lg:pt-6">
        <section
          aria-labelledby="landing-hero-title"
          className="w-full overflow-hidden rounded-[2rem] border border-orange-500/20 bg-black/45 px-6 py-10 shadow-[0_30px_100px_rgba(0,0,0,0.38)] backdrop-blur-sm sm:rounded-[2.75rem] sm:px-12 sm:py-14 lg:px-16 lg:py-16"
        >
          <div className="max-w-5xl">
            <p className="text-sm font-black uppercase tracking-[0.3em] text-orange-500 sm:text-base lg:text-lg">
              Um app, muitas possibilidades
            </p>

            <h1
              id="landing-hero-title"
              className="mt-7 max-w-5xl text-[clamp(2.6rem,7vw,5.5rem)] font-black leading-[1.04] tracking-[-0.045em] text-white"
            >
              Tudo o que você precisa para organizar, conectar e crescer.
            </h1>

            <p className="mt-8 max-w-4xl text-base leading-7 text-slate-400 sm:text-xl sm:leading-8 lg:text-2xl lg:leading-9">
              O Kyrub reúne ferramentas pessoais, sociais e comerciais para tornar sua rotina mais simples e abrir espaço para novas oportunidades.
            </p>

            <button
              type="button"
              onClick={() => props.handleLogin('google')}
              className="group mt-10 flex w-full max-w-md items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-black text-slate-950 shadow-[0_18px_60px_rgba(255,255,255,0.09)] transition-all hover:-translate-y-0.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:text-base"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v4.2h5.9c-.3 1.4-1.7 4.1-5.9 4.1A6.5 6.5 0 0 1 12 5.5c2.4 0 4 1 4.9 1.9l3.3-3.2A11 11 0 1 0 23 12c0-.7-.1-1.2-.2-1.8H12Z" />
                <path fill="#4285F4" d="M23 12c0-.7-.1-1.2-.2-1.8H12v4.2h5.9c-.4 1.8-1.5 3-3 3.8l3.6 2.8C21.3 18.4 23 15.4 23 12Z" />
                <path fill="#FBBC05" d="M5.6 14.3A6.5 6.5 0 0 1 5.6 9.7L2 6.9a11 11 0 0 0 0 10.2l3.6-2.8Z" />
                <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1a6.4 6.4 0 0 1-6.1-4.4L2.3 17A11 11 0 0 0 12 23Z" />
              </svg>
              <span>Entrar com Google</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </section>
      </main>

      {isAboutOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md sm:p-6"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeAbout();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-kyrub-title"
            className="my-auto flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-orange-500/20 bg-[#080809] shadow-2xl sm:max-h-[calc(100dvh-48px)]"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-7">
              <KyrubBrand compact />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeAbout}
                aria-label="Fechar Sobre Kyrub"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-7 sm:px-7 sm:py-9 lg:px-10">
              <div className="max-w-3xl">
                <p className="text-xs font-black uppercase tracking-[0.26em] text-orange-500">
                  Um ecossistema para a vida real
                </p>
                <h2
                  id="about-kyrub-title"
                  className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl"
                >
                  Organize sua rotina, conecte-se e desenvolva oportunidades.
                </h2>
                <p className="mt-5 text-sm leading-7 text-slate-400 sm:text-base">
                  O Kyrub reúne ferramentas pessoais, sociais e comerciais no mesmo lugar. O modo manual permanece sempre disponível, enquanto a Kyrubia ajuda a transformar ideias e pedidos em próximos passos claros.
                </p>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featureCards.map(({ icon: Icon, title, description }) => (
                  <article
                    key={title}
                    className="rounded-3xl border border-white/[0.075] bg-black/35 p-5"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-sm font-black leading-5 text-white">
                      {title}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {description}
                    </p>
                  </article>
                ))}
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {trustItems.map(({ icon: Icon, title, description }) => (
                  <div
                    key={title}
                    className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-col gap-4 border-t border-white/[0.07] pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <p>© {currentYear} Kyrub. Todos os direitos reservados.</p>
                <button
                  type="button"
                  onClick={handleStaffAccess}
                  className="text-left font-bold transition-colors hover:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                >
                  Acesso operacional
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
