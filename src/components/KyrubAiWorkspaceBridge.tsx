import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Brain,
  BriefcaseBusiness,
  Dumbbell,
  History,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  PackagePlus,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { KyrubiaOfferedIntent } from '../../shared/kyrubiaContext';
import { auth } from '../utils/firebase';
import { requestKyrubAiConsultant } from '../ai/consultantClient';
import {
  deleteKyrubiaAttachments,
  uploadKyrubiaAttachments,
} from '../ai/kyrubiaAttachmentService';
import { requestKyrubAiMultimodalConsultant } from '../ai/multimodalConsultantClient';
import {
  createKyrubAiConversation,
  createKyrubAiMessage,
  loadKyrubAiConversations,
  saveKyrubAiConversations,
  titleFromFirstRequest,
  type KyrubAiLocalConversation,
} from '../ai/conversationStore';
import {
  KyrubAiAttachmentPicker,
  KyrubAiAttachmentSummary,
} from './KyrubAiAttachmentPicker';

const MAX_VISIBLE_RECENT_CONVERSATIONS = 6;

type WorkspaceTemplate = {
  id: string;
  title: string;
  description: string;
  starterPrompt: string;
  icon: typeof Bot;
};

const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'store',
    title: 'Ativar minha loja',
    description: 'Organize perfil comercial, proposta, ambientes e primeiros passos.',
    starterPrompt: 'Quero ativar minha loja no Kyrub. Me ajude a organizar as informações necessárias.',
    icon: Store,
  },
  {
    id: 'products',
    title: 'Cadastrar produtos',
    description: 'Prepare descrição, preço, ficha técnica, imagens e estoque.',
    starterPrompt: 'Quero cadastrar um produto. Me ajude a levantar todos os dados necessários.',
    icon: PackagePlus,
  },
  {
    id: 'content',
    title: 'Conteúdo e imagens',
    description: 'Planeje publicações, legendas e materiais para o feed.',
    starterPrompt: 'Quero criar conteúdo para uma publicação no Kyrub. Me ajude a montar a ideia.',
    icon: ImagePlus,
  },
  {
    id: 'work',
    title: 'Trabalho e organização',
    description: 'Organize tarefas, notas, documentos e projetos.',
    starterPrompt: 'Preciso organizar meu trabalho e minhas tarefas. Por onde começamos?',
    icon: BriefcaseBusiness,
  },
  {
    id: 'training',
    title: 'Treino e hábitos',
    description: 'Converse sobre rotinas, objetivos e acompanhamento de hábitos.',
    starterPrompt: 'Quero organizar uma rotina de treino e hábitos adequada aos meus objetivos.',
    icon: Dumbbell,
  },
  {
    id: 'study',
    title: 'Estudos e história',
    description: 'Crie um caminho de estudo e mantenha assuntos separados.',
    starterPrompt: 'Quero estudar um assunto novo. Me ajude a criar um plano simples.',
    icon: History,
  },
  {
    id: 'wellbeing',
    title: 'Bem-estar',
    description: 'Reflexão e organização emocional, sem substituir profissionais.',
    starterPrompt: 'Quero organizar melhor meus pensamentos e minha rotina de bem-estar.',
    icon: Brain,
  },
  {
    id: 'general',
    title: 'Novo assunto',
    description: 'Inicie qualquer outra solicitação com o Consultor Kyrub.',
    starterPrompt: '',
    icon: BookOpen,
  },
];

const relativeConversationDate = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const difference = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
};

const attachmentOnlyPrompt = (names: string[]): string => {
  if (names.length === 1) return `Analise o anexo “${names[0]}”.`;
  return `Analise estes ${names.length} anexos e considere-os juntos na resposta.`;
};

export function KyrubAiWorkspaceBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [hydratedUid, setHydratedUid] = useState('');
  const [conversations, setConversations] = useState<KyrubAiLocalConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [failedConversationId, setFailedConversationId] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const busy = sending || uploadingAttachments;

  useEffect(() => onAuthStateChanged(auth, setUser), []);

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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const interval = window.setInterval(sync, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      if (currentContainer) currentContainer.style.display = '';
      currentHost?.remove();
      setHost(null);
    };
  }, []);

  useEffect(() => {
    abortControllerRef.current?.abort();
    setSending(false);
    setUploadingAttachments(false);
    setPendingAttachmentFiles([]);
    setErrorMessage('');
    setFailedConversationId('');
    setActiveConversationId('');

    if (!user) {
      setConversations([]);
      setHydratedUid('');
      return;
    }

    setConversations(loadKyrubAiConversations(localStorage, user.uid));
    setHydratedUid(user.uid);
  }, [user?.uid]);

  useEffect(() => {
    if (!user || hydratedUid !== user.uid) return;
    saveKyrubAiConversations(localStorage, user.uid, conversations);
  }, [conversations, hydratedUid, user]);

  const activeConversation = useMemo(
    () => conversations.find(item => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations]
  );

  const recentConversations = useMemo(
    () => conversations.slice(0, MAX_VISIBLE_RECENT_CONVERSATIONS),
    [conversations]
  );

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeConversation?.messages.length, sending, uploadingAttachments]);

  const updateConversation = (
    conversationId: string,
    updater: (conversation: KyrubAiLocalConversation) => KyrubAiLocalConversation
  ) => {
    setConversations(current =>
      current
        .map(conversation =>
          conversation.id === conversationId
            ? updater(conversation)
            : conversation
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    );
  };

  const requestReply = async (
    conversation: KyrubAiLocalConversation,
    messages = conversation.messages,
    selectedOfferedIntentId?: string
  ) => {
    if (sending) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSending(true);
    setErrorMessage('');
    setFailedConversationId('');

    try {
      const request = {
        conversationId: conversation.id,
        topic: conversation.topic,
        messages,
        turnContext: conversation.lastTurnContext,
        ...(selectedOfferedIntentId ? { selectedOfferedIntentId } : {}),
      };
      const hasMultimodalHistory = messages.some(
        message => message.role === 'user' && (message.attachments?.length ?? 0) > 0
      );
      const result = hasMultimodalHistory
        ? await requestKyrubAiMultimodalConsultant(request, controller.signal)
        : await requestKyrubAiConsultant(request, controller.signal);
      const assistantMessage = createKyrubAiMessage('assistant', result.reply);
      updateConversation(conversation.id, current => ({
        ...current,
        updatedAt: new Date().toISOString(),
        messages: [...current.messages, assistantMessage],
        lastTurnContext: result.turnContext,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error
        ? error.message
        : 'O Consultor Kyrub está temporariamente indisponível.';
      setErrorMessage(message);
      setFailedConversationId(conversation.id);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setSending(false);
      }
    }
  };

  const startConversation = (template?: WorkspaceTemplate) => {
    const conversation = createKyrubAiConversation(
      template?.title ?? 'Nova solicitação',
      template?.title ?? 'Nova solicitação'
    );
    setConversations(current => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft(template?.starterPrompt ?? '');
    setPendingAttachmentFiles([]);
    setErrorMessage('');
    setFailedConversationId('');
  };

  const submitContent = async (
    content: string,
    selectedOfferedIntentId?: string
  ) => {
    const cleanContent = content.trim();
    if ((!cleanContent && pendingAttachmentFiles.length === 0) || busy) return;
    if (!user) {
      setErrorMessage('Faça login para conversar com o Consultor Kyrub.');
      return;
    }

    let conversation = activeConversation;
    if (!conversation) {
      conversation = createKyrubAiConversation('Nova solicitação');
    }

    let attachments = [] as Awaited<ReturnType<typeof uploadKyrubiaAttachments>>;
    if (pendingAttachmentFiles.length > 0) {
      setUploadingAttachments(true);
      setErrorMessage('');
      try {
        attachments = await uploadKyrubiaAttachments(
          user,
          conversation.id,
          pendingAttachmentFiles
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível enviar os anexos. Tente novamente.'
        );
        setUploadingAttachments(false);
        return;
      }
      setUploadingAttachments(false);
    }

    const messageContent = cleanContent || attachmentOnlyPrompt(
      attachments.map(attachment => attachment.name)
    );
    const userMessage = createKyrubAiMessage('user', messageContent, attachments);
    const firstUserMessage = !conversation.messages.some(message => message.role === 'user');
    const nextConversation: KyrubAiLocalConversation = {
      ...conversation,
      title: firstUserMessage
        ? titleFromFirstRequest(
            cleanContent ||
              (attachments.length === 1
                ? `Analisar ${attachments[0].name}`
                : `Analisar ${attachments.length} anexos`)
          )
        : conversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...conversation.messages, userMessage],
    };

    setDraft('');
    setPendingAttachmentFiles([]);
    setActiveConversationId(nextConversation.id);
    setConversations(current => {
      const withoutCurrent = current.filter(item => item.id !== nextConversation.id);
      return [nextConversation, ...withoutCurrent];
    });
    await requestReply(
      nextConversation,
      nextConversation.messages,
      selectedOfferedIntentId
    );
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    await submitContent(draft);
  };

  const chooseOfferedIntent = (offeredIntent: KyrubiaOfferedIntent) => {
    if (busy || draft.trim() || pendingAttachmentFiles.length > 0) return;
    void submitContent(offeredIntent.label, offeredIntent.id);
  };

  const retryLastRequest = () => {
    if (!activeConversation || busy) return;
    void requestReply(activeConversation, activeConversation.messages);
  };

  const deleteActiveConversation = () => {
    if (!activeConversation) return;
    abortControllerRef.current?.abort();
    const attachments = activeConversation.messages.flatMap(
      message => message.attachments ?? []
    );
    if (user && attachments.length > 0) {
      void deleteKyrubiaAttachments(user, attachments).catch(error => {
        console.warn('[Kyrubia] Could not clean up conversation attachments.', error);
      });
    }
    setConversations(current =>
      current.filter(item => item.id !== activeConversation.id)
    );
    setActiveConversationId('');
    setDraft('');
    setPendingAttachmentFiles([]);
    setErrorMessage('');
    setFailedConversationId('');
  };

  const visibleOfferedIntents = activeConversation?.messages.at(-1)?.role === 'assistant'
    ? activeConversation.lastTurnContext?.offeredIntents?.slice(0, 3) ?? []
    : [];

  if (!host) return null;

  return createPortal(
    <div className="animate-fade-in" id="kyrub-ai-workspace">
      {!activeConversation ? (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-950/90 via-slate-900 to-slate-950 p-5 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/15 text-violet-300">
                <Bot className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-black uppercase tracking-wider text-violet-300">
                  Consultor Kyrub
                </span>
                <h2 className="mt-1 text-2xl font-black text-white">
                  Em que posso ajudar hoje?
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Faça sua solicitação em linguagem natural. Nesta primeira fase, o Consultor conversa, orienta e prepara planos sem alterar dados do aplicativo.
                </p>
              </div>
            </div>

            <form onSubmit={sendMessage} className="mt-5">
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value.slice(0, 4_000))}
                placeholder="Ex.: Quero ativar minha loja de doces e preciso organizar os primeiros passos."
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-4 text-base leading-relaxed text-white outline-none placeholder:text-slate-600 focus:border-violet-500/60"
              />
              <KyrubAiAttachmentPicker
                files={pendingAttachmentFiles}
                onChange={setPendingAttachmentFiles}
                onError={setErrorMessage}
                disabled={busy || !user}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Histórico textual e referências de anexos ficam neste dispositivo; os arquivos são privados no Storage.
                </span>
                <button
                  type="submit"
                  disabled={(!draft.trim() && pendingAttachmentFiles.length === 0) || busy || !user}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Enviar
                </button>
              </div>
            </form>

            {!user && (
              <p className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Entre com sua conta para iniciar uma conversa.
              </p>
            )}
          </section>

          <section className="grid grid-cols-3 gap-2" aria-label="Capacidades atuais da Kyrub I.A">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
              <MessageSquareText className="mx-auto h-5 w-5 text-emerald-300" />
              <strong className="mt-2 block text-xs text-white">Texto + anexos</strong>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
              <ShieldCheck className="mx-auto h-5 w-5 text-amber-300" />
              <strong className="mt-2 block text-xs text-white">Ações confirmadas</strong>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-center">
              <Sparkles className="mx-auto h-5 w-5 text-violet-300" />
              <strong className="mt-2 block text-xs text-white">Voz depois</strong>
            </div>
          </section>

          {recentConversations.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-black uppercase text-violet-300">
                    Continuar
                  </span>
                  <h3 className="text-lg font-black text-white">Conversas recentes</h3>
                </div>
                <button
                  type="button"
                  onClick={() => startConversation()}
                  className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-200"
                >
                  <Plus className="h-4 w-4" />
                  Nova
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {recentConversations.map(conversation => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      setActiveConversationId(conversation.id);
                      setDraft('');
                      setPendingAttachmentFiles([]);
                      setErrorMessage('');
                      setFailedConversationId('');
                    }}
                    className="min-h-32 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left"
                  >
                    <MessageSquareText className="h-5 w-5 text-violet-300" />
                    <h4 className="mt-3 line-clamp-2 text-sm font-black text-white">
                      {conversation.title}
                    </h4>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{conversation.messages.length} mensagens</span>
                      <span>{relativeConversationDate(conversation.updatedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <span className="text-xs font-black uppercase text-violet-300">
              Começar por um assunto
            </span>
            <h3 className="mt-1 text-lg font-black text-white">
              O Consultor acompanha o contexto
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {WORKSPACE_TEMPLATES.map(template => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => startConversation(template)}
                    className="group min-h-40 rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left transition-colors hover:border-violet-500/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-violet-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h4 className="mt-4 text-sm font-black text-white">
                      {template.title}
                    </h4>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-500">
                      {template.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <section className="flex min-h-[70dvh] flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl">
          <header className="flex items-center gap-3 border-b border-slate-800 px-3 py-3 sm:px-4">
            <button
              type="button"
              onClick={() => {
                abortControllerRef.current?.abort();
                setActiveConversationId('');
                setDraft('');
                setPendingAttachmentFiles([]);
                setErrorMessage('');
                setFailedConversationId('');
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300"
              aria-label="Voltar às conversas"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-black uppercase text-violet-300">
                Consultor Kyrub
              </span>
              <h2 className="truncate text-base font-black text-white">
                {activeConversation.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={deleteActiveConversation}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 text-red-300"
              aria-label="Excluir conversa"
              title="Excluir conversa deste dispositivo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </header>

          <div ref={messagesViewportRef} className="flex-1 space-y-4 overflow-y-auto p-4">
            {activeConversation.messages.length === 0 && (
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-slate-800 bg-slate-900 px-4 py-3 text-sm leading-relaxed text-slate-300">
                  Olá! Conte o que você precisa. Vou ajudar a organizar a solicitação e os próximos passos.
                </div>
              </div>
            )}

            {activeConversation.messages.map(message => (
              <div
                key={message.id ?? `${message.role}-${message.createdAt}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                    <Bot className="h-5 w-5" />
                  </div>
                )}
                <div
                  className={`max-w-[84%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-tr-md bg-violet-500 text-white'
                      : 'rounded-tl-md border border-slate-800 bg-slate-900 text-slate-300'
                  }`}
                >
                  {message.content}
                  <KyrubAiAttachmentSummary attachments={message.attachments ?? []} />
                </div>
              </div>
            ))}

            {visibleOfferedIntents.length > 0 && !busy && !draft.trim() && pendingAttachmentFiles.length === 0 && (
              <div
                className="ml-11 flex max-w-[84%] flex-wrap gap-2"
                aria-label="Próximos passos sugeridos pela Kyrubia"
              >
                {visibleOfferedIntents.map(offeredIntent => (
                  <button
                    key={offeredIntent.id}
                    type="button"
                    onClick={() => chooseOfferedIntent(offeredIntent)}
                    className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-left text-xs font-black text-violet-200 transition-colors hover:border-violet-400/60 hover:bg-violet-500/15"
                  >
                    {offeredIntent.label}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-400">
                  <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                  {uploadingAttachments ? 'Enviando anexos...' : 'Pensando...'}
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                <p>{errorMessage}</p>
                {failedConversationId === activeConversation.id && (
                  <button
                    type="button"
                    onClick={retryLastRequest}
                    disabled={busy}
                    className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100 disabled:opacity-50"
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="border-t border-slate-800 p-3 sm:p-4">
            <KyrubAiAttachmentPicker
              files={pendingAttachmentFiles}
              onChange={setPendingAttachmentFiles}
              onError={setErrorMessage}
              disabled={busy || !user}
            />
            <div className="mt-2 flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-2 focus-within:border-violet-500/60">
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value.slice(0, 4_000))}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Digite sua solicitação..."
                rows={2}
                className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-white outline-none placeholder:text-slate-600"
              />
              <button
                type="submit"
                disabled={(!draft.trim() && pendingAttachmentFiles.length === 0) || busy}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white disabled:opacity-40"
                aria-label="Enviar mensagem"
              >
                {busy ? (
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-600">
              Anexos são contexto da conversa. Ações no aplicativo continuam passando por confirmação quando necessário.
            </p>
          </form>
        </section>
      )}
    </div>,
    host
  );
}