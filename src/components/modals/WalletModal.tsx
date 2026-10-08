import React from 'react';
import { Wallet } from 'lucide-react';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletHistory: any[];
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  walletHistory,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end animate-fade-in" id="modal-wallet">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 overflow-y-auto animate-scale-up text-xs">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-400" />
              <h3 className="text-lg font-black text-white uppercase tracking-wider">Carteira Kyrub</h3>
            </div>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-2">
            <span className="text-[9px] font-mono text-amber-400 uppercase block">Movimentação financeira indisponível</span>
            <p className="text-slate-300 leading-relaxed">
              Esta área ainda não possui uma conta financeira canônica vinculada. PIX, depósitos, saques e saldo disponível só serão habilitados quando houver liquidação real confirmada pelo backend.
            </p>
          </div>

          <div className="space-y-3">
            <span className="text-[10px] font-mono uppercase text-slate-500 block">Histórico local anterior</span>
            <p className="text-[10px] text-slate-500">
              Registros abaixo são apenas históricos locais existentes e não comprovam saldo, pagamento ou liquidação.
            </p>
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {walletHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs italic bg-slate-950 rounded-xl border border-slate-800">
                  Nenhum registro local.
                </div>
              ) : (
                walletHistory.map(hist => (
                  <div key={hist.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                    <div>
                      <span className="text-slate-300 font-bold block">{hist.desc}</span>
                      <span className="text-[9px] text-slate-500">{hist.date} • {hist.type}</span>
                    </div>
                    <strong className="font-mono font-black text-slate-400">
                      {hist.val > 0 ? '+' : ''}R$ {Number(hist.val || 0).toFixed(2)}
                    </strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
