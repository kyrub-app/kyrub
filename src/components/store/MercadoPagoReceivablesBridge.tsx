import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  beginMercadoPagoStoreConnection,
  disconnectMercadoPagoStoreConnection,
  loadMercadoPagoStoreConnectionStatus,
  validateMercadoPagoStoreConnection,
  type MercadoPagoStoreConnectionStatus,
} from '../../utils/mercadoPagoStoreConnection';

function MercadoPagoReceivablesPanel({ user }: { user: User }) {
  const [status, setStatus] = useState<MercadoPagoStoreConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [verifiedCheckoutAccountId, setVerifiedCheckoutAccountId] = useState('');

  const refresh = async (): Promise<void> => {
    try {
      const next = await loadMercadoPagoStoreConnectionStatus(user);
      setStatus(next);
      if (!next.connected || !next.oauthOperationsAllowed) setVerifiedCheckoutAccountId('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível consultar o Mercado Pago.');
    }
  };

  useEffect(() => { setVerifiedCheckoutAccountId(''); void refresh(); }, [user.uid]);

  const execute = async (operation: () => Promise<unknown>, success: string): Promise<void> => {
    try {
      setBusy(true);
      setMessage('');
      setVerifiedCheckoutAccountId('');
      await operation();
      setMessage(success);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCheckout = async (): Promise<void> => {
    try {
      setBusy(true);
      setMessage('');
      setVerifiedCheckoutAccountId('');
      const result = await validateMercadoPagoStoreConnection(user);
      if (!result.ok || !result.recipientPreflightReady || typeof result.checkoutActivated !== 'boolean' || !result.externalAccountId) {
        throw new Error('Não foi possível comprovar a conta recebedora do checkout.');
      }
      await refresh();
      setVerifiedCheckoutAccountId(result.externalAccountId);
      setMessage('Conta recebedora pré-validada. Esta verificação não criou Pix nem confirmou pagamento.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível validar o recebimento desta loja.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="mercado-pago-receivables-card" className="rounded-3xl border border-sky-500/20 bg-sky-500/[0.04] p-5">
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-sky-300">Recebimentos</span>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">Mercado Pago</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
            Conecte sua própria conta Mercado Pago para receber os Pix das vendas diretas desta loja. A autorização acontece no Mercado Pago e o Kyrub não solicita Access Token no navegador.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[8px] font-black uppercase ${status?.connected ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}>
          {status?.connected ? (!status.oauthOperationsAllowed ? 'Conta registrada · homologação protegida' : status.platformConfigured ? 'Conectado' : 'Conta registrada · ambiente pendente') : 'Não conectado'}
        </span>
      </div>

      {status?.connected && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-300">
          Conta autorizada: <strong>{status.externalAccountId || 'identificada pelo provedor'}</strong>
        </div>
      )}

      {status?.connected && verifiedCheckoutAccountId
        && status.externalAccountId === verifiedCheckoutAccountId && (
        <p className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[10px] text-emerald-100"
          data-kyrub-mp-checkout-preflight="verified">
          <strong>Conta recebedora pré-validada.</strong> Conta recebedora MP final …{verifiedCheckoutAccountId.slice(-4)}.
          A identidade OAuth e a conta prevista como recebedora foram conferidas.
          A validação não prova que um Pix tenha sido pago. A emissão, o webhook e a conciliação ainda exigem um teste financeiro controlado.
        </p>
      )}

      {status && !status.oauthOperationsAllowed && (
        <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-[10px] leading-relaxed text-amber-100" data-kyrub-mp-preview-readonly="true">
          Homologação protegida: a conta cadastrada aparece porque o Firestore é compartilhado. Autorização, desconexão e renovação de tokens ficam bloqueadas aqui. A pré-validação real precisa ser feita com segurança em produção, sem gerar Pix. Não copie credenciais para a preview.
        </div>
      )}

      {status && status.oauthOperationsAllowed && !status.platformConfigured && (
        <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-[10px] leading-relaxed text-amber-100">
          A integração Mercado Pago ainda não foi configurada pela administração do Kyrub neste ambiente. Para conectar a própria conta, primeiro precisamos ativar o aplicativo OAuth da plataforma. Não informe tokens nem repita pagamentos.
        </div>
      )}

      {message && <p className="mt-3 text-[10px] leading-relaxed text-slate-300" role="status">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {!status?.connected ? (
          <button
            type="button"
            disabled={busy || !status?.platformConfigured || !status?.oauthOperationsAllowed}
            onClick={() => void beginMercadoPagoStoreConnection(user).catch(error => setMessage(error instanceof Error ? error.message : 'Falha ao abrir autorização.'))}
            className="min-h-11 rounded-xl bg-sky-400 px-4 text-[10px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Conectar minha conta Mercado Pago
          </button>
        ) : (
          <>
            <button type="button" disabled={busy || !status?.platformConfigured || !status?.oauthOperationsAllowed} onClick={() => void verifyCheckout()} className="min-h-11 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 text-[10px] font-black uppercase text-emerald-100 disabled:opacity-40">
              Pré-validar conta recebedora
            </button>
            {status?.oauthOperationsAllowed && (
              <button type="button" disabled={busy} onClick={() => void execute(() => disconnectMercadoPagoStoreConnection(user), 'Mercado Pago desconectado desta loja.')} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40">
                Desconectar
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-4 text-[9px] leading-relaxed text-slate-500">
        Futuras instituições e o BaaS Kyrub usarão esta mesma área de Recebimentos, sem compartilhar credenciais entre lojas.
      </p>
    </section>
  );
}

export function MercadoPagoReceivablesBridge() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let created: HTMLDivElement | null = null;
    const sync = (): void => {
      if (cancelled) return;
      if (created && !created.isConnected) { created = null; setHost(null); }
      const anchor = document.getElementById('mercado-livre-integration-card');
      if (!created && anchor?.parentElement) {
        created = document.createElement('div');
        created.id = 'kyrub-receivables-integrations-host';
        anchor.insertAdjacentElement('afterend', created);
        setHost(created);
      }
      timer = window.setTimeout(sync, 120);
    };
    sync();
    return () => { cancelled = true; window.clearTimeout(timer); created?.remove(); setHost(null); };
  }, []);

  return host && user ? createPortal(<MercadoPagoReceivablesPanel user={user} />, host) : null;
}
