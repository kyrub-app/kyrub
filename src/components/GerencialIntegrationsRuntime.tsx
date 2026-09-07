import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import MercadoLivreE2ETestBridge from './store/MercadoLivreE2ETestBridge';
import StoreConnectionsWorkspace from './store/StoreConnectionsWorkspace';

type ToastType = 'success' | 'error' | 'info';

interface GerencialIntegrationsRuntimeProps {
  triggerToast: (message: string, type?: ToastType) => void;
}

export function GerencialIntegrationsRuntime({
  triggerToast,
}: GerencialIntegrationsRuntimeProps) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [notice, setNotice] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const notify = (message: string, type: ToastType = 'info'): void => {
    setNotice({ message, type });
    triggerToast(message, type);
  };

  return (
    <div className="space-y-5" id="kyrub-gerencial-integrations-runtime" data-kyrub-gerencial-module="integrations-lazy">
      {notice && (
        <div
          className={`rounded-2xl border px-4 py-3 text-[10px] leading-relaxed ${
            notice.type === 'success'
              ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
              : notice.type === 'error'
                ? 'border-red-500/25 bg-red-500/[0.06] text-red-100'
                : 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100'
          }`}
          role="status"
        >
          {notice.message}
        </div>
      )}

      {user ? (
        <>
          <StoreConnectionsWorkspace user={user} storeId={user.uid} notify={notify} />
          <MercadoLivreE2ETestBridge
            user={user}
            storeId={user.uid}
            notify={notify}
          />
        </>
      ) : (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-[10px] leading-relaxed text-amber-100">
          A sessão autenticada ainda não está disponível para carregar as conexões da loja.
        </div>
      )}

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-xs font-black uppercase text-white">Demais canais</h3>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Mercado Livre é o primeiro canal montado nativamente. 99Food, iFood, Shopee, Amazon Brasil, Quita e Kyrub Marketplace Hub serão ligados aqui em cortes próprios.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-xs font-black uppercase text-white">Sandbox</h3>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          O workspace E2E do Mercado Livre aparece acima quando existir uma conexão autorizada. Abrir este módulo não cria pedidos externos reais.
        </p>
      </section>
    </div>
  );
}
