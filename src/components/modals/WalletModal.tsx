import React, { useState } from 'react';
import { Wallet } from 'lucide-react';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletBalance: number;
  setWalletBalance: React.Dispatch<React.SetStateAction<number>>;
  walletHistory: any[];
  setWalletHistory: React.Dispatch<React.SetStateAction<any[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  walletBalance,
  setWalletBalance,
  walletHistory,
  setWalletHistory,
  triggerToast,
}) => {
  const [pixTargetKey, setPixTargetKey] = useState('');
  const [pixAmount, setPixAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');

  if (!isOpen) return null;

  // BaaS deposit simulation
  const handleSimulateDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(depositAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setWalletBalance(curr => curr + amountNum);
    setWalletHistory(prev => [
      { id: `tx-dep-${Date.now()}`, type: 'Depósito PIX', desc: 'Depósito em conta digital simulado', val: amountNum, date: new Date().toLocaleString('pt-BR') },
      ...prev
    ]);
    setDepositAmount('');
    triggerToast(`Depósito de R$ ${amountNum.toFixed(2)} realizado!`, 'success');
  };

  // BaaS PIX transfer simulation
  const handleSimulatePix = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(pixAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;
    if (amountNum > walletBalance) {
      triggerToast('Saldo insuficiente para realizar este PIX!', 'error');
      return;
    }

    setWalletBalance(curr => curr - amountNum);
    setWalletHistory(prev => [
      { id: `tx-pix-${Date.now()}`, type: 'Transferência PIX', desc: `PIX para chave: ${pixTargetKey}`, val: -amountNum, date: new Date().toLocaleString('pt-BR') },
      ...prev
    ]);
    setPixAmount('');
    setPixTargetKey('');
    triggerToast(`PIX de R$ ${amountNum.toFixed(2)} enviado com sucesso!`, 'success');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end animate-fade-in" id="modal-wallet">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 flex flex-col justify-between overflow-y-auto animate-scale-up text-xs">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-400" />
              <h3 className="text-lg font-black text-white uppercase tracking-wider">Conta Digital Kyrub</h3>
            </div>
            <button 
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Digital Balance */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 text-center space-y-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 rounded-full blur-2xl" />
            <span className="text-[9px] font-mono text-slate-500 uppercase block">Saldo Disponível (Simulado)</span>
            <p className="text-3xl font-black text-teal-400 font-mono">R$ {walletBalance.toFixed(2)}</p>
            <div className="text-[10px] text-slate-400 font-mono bg-slate-900/60 py-1.5 rounded-lg border border-slate-900">
              Agência: <strong className="text-slate-200">0001</strong> | Conta: <strong className="text-slate-200">99042-9</strong>
            </div>
          </div>

          {/* Simulate Pix / Transfer */}
          <div className="space-y-3.5">
            <span className="text-[10px] font-mono uppercase text-slate-500 block">Enviar Transferência PIX</span>
            <form onSubmit={handleSimulatePix} className="space-y-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-800/60">
              <input
                type="text"
                placeholder="Chave PIX (Email, CPF ou Telefone)"
                value={pixTargetKey}
                onChange={(e) => setPixTargetKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
                required
              />
              <input
                type="number"
                step="0.01"
                placeholder="Valor R$ (ex: 50.00)"
                value={pixAmount}
                onChange={(e) => setPixAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
                required
              />
              <button
                type="submit"
                className="w-full py-2 bg-teal-500 text-slate-950 font-bold rounded-xl text-xs uppercase cursor-pointer"
              >
                Confirmar Envio PIX
              </button>
            </form>

            <span className="text-[10px] font-mono uppercase text-slate-500 block">Simular Depósito Bancário</span>
            <form onSubmit={handleSimulateDeposit} className="space-y-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-800/60">
              <input
                type="number"
                step="0.01"
                placeholder="Valor R$ do depósito"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                required
              />
              <button
                type="submit"
                className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase cursor-pointer"
              >
                Gerar Boleto / PIX Depósito
              </button>
            </form>
          </div>

          {/* Transaction History ledger */}
          <div className="space-y-3">
            <span className="text-[10px] font-mono uppercase text-slate-500 block">Extrato Recente (BaaS Split Audit)</span>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {walletHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs italic bg-slate-950 rounded-xl border border-slate-850">
                  Nenhuma transação recente.
                </div>
              ) : (
                walletHistory.map(hist => (
                  <div key={hist.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                    <div>
                      <span className="text-slate-300 font-bold block">{hist.desc}</span>
                      <span className="text-[9px] text-slate-500">{hist.date} • {hist.type}</span>
                    </div>
                    <strong className={`font-mono font-black ${hist.val > 0 ? 'text-teal-400' : 'text-red-400'}`}>
                      {hist.val > 0 ? '+' : ''}R$ {hist.val.toFixed(2)}
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
