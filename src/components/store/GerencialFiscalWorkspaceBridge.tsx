import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReceiptText } from 'lucide-react';
import { FiscalWorkspace } from './FiscalWorkspace';

const GERENCIAL_ID = 'erp-gerencial-tab';
const HOST_ID = 'kyrub-gerencial-fiscal-workspace-host';
const BUTTON_ID = 'kyrub-gerencial-fiscal-entry';

export function GerencialFiscalWorkspaceBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const closeFiscal = useCallback(() => {
    setOpen(false);
    const gerencial = document.getElementById(GERENCIAL_ID);
    const menuGrid = gerencial?.querySelector(':scope > .grid') as HTMLElement | null;
    if (menuGrid) menuGrid.style.display = '';
  }, []);

  const ensureEntry = useCallback(() => {
    const gerencial = document.getElementById(GERENCIAL_ID);
    if (!gerencial) {
      setHost(previous => previous && !previous.isConnected ? null : previous);
      return;
    }

    const menuGrid = gerencial.querySelector(':scope > .grid') as HTMLElement | null;
    if (!menuGrid) return;

    let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.className = 'bg-slate-900 border border-slate-850 hover:border-cyan-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2';
      button.innerHTML = `
        <div class="w-10 h-10 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-400 border border-cyan-500/20" aria-hidden="true">
          <span class="text-lg">▤</span>
        </div>
        <div>
          <h4 class="text-xs font-black text-white uppercase group-hover:text-cyan-400 transition-colors">FISCAL</h4>
          <p class="text-[10px] text-slate-400 leading-relaxed mt-0.5">Dados fiscais, prontidão e homologação segura da emissão da loja.</p>
        </div>`;
      button.addEventListener('click', () => {
        menuGrid.style.display = 'none';
        setOpen(true);
      });
      menuGrid.appendChild(button);
    }

    let nextHost = document.getElementById(HOST_ID);
    if (!nextHost) {
      nextHost = document.createElement('div');
      nextHost.id = HOST_ID;
      nextHost.className = 'min-w-0';
      gerencial.appendChild(nextHost);
    }
    if (host !== nextHost) setHost(nextHost);
  }, [host]);

  useEffect(() => {
    ensureEntry();
    const observer = new MutationObserver(ensureEntry);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ensureEntry]);

  useEffect(() => {
    if (!host) return;
    host.style.display = open ? '' : 'none';
  }, [host, open]);

  if (!host || !open) return null;

  return createPortal(
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeFiscal}
          className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all"
        >
          ← Menu Gerencial
        </button>
        <div className="flex items-center gap-2 text-cyan-300">
          <ReceiptText className="h-4 w-4" />
          <span className="text-[10px] font-black uppercase tracking-wider">Fiscal canônico</span>
        </div>
      </div>
      <FiscalWorkspace storeName="Loja" />
    </div>,
    host
  );
}
