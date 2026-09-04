import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import {
  KYRUB_ACTIVITY_UPDATED_EVENT,
} from '../../observability/kyrubActivityBrowser';
import { readRecentKyrubActivityEvents } from '../../observability/kyrubActivityLog';
import {
  KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
  requestCanonicalOrderNavigation,
} from '../../utils/canonicalOrderNavigation';
import {
  KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT,
  readReplacedResolvedRetryHandoffOrderId,
  readResolvedRetryHandoff,
  retainResolvedRetryHandoff,
} from '../../utils/resolvedRetryHandoff';
import {
  KYRUB_99FOOD_RETRY_RESOLVED_EVENT,
  type NinetyNineFoodRetryResolvedDetail,
} from '../../utils/storeChannelOperations';
import MercadoLivreE2ETestBridge from './MercadoLivreE2ETestBridge';
import NinetyNineFoodE2ETestBridge from './NinetyNineFoodE2ETestBridge';
import { PhysicalInventoryWorkspace } from './PhysicalInventoryWorkspace';
import StoreChannelCenter from './StoreChannelCenter';
import StoreChannelOperationsQueue from './StoreChannelOperationsQueue';
import StoreConnectionsWorkspace from './StoreConnectionsWorkspace';
import StoreInventoryAuthorityRepairPanel from './StoreInventoryAuthorityRepairPanel';
import StoreOwnerGovernancePanel from './StoreOwnerGovernancePanel';

