import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  deleteKyrubAiCloudConversation,
  hydrateKyrubAiConversationHistory,
  persistKyrubAiCloudConversations,
} from '../ai/kyrubiaConversationCloudSync';
import { loadKyrubAiConversations } from '../ai/conversationStore';

const MIRROR_INTERVAL_MS = 1_500;
const LEGACY_HISTORY_COPY =
  'Histórico textual e referências de anexos ficam neste dispositivo; os arquivos são privados no Storage.';
const CLOUD_HISTORY_COPY =
  'Seu histórico é sincronizado com sua conta entre dispositivos; os arquivos de anexo continuam privados no Storage.';

const signature = (value: unknown): string => JSON.stringify(value);

export function KyrubAiConversationCloudSyncGate({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const activeUidRef = useRef('');
  const knownIdsRef = useRef<Set<string>>(new Set());
  const lastSignatureRef = useRef('');

  useEffect(() => {
    let disposed = false;
    let mirrorTimer = 0;

    const stopMirror = () => {
      if (mirrorTimer) window.clearInterval(mirrorTimer);
      mirrorTimer = 0;
    };

    const startMirror = (user: User) => {
      stopMirror();
      mirrorTimer = window.setInterval(() => {
        if (disposed || activeUidRef.current !== user.uid) return;
        const current = loadKyrubAiConversations(localStorage, user.uid);
        const currentSignature = signature(current);
        if (currentSignature === lastSignatureRef.current) return;

        const currentIds = new Set(current.map(item => item.id));
        const removedIds = [...knownIdsRef.current]
          .filter(conversationId => !currentIds.has(conversationId));

        lastSignatureRef.current = currentSignature;
        knownIdsRef.current = currentIds;

        void Promise.all([
          persistKyrubAiCloudConversations(user.uid, current),
          ...removedIds.map(conversationId =>
            deleteKyrubAiCloudConversation(user.uid, conversationId)
          ),
        ]).catch(error => {
          console.warn('[Kyrubia] Cloud history mirror will retry later.', error);
        });
      }, MIRROR_INTERVAL_MS);
    };

    const hydrate = async (user: User | null) => {
      stopMirror();
      activeUidRef.current = user?.uid ?? '';
      knownIdsRef.current = new Set();
      lastSignatureRef.current = '';
      setReady(false);

      if (!user) {
        if (!disposed) setReady(true);
        return;
      }

      try {
        const merged = await hydrateKyrubAiConversationHistory(
          localStorage,
          user.uid
        );
        if (disposed || activeUidRef.current !== user.uid) return;
        knownIdsRef.current = new Set(merged.map(item => item.id));
        lastSignatureRef.current = signature(merged);
      } catch (error) {
        // Offline or a transient Firestore error must never block Kyrubia.
        const local = loadKyrubAiConversations(localStorage, user.uid);
        knownIdsRef.current = new Set(local.map(item => item.id));
        lastSignatureRef.current = signature(local);
        console.warn('[Kyrubia] Using local conversation cache until cloud sync returns.', error);
      }

      if (disposed || activeUidRef.current !== user.uid) return;
      setReady(true);
      startMirror(user);
    };

    const unsubscribe = onAuthStateChanged(auth, user => {
      void hydrate(user);
    });

    return () => {
      disposed = true;
      stopMirror();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const syncCopy = () => {
      document
        .querySelectorAll<HTMLElement>('#kyrub-ai-workspace span')
        .forEach(element => {
          if (element.textContent?.trim() === LEGACY_HISTORY_COPY) {
            element.textContent = CLOUD_HISTORY_COPY;
          }
        });

      document
        .querySelectorAll<HTMLButtonElement>(
          '#kyrub-ai-workspace button[title="Excluir conversa deste dispositivo"]'
        )
        .forEach(button => {
          button.title = 'Excluir conversa da sua conta';
        });
    };

    syncCopy();
    const observer = new MutationObserver(syncCopy);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-sm text-slate-400">
        Preparando seu Kyrub…
      </div>
    );
  }

  return <>{children}</>;
}
