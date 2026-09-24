import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Camera,
  EllipsisVertical,
  FileUp,
  GraduationCap,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
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
  KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
  type KyrubiaOperationalWorkflowMessageDetail,
} from '../ai/operationalWorkflowStore';
import { routeKyrubiaStorePromotionFromWorkspace } from '../ai/storePromotionWorkspaceRouter';
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

const EDUCATOR_TOPIC = 'Kyrubia Educadora';

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

const findProviderSettingsTrigger = (): HTMLButtonElement | null => {
  const host = document.getElementById('kyrub-ai-provider-settings-host');
  if (!(host instanceof HTMLElement)) return null;
  const trigger = Array.from(host.querySelectorAll('button')).find(button =>
    (button.textContent ?? '').toLocaleLowerCase('pt-BR').includes('minha ia')
  );
  return trigger instanceof HTMLButtonElement ? trigger : null;
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
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [educatorOpen, setEducatorOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const hiddenAttachmentPickerRef = useRef<HTMLDivElement | null>(null);
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
    setConversationMenuOpen(false);
    setMoreMenuOpen(false);
    setPlusMenuOpen(false);
    setEducatorOpen(false);

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

  const educatorConversations = useMemo(
    () => conversations.filter(item => item.topic === EDUCATOR_TOPIC),
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
        : 'A Kyrubia está temporariamente indisponível.';
      setErrorMessage(message);
      setFailedConversationId(conversation.id);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setSending(false);
      }
    }
  };

  const resetComposer = () => {
    abortControllerRef.current?.abort();
    setActiveConversationId('');
    setDraft('');
    setPendingAttachmentFiles([]);
    setErrorMessage('');
    setFailedConversationId('');
  };

  const startEducatorConversation = () => {
    const conversation = createKyrubAiConversation(EDUCATOR_TOPIC, EDUCATOR_TOPIC);
    setConversations(current => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setDraft('');
    setPendingAttachmentFiles([]);
    setErrorMessage('');
    setFailedConversationId('');
    setEducatorOpen(false);
    setMoreMenuOpen(false);
  };

  const submitContent = async (
    content: string,
    selectedOfferedIntentId?: string
  ) => {
    const cleanContent = content.trim();
    if ((!cleanContent && pendingAttachmentFiles.length === 0) || busy) return;
    if (!user) {
      setErrorMessage('Faça login para conversar com a Kyrubia.');
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
    setPlusMenuOpen(false);
    setActiveConversationId(nextConversation.id);
    setConversations(current => {
      const withoutCurrent = current.filter(item => item.id !== nextConversation.id);
      return [nextConversation, ...withoutCurrent];
    });

    if (attachments.length === 0) {
      try {
        const promotionRoute = await routeKyrubiaStorePromotionFromWorkspace(
          user,
          nextConversation.id,
          messageContent
        );
        if (promotionRoute.handled) {
          const assistantMessage = createKyrubAiMessage(
            'assistant',
            promotionRoute.reply ?? 'Preparei a promoção para sua confirmação.'
          );
          updateConversation(nextConversation.id, current => ({
            ...current,
            updatedAt: new Date().toISOString(),
            messages: [...current.messages, assistantMessage],
          }));
          return;
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? `Não foi possível consultar o catálogo para preparar a promoção: ${error.message}`
            : 'Não foi possível consultar o catálogo para preparar a promoção.'
        );
        setFailedConversationId(nextConversation.id);
        return;
      }
    }

    await requestReply(
      nextConversation,
      nextConversation.messages,
      selectedOfferedIntentId
    );
  };

  useEffect(() => {
    const handleOperationalFollowUp = (event: Event) => {
      const detail = (
        event as CustomEvent<KyrubiaOperationalWorkflowMessageDetail>
      ).detail;
      if (
        !detail?.message?.trim() ||
        detail.conversationId !== activeConversationId ||
        busy
      ) {
        return;
      }
      void submitContent(detail.message);
    };
    window.addEventListener(
      KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
      handleOperationalFollowUp
    );
    return () => window.removeEventListener(
      KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT,
      handleOperationalFollowUp
    );
  }, [activeConversationId, busy, user, conversations]);

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

  const deleteConversation = (conversation: KyrubAiLocalConversation) => {
    if (conversation.id === activeConversationId) {
      abortControllerRef.current?.abort();
    }
    const attachments = conversation.messages.flatMap(
      message => message.attachments ?? []
    );
    if (user && attachments.length > 0) {
      void deleteKyrubiaAttachments(user, attachments).catch(error => {
        console.warn('[Kyrubia] Could not clean up conversation attachments.', error);
      });
    }
    setConversations(current => current.filter(item => item.id !== conversation.id));
    if (conversation.id === activeConversationId) resetComposer();
  };

  const openHiddenAttachmentInput = (ariaLabel: string) => {
    const input = hiddenAttachmentPickerRef.current?.querySelector(
      `input[aria-label="${ariaLabel}"]`
    );
    if (input instanceof HTMLInputElement) input.click();
    setPlusMenuOpen(false);
  };

  const openProviderSettings = () => {
    const trigger = findProviderSettingsTrigger();
    if (!trigger) {
      setErrorMessage('As configurações da sua IA ainda não estão disponíveis nesta tela.');
      return;
    }
    setPlusMenuOpen(false);
    trigger.click();
  };

  const visibleOfferedIntents = activeConversation?.messages.at(-1)?.role === 'assistant'
    ? activeConversation.lastTurnContext?.offeredIntents?.slice(0, 3) ?? []
    : [];

  if (!host) return null;

  return createPortal(
    <div
      id="kyrub-ai-workspace"
      className="relative flex min-h-[70dvh] flex-col overflow-hidden rounded-3xl border border-slate-900 bg-slate-950 shadow-2xl"
    >
      <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMoreMenuOpen(false);
            setConversationMenuOpen(true);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-950/90 text-slate-300 backdrop-blur"
          aria-label="Abrir conversas"
          title="Conversas"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setConversationMenuOpen(false);
              setMoreMenuOpen(current => !current);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-950/90 text-slate-300 backdrop-blur"
            aria-label="Mais opções da Kyrubia"
            title="Mais opções"
          >
            <EllipsisVertical className="h-5 w-5" />
          </button>
          {moreMenuOpen && (
            <div className="absolute right-0 top-12 w-56 rounded-2xl border border-slate-800 bg-slate-950 p-1.5 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setEducatorOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-black text-slate-200 hover:bg-slate-900"
              >
                <GraduationCap className="h-4 w-4 text-violet-300" />
                Kyrubia Educadora
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={messagesViewportRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 pb-5 pt-16"
      >
        {activeConversation?.messages.map(message => (
          <div
            key={message.id ?? `${message.role}-${message.createdAt}`}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
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
          <div className="flex max-w-[86%] flex-wrap gap-2" aria-label="Próximos passos sugeridos pela Kyrubia">
            {visibleOfferedIntents.map(offeredIntent => (
              <button
                key={offeredIntent.id}
                type="button"
                onClick={() => chooseOfferedIntent(offeredIntent)}
                className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-left text-xs font-black text-violet-200"
              >
                {offeredIntent.label}
              </button>
            ))}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
            {uploadingAttachments ? 'Enviando anexos...' : 'Pensando...'}
          </div>
        )}

        {errorMessage && (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <p>{errorMessage}</p>
            {activeConversation && failedConversationId === activeConversation.id && (
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

      <form onSubmit={sendMessage} className="relative border-t border-slate-900 bg-slate-950 p-3 sm:p-4">
        <div ref={hiddenAttachmentPickerRef} className="hidden" aria-hidden="true">
          <KyrubAiAttachmentPicker
            files={pendingAttachmentFiles}
            onChange={setPendingAttachmentFiles}
            onError={setErrorMessage}
            disabled={busy || !user}
          />
        </div>

        {pendingAttachmentFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2" aria-label="Anexos selecionados">
            {pendingAttachmentFiles.map((file, index) => (
              <span
                key={`${file.name}-${file.lastModified}-${index}`}
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-100"
              >
                <span className="max-w-48 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setPendingAttachmentFiles(current => current.filter((_item, itemIndex) => itemIndex !== index))}
                  className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/10"
                  aria-label={`Remover ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-2 focus-within:border-violet-500/60">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPlusMenuOpen(current => !current)}
              disabled={busy || !user}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              aria-label="Anexar ou conectar IA"
              aria-expanded={plusMenuOpen}
            >
              <Plus className="h-5 w-5" />
            </button>
            {plusMenuOpen && (
              <div className="absolute bottom-14 left-0 z-40 w-64 rounded-2xl border border-slate-800 bg-slate-950 p-1.5 shadow-2xl">
                <button
                  type="button"
                  onClick={() => openHiddenAttachmentInput('Escolher imagens ou PDF')}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-black text-slate-200 hover:bg-slate-900"
                >
                  <FileUp className="h-4 w-4 text-violet-300" />
                  Anexar imagem ou PDF
                </button>
                <button
                  type="button"
                  onClick={() => openHiddenAttachmentInput('Tirar foto com a câmera')}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-black text-slate-200 hover:bg-slate-900"
                >
                  <Camera className="h-4 w-4 text-violet-300" />
                  Usar câmera
                </button>
                <button
                  type="button"
                  onClick={openProviderSettings}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-black text-slate-200 hover:bg-slate-900"
                >
                  <Sparkles className="h-4 w-4 text-violet-300" />
                  Conectar minha IA
                </button>
              </div>
            )}
          </div>

          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value.slice(0, 4_000))}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={activeConversation?.topic === EDUCATOR_TOPIC ? 'O que você quer aprender?' : 'Mensagem para a Kyrubia...'}
            rows={1}
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-relaxed text-white outline-none placeholder:text-slate-600"
          />

          <button
            type="submit"
            disabled={(!draft.trim() && pendingAttachmentFiles.length === 0) || busy || !user}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white disabled:opacity-35"
            aria-label="Enviar mensagem para a Kyrubia"
          >
            {busy ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>

      {conversationMenuOpen && (
        <div
          className="fixed inset-0 z-[350] bg-slate-950/75 backdrop-blur-sm"
          onClick={() => setConversationMenuOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 flex h-full w-[min(24rem,92vw)] flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
            onClick={event => event.stopPropagation()}
            aria-label="Conversas da Kyrubia"
          >
            <header className="flex items-center gap-3 border-b border-slate-800 p-4">
              <MessageSquareText className="h-5 w-5 text-violet-300" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-black text-white">Conversas</h2>
                <p className="text-[10px] text-slate-500">Retome de onde parou.</p>
              </div>
              <button
                type="button"
                onClick={() => setConversationMenuOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 text-slate-400"
                aria-label="Fechar conversas"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  resetComposer();
                  setConversationMenuOpen(false);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-xs font-black text-violet-100"
              >
                <Plus className="h-4 w-4" />
                Nova conversa
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
              {conversations.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-slate-600">
                  Nenhuma conversa iniciada ainda.
                </p>
              ) : (
                conversations.map(conversation => (
                  <div
                    key={conversation.id}
                    className={`flex items-center gap-2 rounded-2xl border p-2 ${
                      conversation.id === activeConversationId
                        ? 'border-violet-500/35 bg-violet-500/10'
                        : 'border-slate-800 bg-slate-900/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConversationId(conversation.id);
                        setDraft('');
                        setPendingAttachmentFiles([]);
                        setErrorMessage('');
                        setFailedConversationId('');
                        setConversationMenuOpen(false);
                      }}
                      className="min-w-0 flex-1 px-2 py-2 text-left"
                    >
                      <strong className="block truncate text-xs text-white">
                        {conversation.title}
                      </strong>
                      <span className="mt-1 block text-[10px] text-slate-500">
                        {relativeConversationDate(conversation.updatedAt)}
                        {conversation.topic === EDUCATOR_TOPIC ? ' · Educadora' : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteConversation(conversation)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-red-500/10 hover:text-red-300"
                      aria-label={`Excluir conversa ${conversation.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {educatorOpen && (
        <div
          className="fixed inset-0 z-[360] bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setEducatorOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 flex h-full w-[min(26rem,94vw)] flex-col border-l border-violet-500/20 bg-slate-950 shadow-2xl"
            onClick={event => event.stopPropagation()}
            aria-label="Kyrubia Educadora"
          >
            <header className="flex items-center gap-3 border-b border-slate-800 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-300">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[9px] font-black uppercase tracking-wider text-violet-300">
                  Aprender · praticar · evoluir
                </span>
                <h2 className="text-base font-black text-white">Kyrubia Educadora</h2>
              </div>
              <button
                type="button"
                onClick={() => setEducatorOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 text-slate-400"
                aria-label="Fechar Kyrubia Educadora"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              <section className="rounded-3xl border border-violet-500/20 bg-violet-500/5 p-4">
                <BookOpen className="h-6 w-6 text-violet-300" />
                <h3 className="mt-3 text-sm font-black text-white">Sua trilha continua entre conversas</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  A Kyrubia pode organizar uma trilha de estudo, acompanhar sua evolução e retomar o aprendizado de onde você parou. O caminho é aprender, praticar, desenvolver habilidade e, quando fizer sentido para você, perceber oportunidades relacionadas ao que aprendeu.
                </p>
              </section>

              <button
                type="button"
                onClick={startEducatorConversation}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-xs font-black text-white"
              >
                <Plus className="h-4 w-4" />
                Começar nova trilha
              </button>

              {educatorConversations.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">
                    Continuar aprendendo
                  </h3>
                  <div className="mt-2 space-y-2">
                    {educatorConversations.map(conversation => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          setActiveConversationId(conversation.id);
                          setDraft('');
                          setPendingAttachmentFiles([]);
                          setErrorMessage('');
                          setFailedConversationId('');
                          setEducatorOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left"
                      >
                        <GraduationCap className="h-4 w-4 shrink-0 text-violet-300" />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-xs text-white">
                            {conversation.title}
                          </strong>
                          <span className="mt-1 block text-[10px] text-slate-500">
                            {relativeConversationDate(conversation.updatedAt)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      )}

      <style>{`
        #kyrub-ai-provider-settings-host > div:first-child {
          display: none !important;
        }
      `}</style>
    </div>,
    host
  );
}
