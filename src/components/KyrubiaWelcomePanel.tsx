import { CheckSquare2, FileText, PlugZap, ShieldCheck, Sparkles, Store } from 'lucide-react';

type KyrubiaWelcomePanelProps = {
  onSelectPrompt: (prompt: string) => void;
  onConnectAi: () => void;
};

const STARTER_PROMPTS = [
  {
    label: 'Organizar meu dia',
    prompt: 'Quero organizar meu dia. Pergunte minhas prioridades e me ajude a preparar tarefas para eu revisar antes de salvar.',
  },
  {
    label: 'Conhecer o Kyrub',
    prompt: 'Me explique as principais funções do Kyrub e por onde começar, sem alterar meus dados.',
  },
  {
    label: 'Organizar minha loja',
    prompt: 'Quero organizar minha loja no Kyrub. Me oriente sobre produtos, pedidos e vendas, pedindo confirmação antes de qualquer mudança.',
  },
] as const;

/** Informational welcome only. Never persist it as a message or send it to an AI provider. */
export function KyrubiaWelcomePanel({ onSelectPrompt, onConnectAi }: KyrubiaWelcomePanelProps) {
  return (
    <section id="kyrubia-welcome" aria-label="Conheça a Cairúbia"
      className="space-y-4 rounded-3xl border border-violet-500/20 bg-gradient-to-b from-violet-500/10 to-slate-900/80 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Sua assistente no Kyrub</p>
          <h2 className="mt-1 text-lg font-black leading-tight text-white">Olá! Eu sou a Cairúbia.</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Sou a inteligência do ecossistema Kyrub. Estou aqui para facilitar sua rotina e ajudar você a aproveitar o aplicativo.
          </p>
        </div>
      </div>

      <div className="space-y-2 text-xs leading-relaxed text-slate-300">
        <p className="font-bold text-white">O que posso fazer por você?</p>
        <p className="flex items-start gap-2">
          <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
          <span>Organizar o dia e preparar tarefas e lembretes para você revisar antes de salvar.</span>
        </p>
        <p className="flex items-start gap-2">
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
          <span>Explicar recursos do Kyrub e orientar sobre sua loja, produtos, pedidos e Praça.</span>
        </p>
        <p className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
          <span>Ajudar a planejar ações e analisar imagens ou PDFs enviados no chat. Mudanças importantes dependem de confirmação.</span>
        </p>
      </div>

      <div className="space-y-2 rounded-2xl border border-slate-700/70 bg-slate-950/55 p-3">
        <p className="flex items-center gap-2 text-xs font-black text-white">
          <PlugZap className="h-4 w-4 text-teal-300" aria-hidden="true" />
          Quer usar sua IA preferida?
        </p>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Você pode conectar uma IA compatível de sua escolha para respostas e recursos mais avançados.
          Pesquisa na internet e criação de imagens dependem do serviço e das funções disponíveis.
          Alguns provedores exigem uma chave de API e podem cobrar à parte.
        </p>
        <button type="button" onClick={onConnectAi}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs font-black text-teal-200 hover:bg-teal-500/15">
          <PlugZap className="h-4 w-4" aria-hidden="true" /> Conectar minha IA
        </button>
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Você decide o que fazer. Sugestões não executam ações automaticamente.
        </p>
        <div className="flex flex-wrap gap-2" aria-label="Sugestões para começar">
          {STARTER_PROMPTS.map(item => (
            <button key={item.label} type="button" onClick={() => onSelectPrompt(item.prompt)}
              className="rounded-full border border-violet-500/25 bg-slate-950 px-3 py-2 text-[11px] font-semibold text-violet-200 hover:border-violet-400/50">
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
