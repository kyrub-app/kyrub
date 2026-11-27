import React from 'react';
import { Wallet } from 'lucide-react';
import {PersonalPixSettings,personalFinanceCandidateEnabled} from './PersonalPixSettings';
import FreelaMovements from './FreelaMovements';
import {useLocalFreelaCandidate} from './CanonicalFreelaWorkspace';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletHistory: any[];
}

/** Read-only financial surface. Never infer an available cash balance from legacy local history. */
export const WalletMovementsPanel: React.FC<{ walletHistory: any[];onPersonalFinanceActivity?:(uid:string,active:boolean)=>void }> = ({ walletHistory,onPersonalFinanceActivity }) => (
  <div className="space-y-4" id="wallet-movements-panel">
    {personalFinanceCandidateEnabled() && <PersonalPixSettings onActivity={onPersonalFinanceActivity} /> }
    {personalFinanceCandidateEnabled() && useLocalFreelaCandidate() && <FreelaMovements/>}
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <span className="block text-xs font-bold uppercase text-amber-300">Movimentações reais em preparação</span>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        Ainda não há conta financeira canônica vinculada. Saldo bancário,
        Pix, depósitos, saques e Open Finance permanecerão indisponíveis
        até a ativação dos provedores e a confirmação segura da liquidação.
      </p>
    </div>
    <div className="space-y-3">
      <h4 className="text-sm font-bold text-white">Histórico local anterior</h4>
      <p className="text-xs leading-relaxed text-slate-400">
        Registros informativos do aparelho — não representam saldo,
        pagamento confirmado ou extrato bancário.
      </p>
      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {walletHistory.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-center text-sm text-slate-400">
            Nenhum registro local.
          </div>
        ) : (
          walletHistory.map((hist, index) => (
            <div key={hist.id ?? index} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="min-w-0">
                <strong className="block truncate text-sm text-slate-200">{hist.desc}</strong>
                <span className="text-xs text-slate-400">{hist.date} · {hist.type}</span>
              </div>
              <strong className="shrink-0 text-xs text-slate-400">
                {hist.val > 0 ? '+' : ''}R$ {Number(hist.val || 0).toFixed(2)}
              </strong>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen, onClose, walletHistory,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/80 backdrop-blur-sm" id="modal-wallet">
      <div className="h-full w-full max-w-md space-y-5 overflow-y-auto border-l border-slate-800 bg-slate-900 p-5">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-teal-400" />
            <h3 className="text-lg font-black text-white">Movimentações</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar movimentações"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-slate-300">✕</button>
        </header>
        <WalletMovementsPanel walletHistory={walletHistory} />
      </div>
    </div>
  );
};
