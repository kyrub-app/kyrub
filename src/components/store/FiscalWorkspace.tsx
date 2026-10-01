import React from 'react';
import { FileCheck2, ShieldCheck, Building2, ReceiptText } from 'lucide-react';

interface FiscalWorkspaceProps {
  storeName: string;
  onStartOnboarding?: () => void;
}

export const FiscalWorkspace: React.FC<FiscalWorkspaceProps> = ({
  storeName,
  onStartOnboarding,
}) => (
  <div className="space-y-5" id="kyrub-fiscal-workspace">
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[9px] font-mono font-black uppercase tracking-wider text-emerald-400">
            Emissor Fiscal Kyrub
          </span>
          <h3 className="text-sm font-black text-white uppercase mt-1">Fiscal</h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-xl leading-relaxed">
            Configure a emissão fiscal da {storeName || 'sua loja'} e acompanhe os documentos vinculados às vendas do Kyrub.
          </p>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
          <FileCheck2 className="w-5 h-5" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[9px] font-mono font-black uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
          Configuração necessária
        </span>
        <span className="text-[9px] font-mono text-slate-500">Produção bloqueada até validação fiscal.</span>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-2">
        <Building2 className="w-5 h-5 text-blue-400" />
        <h4 className="text-xs font-black text-white uppercase">Dados fiscais</h4>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Identificação e configuração tributária da empresa emitente. Nenhum dado tributário será inferido pelo Kyrub.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-2">
        <ShieldCheck className="w-5 h-5 text-emerald-400" />
        <h4 className="text-xs font-black text-white uppercase">Situação da emissão</h4>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          A loja só poderá emitir após preparação, validação e autorização explícita do fluxo fiscal.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-2">
        <ReceiptText className="w-5 h-5 text-violet-400" />
        <h4 className="text-xs font-black text-white uppercase">Documentos fiscais</h4>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Autorizações, rejeições e cancelamentos aparecerão aqui somente a partir de evidência autoritativa do serviço fiscal.
        </p>
      </div>
    </div>

    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h4 className="text-xs font-black text-white uppercase">Configurar Emissor Fiscal Kyrub</h4>
        <p className="text-[10px] text-slate-400 mt-1 max-w-xl">
          O provedor fiscal é gerenciado pelo Kyrub no backstage. A loja configura somente os dados e requisitos da própria empresa.
        </p>
      </div>
      <button
        type="button"
        onClick={onStartOnboarding}
        disabled={!onStartOnboarding}
        className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        Configurar emissão fiscal
      </button>
    </div>
  </div>
);
