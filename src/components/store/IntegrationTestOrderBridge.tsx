import { useEffect, useState } from 'react';
import {
  INTEGRATION_TEST_ORDER_EVENT,
  appendIntegrationTestOrder,
  parseIntegrationTestOrderRequest,
} from '../../utils/integrationTestOrders';

interface IntegrationTestOrderBridgeProps {
  onTestOrderCreated: () => void;
}

export function IntegrationTestOrderBridge({
  onTestOrderCreated,
}: IntegrationTestOrderBridgeProps) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let clearMessageTimer: number | null = null;

    const handleTestOrder = (event: Event): void => {
      const request = parseIntegrationTestOrderRequest(
        (event as CustomEvent<unknown>).detail
      );
      if (!request) return;

      appendIntegrationTestOrder(localStorage, request);
      setMessage(
        `Pedido de teste de ${request.providerLabel} enviado para ${request.routingTarget}.`
      );

      window.setTimeout(onTestOrderCreated, 0);

      if (clearMessageTimer !== null) {
        window.clearTimeout(clearMessageTimer);
      }
      clearMessageTimer = window.setTimeout(() => setMessage(''), 5200);
    };

    window.addEventListener(INTEGRATION_TEST_ORDER_EVENT, handleTestOrder);
    return () => {
      window.removeEventListener(INTEGRATION_TEST_ORDER_EVENT, handleTestOrder);
      if (clearMessageTimer !== null) {
        window.clearTimeout(clearMessageTimer);
      }
    };
  }, [onTestOrderCreated]);

  if (!message) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-[120] w-[min(92vw,30rem)] -translate-x-1/2 rounded-2xl border border-cyan-500/30 bg-slate-950 px-5 py-4 text-center shadow-2xl">
      <strong className="block text-[10px] font-black uppercase tracking-wide text-cyan-300">
        Teste de roteamento concluído
      </strong>
      <span className="mt-1 block text-[10px] leading-relaxed text-slate-300">
        {message}
      </span>
    </div>
  );
}