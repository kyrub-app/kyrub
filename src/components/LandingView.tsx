import React from 'react';
import {
  Apple,
  ArrowRight,
  Bike,
  BriefcaseBusiness,
  CheckCircle2,
  HeartHandshake,
  LockKeyhole,
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
} from 'lucide-react';

interface LandingViewProps {
  showLoginModal: boolean;
  setShowLoginModal: (val: boolean) => void;
  handleLogin: (provider: 'google' | 'apple') => void;
  setCurrentPath: (path: string) => void;
}

interface KyrubLogoProps {
  className?: string;
  decorative?: boolean;
}

function KyrubLogo({ className = '', decorative = false }: KyrubLogoProps) {
  return (
    <svg
      viewBox="0 0 500 500"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : 'Logo Kyrub'}
      className={className}
    >
      <defs>
        <linearGradient id="kyrub-orange" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb347" />
          <stop offset="0.34" stopColor="#ff8a00" />
          <stop offset="0.72" stopColor="#ff6a00" />
          <stop offset="1" stopColor="#d94800" />
        </linearGradient>
        <linearGradient id="kyrub-highlight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2bd" stopOpacity="0.9" />
          <stop offset="0.18" stopColor="#ffd27a" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#ff7a00" stopOpacity="0" />
          <stop offset="1" stopColor="#7c1d00" stopOpacity="0.45" />
        </linearGradient>
        <filter id="kyrub-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0.9  0 0.35 0 0 0.2  0 0 0.05 0 0  0 0 0 0.9 0"
            result="orangeBlur"
          />
          <feMerge>
            <feMergeNode in="orangeBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="kyrub-depth" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="5" floodColor="#521600" floodOpacity="0.8" />
        </filter>
      </defs>

      <g filter="url(#kyrub-glow)">
        <path
          d="M98 165H75V425H322V390"
          fill="none"
          stroke="url(#kyrub-orange)"
          strokeWidth="46"
          strokeLinecap="square"
          strokeLinejoin="miter"
          filter="url(#kyrub-depth)"
        />
        <path
          d="M174 320V74H426V320H337V164H174V320H294V207H216"
          fill="none"
          stroke="url(#kyrub-orange)"
          strokeWidth="46"
          strokeLinecap="square"
          strokeLinejoin="miter"
          filter="url(#kyrub-depth)"
        />
        <rect
          x="228"
          y="218"
          width="46"
          height="46"
          rx="2"
          fill="url(#kyrub-orange)"
          filter="url(#kyrub-depth)"
        />
      </g>

      <g opacity="0.45" pointerEvents="none">
        <path
          d="M98 165H75V425H322V390"
          fill="none"
          stroke="url(#kyrub-highlight)"
          strokeWidth="7"
          strokeLinecap="square"
          strokeLinejoin="miter"
          transform="translate(-8 -8)"
        />
        <path
          d="M174 320V74H426V320H337V164H174V320H294V207H216"
          fill="none"
          stroke="url(#kyrub-highlight)"
          strokeWidth="7"
          strokeLinecap="square"
          strokeLinejoin="miter"
          transform="translate(-8 -8)"
        />
        <rect x="224" y="214" width="42" height="8" fill="#fff2bd" opacity="0.55" />
      </g>
    </svg>
  );
}

