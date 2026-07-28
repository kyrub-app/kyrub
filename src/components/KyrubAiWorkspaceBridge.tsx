import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Bot,
  Brain,
  BriefcaseBusiness,
  Dumbbell,
  History,
  ImagePlus,
  PackagePlus,
  Plus,
  Sparkles,
  Store,
} from 'lucide-react';

type WorkspaceCard = {
  id: string;
  title: string;
  description: string;
  icon: typeof Bot;
  status: string;
};

const WORKSPACE_CARDS: WorkspaceCard[] = [
  {
    id: 'store',
    title: 'Criar minha loja',
    description: 'Perfil comercial, ambientes, publicação e primeiros passos.',
    icon: Store,
    status: 'Estrutura preparada',
  },
  {
    id: 'products',
    title: 'Cadastrar produtos',
    description: 'Descrição, preço, imagens, ficha técnica e estoque.',
    icon: PackagePlus,
    status: 'Aguardando agente',
  },
  {
    id: 'content',
    title: 'Conteúdo e imagens',
    description: 'Publicações, legendas e materiais visuais para o feed.',
    icon: ImagePlus,
    status: 'Aguardando agente',
  },
  {
    id: 'work',
    title: 'Trabalho e organização',
    description: 'Tarefas, planejamento, documentos e acompanhamento de projetos.',
    icon: BriefcaseBusiness,
    status: 'Aguardando agente',
  },
  {
    id: 'training',
    title: 'Treino e hábitos',
    description: 'Rotinas pessoais e acompanhamento de metas de atividade.',
    icon: Dumbbell,
    status: 'Aguardando agente',
  },
  {
    id: 'study',
    title: 'Estudos e história',
    description: 'Assuntos de estudo organizados em conversas independentes.',
    icon: History,
    status: 'Aguardando agente',
  },
  {
    id: 'wellbeing',
    title: 'Bem-estar',
    description: 'Reflexão e organização emocional, sem substituir atendimento profissional.',
    icon: Brain,
    status: 'Aguardando agente',
  },
  {
    id: 'learning',
    title: 'Novo assunto',
    description: 'Espaço para iniciar qualquer outro projeto com a Kyrub I.A.',
    icon: BookOpen,
    status: 'Em preparação',
  },
];

export function KyrubAiWorkspaceBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [selectedCard, setSelectedCard] = useState<WorkspaceCard | null>(null);

  useEffect(() => {
    let currentContainer: HTMLElement | null = null;
    let currentHost: HTMLDivElement | null = null;

    const sync = () => {
      document.querySelectorAll('nav button').forEach(button => {
        const label = button.querySelector('span');
        if (label?.textContent?.trim() === 'Kyrub') {
          label.textContent = 'Kyrub I.A';
          button.setAttribute('aria-label', 'Abrir Kyrub I.A');
        }
      });

      const container = document.getElementById('kyrub-tab-container');
      if (container === currentContainer && currentHost?.isConnected) return;

      if (currentContainer) currentContainer.style.display = '';
      currentHost?.remove();
      currentContainer = container;
      currentHost = null;
      setHost(null);

      if (!container || !container.parentElement) return;
      container.style.display = 'none';
      const nextHost = document.createElement('div');
      nextHost.id = 'kyrub-ai-workspace-host';
      container.parentElement.insertBefore(nextHost, container);
      currentHost = nextHost;
      setHost(nextHost);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(sync, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      if (currentContainer) currentContainer.style.display = '';
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  const activeCards = useMemo(() => WORKSPACE_CARDS, []);
  if (!host) return null;

  return createPortal(
    <div className="space-y-5 animate-fade-in" id="kyrub-ai-workspace">
      <section className="overflow-hidden rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-950/80 via-slate-900 to-slate-950 p-5 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/15 text-violet-300">
            <Bot className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">
              Guia principal do aplicativo
            </span>
            <h2 className="mt-1 text-xl font-black text-white">Kyrub I.A</h2>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Este será o painel central dos assuntos, tarefas e projetos conduzidos com o agente do Kyrub. A organização por cards já está pronta; a execução inteligente será conectada em uma fase própria e segura.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-slate-950/60 p-3 text-[9px] leading-relaxed text-slate-400">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-300" />
          Cada card manterá seu próprio histórico, objetivo, arquivos, decisões e próximos passos.
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3" aria-label="Assuntos da Kyrub I.A">
        {activeCards.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setSelectedCard(card)}
              className="group min-h-44 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left transition-all hover:border-violet-500/40 hover:bg-slate-900/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-violet-300 group-hover:border-violet-500/30">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-[11px] font-black uppercase leading-tight text-white">{card.title}</h3>
              <p className="mt-2 line-clamp-3 text-[9px] leading-relaxed text-slate-500">{card.description}</p>
              <span className="mt-3 block font-mono text-[8px] uppercase text-violet-300">{card.status}</span>
            </button>
          );
        })}
      </section>

      <button
        type="button"
        onClick={() => setSelectedCard(WORKSPACE_CARDS[WORKSPACE_CARDS.length - 1] ?? null)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-500/35 bg-violet-500/5 py-4 text-[10px] font-black uppercase text-violet-300"
      >
        <Plus className="h-4 w-4" />
        Novo assunto com a Kyrub I.A
      </button>

      {selectedCard && (
        <div className="fixed inset-0 z-[125] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                <selectedCard.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[8px] font-black uppercase text-violet-300">Kyrub I.A · Estrutura inicial</span>
                <h3 className="mt-1 text-base font-black text-white">{selectedCard.title}</h3>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{selectedCard.description}</p>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-[10px] leading-relaxed text-amber-200">
              O card está preparado para receber o agente, mas ainda não executa ações nem cria conteúdo automaticamente. Isso evita simular uma capacidade que ainda não foi conectada.
            </div>
            <button type="button" onClick={() => setSelectedCard(null)} className="mt-4 w-full rounded-xl bg-violet-500 py-3 text-[9px] font-black uppercase text-white">
              Voltar ao painel
            </button>
          </section>
        </div>
      )}
    </div>,
    host
  );
}
