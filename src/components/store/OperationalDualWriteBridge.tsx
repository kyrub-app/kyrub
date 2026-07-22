import { useEffect, useRef } from 'react';
import { auth } from '../../utils/firebase';
import { subscribeToOperationalDualWrite } from '../../utils/operationalDualWrite';

interface OperationalDualWriteBridgeProps {
  legacyStoreId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const permissionMessageKey = (storeId: string): string =>
  `kyrub_dual_write_permission_notice_${storeId}`;

const readyMessageKey = (storeId: string): string =>
  `kyrub_dual_write_ready_notice_${storeId}`;

const isPermissionDenied = (error: Error): boolean => {
  const code = (error as Error & { code?: string }).code ?? '';
  return (
    code === 'permission-denied' ||
    error.message.toLocaleLowerCase('pt-BR').includes('permission')
  );
};

export const OperationalDualWriteBridge = ({
  legacyStoreId,
  notify,
}: OperationalDualWriteBridgeProps) => {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !legacyStoreId || user.uid !== legacyStoreId) return;

    let cancelled = false;
    let unsubscribe = () => undefined;

    const reportFailure = (error: Error): void => {
      if (cancelled) return;
      console.warn('Falha no espelhamento operacional canônico.', error);
      if (!isPermissionDenied(error)) return;

      const storageKey = permissionMessageKey(legacyStoreId);
      if (localStorage.getItem(storageKey)) return;
      localStorage.setItem(storageKey, '1');
      notifyRef.current(
        'O fluxo atual foi preservado, mas as regras multi-loja ainda precisam ser publicadas no Firebase.',
        'warning'
      );
    };

    void subscribeToOperationalDualWrite(user, legacyStoreId, {
      onReady: store => {
        if (cancelled) return;
        const storageKey = readyMessageKey(store.id);
        if (localStorage.getItem(storageKey)) return;
        localStorage.setItem(storageKey, '1');
        notifyRef.current(
          'Migração segura ativada: pedidos e pagamentos serão mantidos nos dois caminhos.',
          'success'
        );
      },
      onUnavailable: () => {
        console.info(
          'Dual-write operacional aguardando o registro da loja canônica.',
          { legacyStoreId }
        );
      },
      onError: reportFailure,
    })
      .then(stop => {
        if (cancelled) {
          stop();
          return;
        }
        unsubscribe = stop;
      })
      .catch(error => {
        reportFailure(
          error instanceof Error
            ? error
            : new Error('Não foi possível iniciar a gravação dupla.')
        );
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [legacyStoreId]);

  return null;
};
