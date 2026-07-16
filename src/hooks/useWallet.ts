import { useState, useEffect } from 'react';

const WALLET_BALANCE_KEY = 'kyrub_wallet_balance';
const WALLET_HISTORY_KEY = 'kyrub_wallet_history';

export interface WalletTransaction {
  id: string;
  type: string;
  desc: string;
  val: number;
  date: string;
}

export function useWallet() {
  const [walletBalance, setWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem(WALLET_BALANCE_KEY);
    return saved ? parseFloat(saved) : 0.00;
  });

  const [walletHistory, setWalletHistory] = useState<WalletTransaction[]>(() => {
    const saved = localStorage.getItem(WALLET_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem(WALLET_BALANCE_KEY, walletBalance.toString());
  }, [walletBalance]);

  useEffect(() => {
    localStorage.setItem(WALLET_HISTORY_KEY, JSON.stringify(walletHistory));
  }, [walletHistory]);

  const addTransaction = (type: string, desc: string, val: number) => {
    const newTx: WalletTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      desc,
      val,
      date: new Date().toLocaleString('pt-BR'),
    };
    setWalletBalance(curr => curr + val);
    setWalletHistory(prev => [newTx, ...prev]);
  };

  return {
    walletBalance,
    setWalletBalance,
    walletHistory,
    setWalletHistory,
    addTransaction,
  };
}
