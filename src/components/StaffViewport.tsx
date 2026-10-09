import type { User } from 'firebase/auth';
import { Briefcase, Layers, LogIn, ShieldCheck, Store as StoreIcon } from 'lucide-react';
import type { StoreAccessRecord } from '../utils/storeDirectory';
import { STORE_ROLE_LABELS } from '../utils/storeSecurity';

interface StaffViewportProps {
  user: User | null;
  accesses: StoreAccessRecord[];
  isLoading: boolean;
  errorMessage: string;
  selectedStoreId: string;
  onSelectStore: (storeId: string) => void;
  onGoBackToMain: () => void;
  onEnterErp?: () => void;
}

export function StaffViewport({
  user,
  accesses,
  isLoading,
  errorMessage,
  selectedStoreId,
  onSelectStore,
  onGoBackToMain,
  onEnterErp,
}: StaffViewportProps) {
  const selectedAccess =
    accesses.find(access => access.store.id === selectedStoreId) ?? accesses[0] ?? null;

  return (
    <div className="min-h-screen bg-slate-950 p-4 font-sans text-slate-100 antialiased sm:p-6" id="staff-viewport">
      <header className="mx-auto mb-6 flex max-w-3xl items-center justify-between rounded-3xl border border-slate-800 bg-slate-900/90 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600">
            <Layers className="h-4 w-4 text-white" />
          </span>
          <div>
            <span className="font-mono text-[8px] font-bold uppercase text-orange-400">ERP Kyrub</span>
            <h1 className="text-sm font-black uppercase text-white">Acesso operacional</h1>
          </div>
        </div>
        <button type="button" onClick={onGoBackToMain} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] font-black uppercase text-slate-300">
          Voltar
        </button>
      </header>

      <main className="mx-auto max-w-3xl">
        {!user ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
            <LogIn className="mx-auto h-8 w-8 text-orange-400" />
            <h2 className="mt-4 text-base font-black text-white">Entre com sua conta Kyrub</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              O acesso operacional usa a mesma identidade Google do Kyrub. Entre pelo aplicativo e retorne a esta rota.
            </p>
            <button type="button" onClick={onGoBackToMain} className="mt-5 rounded-xl bg-orange-500 px-5 py-3 text-[10px] font-black uppercase text-slate-950">
              Ir para o login
            </button>
          </section>
        ) : isLoading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-xs text-slate-400">
            Validando seus vínculos operacionais…
          </section>
        ) : errorMessage ? (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-center text-xs text-red-200">
            {errorMessage}
          </section>
        ) : accesses.length === 0 ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-slate-600" />
            <h2 className="mt-4 text-base font-black text-white">Sem acesso operacional ativo</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              Esta conta não possui vínculo ativo com uma loja. O proprietário ou gerente precisa liberar o acesso em Equipe & Permissões.
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div>
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-orange-400">Identidade validada</span>
              <h2 className="mt-1 text-lg font-black text-white">Escolha a operação</h2>
              <p className="mt-1 text-[11px] text-slate-400">
                {user.displayName || user.email}. O acesso abaixo vem do vínculo canônico da equipe, não de uma senha compartilhada.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {accesses.map(access => (
                <button
                  key={access.store.id}
                  type="button"
                  onClick={() => onSelectStore(access.store.id)}
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    selectedAccess?.store.id === access.store.id
                      ? 'border-orange-500 bg-orange-500/10'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <StoreIcon className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-white">{access.store.name}</strong>
                      <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">
                        {STORE_ROLE_LABELS[access.role]}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {selectedAccess && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div>
                    <strong className="text-sm text-white">{selectedAccess.store.name}</strong>
                    <p className="mt-1 text-[11px] leading-relaxed text-emerald-100/70">
                      Vínculo ativo como {STORE_ROLE_LABELS[selectedAccess.role]}. O ERP reutiliza este contexto e filtra a navegação pelas permissões do papel.
                    </p>
                    {onEnterErp && (
                      <button type="button" onClick={onEnterErp} className="mt-4 rounded-xl bg-emerald-400 px-4 py-2.5 text-[10px] font-black uppercase text-slate-950">
                        Entrar no ERP
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