interface StoreConnectionsPortalBridgeProps {
  user: User;
  storeId: string;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type ActivityUpdatedDetail = {
  actorUid?: string;
  eventId?: string;
};

export default function StoreConnectionsPortalBridge({
  user,
  storeId,
  notify,
}: StoreConnectionsPortalBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [inventoryRefreshVersion, setInventoryRefreshVersion] = useState(0);
  const [authorityRefreshVersion, setAuthorityRefreshVersion] = useState(0);
  const [resolvedRetry, setResolvedRetry] = useState<NinetyNineFoodRetryResolvedDetail | null>(
    () => readResolvedRetryHandoff(storeId)
  );
  const storeViewRefreshVersion = inventoryRefreshVersion + authorityRefreshVersion;
  const replacedResolvedRetryOrderId = readReplacedResolvedRetryHandoffOrderId(storeId);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;

    const mount = (): void => {
      if (cancelled) return;

      const productHost = document.getElementById('kyrub-product-inventory-workspace-host');
      if (!productHost?.parentElement) {
        timer = window.setTimeout(mount, 80);
        return;
      }

      const existing = document.getElementById('kyrub-store-connections-workspace-host');
      if (existing instanceof HTMLElement) {
        portalHost = existing as HTMLDivElement;
        setHost(existing);
        return;
      }

      portalHost = document.createElement('div');
      portalHost.id = 'kyrub-store-connections-workspace-host';
      portalHost.className = 'mb-5 min-w-0';
      productHost.parentElement.insertBefore(portalHost, productHost);
      setHost(portalHost);
    };

    timer = window.setTimeout(mount, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      portalHost?.remove();
      setHost(null);
    };
  }, [storeId, user.uid]);

  useEffect(() => {
    let cancelled = false;

    const handleActivityUpdated = (event: Event): void => {
      const detail = (event as CustomEvent<ActivityUpdatedDetail>).detail;
      const eventId = detail?.eventId?.trim() ?? '';
      if (
        !eventId ||
        detail?.actorUid?.trim() !== user.uid ||
        user.uid !== storeId
      ) {
        return;
      }

      window.setTimeout(() => {
        if (cancelled) return;
        try {
          const receiptEvent = readRecentKyrubActivityEvents(
            window.localStorage,
            user.uid,
            20
          ).find(candidate => candidate.id === eventId);

          if (
            receiptEvent?.type !== 'result.action_succeeded' ||
            receiptEvent.actionId !== 'adjust_inventory' ||
            receiptEvent.source !== 'authoritative_write_ack' ||
            receiptEvent.authority !== 'confirmed_result'
          ) {
            return;
          }

          setInventoryRefreshVersion(version => version + 1);
        } catch (error) {
          console.warn(
            'Não foi possível interpretar o recibo local para atualizar as visões de estoque.',
            error
          );
        }
      }, 0);
    };

    window.addEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivityUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(KYRUB_ACTIVITY_UPDATED_EVENT, handleActivityUpdated);
    };
  }, [storeId, user.uid]);

  useEffect(() => {
    const syncResolvedRetry = (): void => {
      setResolvedRetry(readResolvedRetryHandoff(storeId));
    };

    const handleRetryResolved = (event: Event): void => {
      const detail = (event as CustomEvent<NinetyNineFoodRetryResolvedDetail>).detail;
      const orderId = detail?.orderId?.trim() ?? '';
      if (
        !orderId ||
        detail?.storeId?.trim() !== storeId ||
        user.uid !== storeId
      ) {
        return;
      }
      setResolvedRetry({ ...detail, storeId, orderId });
      retainResolvedRetryHandoff({ ...detail, storeId, orderId });
    };

    const handleHandoffChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ storeId?: string }>).detail;
      if (detail?.storeId?.trim() !== storeId) return;
      syncResolvedRetry();
    };

    syncResolvedRetry();
    window.addEventListener(KYRUB_99FOOD_RETRY_RESOLVED_EVENT, handleRetryResolved);
    window.addEventListener(
      KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT,
      handleHandoffChanged
    );
    window.addEventListener(
      KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
      syncResolvedRetry
    );
    return () => {
      window.removeEventListener(KYRUB_99FOOD_RETRY_RESOLVED_EVENT, handleRetryResolved);
      window.removeEventListener(
        KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT,
        handleHandoffChanged
      );
      window.removeEventListener(
        KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT,
        syncResolvedRetry
      );
    };
  }, [storeId, user.uid]);

  if (!host || user.uid !== storeId) return null;

  return createPortal(
    <div className="space-y-5">
      <StoreChannelCenter
        key={`channel-center-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
      />
      <StoreInventoryAuthorityRepairPanel
        key={`authority-repair-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
        onApplied={() => setAuthorityRefreshVersion(version => version + 1)}
      />
      <StoreOwnerGovernancePanel
        key={`owner-governance-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
        onApplied={() => setAuthorityRefreshVersion(version => version + 1)}
      />
      {inventoryRefreshVersion > 0 && (
        <div
          id="kyrub-post-inventory-adjustment-guidance"
          className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.055] px-4 py-3 text-[10px] leading-relaxed text-cyan-100"
          role="status"
        >
          <strong className="block text-cyan-200">Ajuste confirmado · visões reconsultadas</strong>
          <span className="mt-1 block">
            O Kyrub reconsultou o estoque físico e as pendências dos canais. Isso não significa que um bloqueio ATP foi resolvido: se o pedido 99Food continuar listado, ele permanece bloqueado e exige uma nova ação explícita em “Tentar reservar novamente”.
          </span>
        </div>
      )}
      {resolvedRetry && (
        <div
          id="kyrub-99food-retry-resolved-handoff"
          className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.055] px-4 py-3 text-[10px] leading-relaxed text-emerald-100"
          role="status"
        >
          <strong className="block text-emerald-200">Retry reconsultado · bloqueio não está mais ativo</strong>
          {replacedResolvedRetryOrderId && replacedResolvedRetryOrderId !== resolvedRetry.orderId && (
            <span
              id="kyrub-resolved-retry-handoff-replaced"
              className="mt-2 block rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-amber-100"
            >
              Um resultado resolvido mais recente foi priorizado: o pedido {replacedResolvedRetryOrderId} foi substituído pelo pedido {resolvedRetry.orderId}. O Kyrub mantém apenas um handoff ativo por loja e não criou uma fila oculta.
            </span>
          )}
          <span className="mt-1 block">
            O readback autoritativo do pedido {resolvedRetry.orderId} está em “{resolvedRetry.state}”. Este aviso permanece recuperável até o pedido ser realmente focalizado; cancelar a localização não repete o retry nem apaga este resultado.
          </span>
          <button
            id="kyrub-open-resolved-99food-order"
            type="button"
            className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-500 px-4 text-[10px] font-black uppercase text-slate-950 hover:bg-emerald-400"
            onClick={() => {
              const requested = requestCanonicalOrderNavigation({
                storeId,
                orderId: resolvedRetry.orderId,
              });
              if (requested) setResolvedRetry(null);
            }}
          >
            Abrir pedidos
          </button>
        </div>
      )}
      <StoreChannelOperationsQueue
        key={`channel-operations-${storeViewRefreshVersion}`}
        user={user}
        storeId={storeId}
      />
      <PhysicalInventoryWorkspace
        key={`physical-inventory-${storeViewRefreshVersion}`}
        storeId={storeId}
      />
      <div id="kyrub-mercado-livre-channel-detail">
        <StoreConnectionsWorkspace user={user} storeId={storeId} notify={notify} />
      </div>
      <MercadoLivreE2ETestBridge user={user} storeId={storeId} notify={notify} />
      <div id="kyrub-99food-channel-detail">
        <NinetyNineFoodE2ETestBridge notify={notify} />
      </div>
    </div>,
    host
  );
}