const featureCards = [
  {
    icon: Store,
    title: 'Criar e gerenciar sua loja',
    description: 'Configure sua vitrine, organize o atendimento e acompanhe a operação do seu negócio.',
  },
  {
    icon: ShoppingBag,
    title: 'Explorar lojas e ofertas',
    description: 'Descubra negócios, produtos e serviços publicados por pessoas da comunidade Kyrub.',
  },
  {
    icon: Star,
    title: 'Vender produtos e serviços',
    description: 'Apresente suas ofertas, alcance novos clientes e desenvolva novas oportunidades de venda.',
  },
  {
    icon: Users,
    title: 'Conversar e se conectar',
    description: 'Encontre usuários reais, envie solicitações e construa uma rede de contatos dentro do app.',
  },
  {
    icon: MessageCircleMore,
    title: 'Usar o chat social',
    description: 'Converse com suas conexões em um espaço integrado à experiência social do Kyrub.',
  },
  {
    icon: NotebookPen,
    title: 'Organizar notas e tarefas',
    description: 'Crie notas, checklists, lembretes e compartilhe atividades com pessoas conectadas.',
  },
  {
    icon: PackageCheck,
    title: 'Acompanhar pedidos',
    description: 'Organize o fluxo de vendas e acompanhe cada etapa do atendimento e da produção.',
  },
  {
    icon: Bike,
    title: 'Encontrar entregas',
    description: 'Solicite entregas locais ou encontre oportunidades para realizar fretes e gerar renda.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Contratar ou fazer freelas',
    description: 'Publique demandas profissionais ou encontre trabalhos e serviços na sua região.',
  },
  {
    icon: WalletCards,
    title: 'Acessar sua carteira',
    description: 'Visualize saldo e movimentações em uma área financeira integrada à sua conta.',
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

export function LandingView({
  handleLogin,
  setCurrentPath,
}: LandingViewProps) {
  const currentYear = new Date().getFullYear();

  const handleStaffAccess = () => {
    window.history.pushState({}, '', '/staff');
    setCurrentPath('/staff');
  };

  return (
    <div
      id="landing-page"
      className="relative min-h-screen overflow-hidden bg-[#050505] text-white"
    >
      <style>{`
        @keyframes kyrub-logo-float {
          0%, 100% { transform: perspective(900px) rotateY(-7deg) rotateX(2deg) translateY(0); }
          50% { transform: perspective(900px) rotateY(7deg) rotateX(-2deg) translateY(-10px); }
        }

        @keyframes kyrub-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes kyrub-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.94); }
          50% { opacity: 0.72; transform: scale(1.04); }
        }

        .kyrub-logo-float {
          animation: kyrub-logo-float 7s ease-in-out infinite;
          transform-origin: center;
          will-change: transform;
        }

        .kyrub-orbit {
          animation: kyrub-orbit 14s linear infinite;
        }

        .kyrub-pulse {
          animation: kyrub-pulse 4s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .kyrub-logo-float,
          .kyrub-orbit,
          .kyrub-pulse {
            animation: none;
          }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-orange-500/10 blur-[120px]" />
        <div className="absolute right-[-14rem] top-[22rem] h-[34rem] w-[34rem] rounded-full bg-teal-500/5 blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <a href="#landing-page" className="flex items-center gap-3" aria-label="Kyrub — início">
          <KyrubLogo decorative className="h-9 w-9 overflow-visible" />
          <span className="text-xl font-black tracking-tight">Kyrub</span>
        </a>

        <a
          href="#em-kyrub-voce-pode"
          className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-orange-500/40 hover:text-white"
        >
          Sobre o Kyrub
        </a>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:pb-28 lg:pt-14">
          <div className="order-2 max-w-xl space-y-8 lg:order-1">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/[0.07] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sua rede, sua loja, suas oportunidades
              </div>

              <h1 className="text-5xl font-black tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
                Entrar
              </h1>

              <p className="max-w-lg text-base leading-7 text-slate-400 sm:text-lg">
                Acesse sua conta e entre em um espaço de conexões, organização, negócios e novas formas de gerar renda.
              </p>
            </div>

            <div className="max-w-md space-y-3">
              <button
                type="button"
                onClick={() => handleLogin('google')}
                className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-black text-slate-950 shadow-[0_18px_60px_rgba(255,255,255,0.08)] transition-all hover:-translate-y-0.5 hover:bg-slate-100"
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

              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Login com Apple em breve"
                className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-4 text-sm font-black text-slate-300 opacity-75"
              >
                <Apple className="h-5 w-5" />
                <span>Entrar com Apple</span>
                <span className="rounded-full border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-orange-300">
                  Em breve
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <LockKeyhole className="h-4 w-4 text-orange-400" />
              <span>Login seguro com sua conta. Sem dados comerciais pré-preenchidos.</span>
            </div>
          </div>

          <div className="order-1 flex items-center justify-center lg:order-2">
            <div className="relative flex aspect-square w-full max-w-[520px] items-center justify-center">
              <div className="kyrub-pulse absolute inset-[12%] rounded-full bg-orange-500/20 blur-[70px]" />
              <div className="kyrub-orbit absolute inset-[11%] rounded-full border border-orange-500/20 border-r-orange-300/80" />
              <div className="absolute inset-[18%] rounded-full border border-orange-500/10 shadow-[0_0_80px_rgba(249,115,22,0.12)]" />
              <div className="absolute bottom-[11%] h-10 w-[66%] rounded-[50%] bg-orange-500/20 blur-2xl" />
              <KyrubLogo className="kyrub-logo-float relative z-10 h-[82%] w-[82%] overflow-visible drop-shadow-[0_0_24px_rgba(249,115,22,0.44)]" />
            </div>
          </div>
        </section>

        <section
          id="em-kyrub-voce-pode"
          className="border-y border-white/[0.06] bg-white/[0.018]"
        >
          <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-orange-400">
                Tudo em um só lugar
              </p>
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
                Em <span className="text-orange-500">Kyrub</span> você pode
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                Organize sua rotina, conecte-se com pessoas e desenvolva atividades comerciais e profissionais dentro do mesmo ecossistema.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {featureCards.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="group rounded-3xl border border-white/[0.075] bg-[#0b0b0c] p-5 transition-all hover:-translate-y-1 hover:border-orange-500/30 hover:bg-[#101011]"
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-400 shadow-[inset_0_0_20px_rgba(249,115,22,0.04)] transition-transform group-hover:scale-105">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="min-h-[48px] text-sm font-black leading-5 text-white">
                    {title}
                  </h3>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-24">
          <div className="overflow-hidden rounded-[2rem] border border-orange-500/20 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.14),transparent_38%),#0a0a0b] p-7 sm:p-10 lg:p-12">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-400">
                  Um app, muitas possibilidades
                </p>
                <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  Tudo o que você precisa para organizar, conectar e crescer.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
                  O Kyrub reúne ferramentas pessoais, sociais e comerciais para tornar sua rotina mais simples e abrir espaço para novas oportunidades.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {trustItems.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="flex gap-4 rounded-2xl border border-white/[0.06] bg-black/25 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 text-xs text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <KyrubLogo decorative className="h-7 w-7 overflow-visible" />
            <span className="font-black text-slate-300">Kyrub</span>
          </div>

          <p>© {currentYear} Kyrub. Todos os direitos reservados.</p>

          <button
            type="button"
            onClick={handleStaffAccess}
            className="text-left transition-colors hover:text-orange-400 md:text-right"
          >
            Acesso operacional
          </button>
        </div>
      </footer>
    </div>
  );
}
