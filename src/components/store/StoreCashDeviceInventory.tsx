import { useCallback, useEffect, useState } from 'react';
import { auth } from '../../utils/firebase';

type BrowserInventory = {
  browserKey: string;
  reporterCount: number;
  reportedAt: string;
  pendingOperations: number;
  openSessions: number;
  needsAttention: boolean;
  legacyUnlinked: boolean;
};

type InventoryResponse = {
  discovery: 'submitted-reports-only';
  readOnly: true;
  selfReported: true;
  cutoverApproved: false;
  allBrowsersKnown: false;
  observedBrowsers: number;
  reportingCollaborators: number;
  withReportedPending: number;
  withoutReportedPending: number;
  legacyUnlinkedReports: number;
  browsers: BrowserInventory[];
};

const reportTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Data não disponível';
};

export default function StoreCashDeviceInventory({ storeId }: { storeId: string }) {
  const [report, setReport] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Faça login para consultar o inventário.');
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/local-attendance/cash-registers/device-inspections?storeId=${encodeURIComponent(storeId)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      const result = await response.json() as InventoryResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar as declarações.');
      if (result.discovery !== 'submitted-reports-only' ||
        result.cutoverApproved !== false ||
        result.allBrowsersKnown !== false ||
        !Array.isArray(result.browsers)) {
        throw new Error('Resposta do inventário sem garantias de segurança.');
      }
      setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar as declarações.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mt-4 min-w-0 rounded-2xl border border-cyan-500/20 bg-slate-950 p-4"
      data-kyrub-cash-manager-inventory="submitted-only">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h5 className="text-xs font-black uppercase text-white">Conferência de dispositivos</h5>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Inventário automático dos navegadores que enviaram declarações. A equipe pode usar seus próprios celulares; não há cadastro ou compra de aparelhos exigidos.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded-xl border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-200 disabled:opacity-50">
          Atualizar
        </button>
      </div>
      {loading ? <p className="mt-3 text-xs text-slate-400">Consultando as declarações…</p> :
        error ? <p className="mt-3 text-xs text-rose-300">{error}</p> :
        report && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Navegadores relatados', report.observedBrowsers],
                ['Colaboradores que enviaram', report.reportingCollaborators],
                ['Com pendências declaradas', report.withReportedPending],
                ['Sem pendências declaradas', report.withoutReportedPending],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-800 p-3">
                  <span className="block text-[10px] text-slate-400">{label}</span>
                  <strong className="mt-1 block text-base text-white">{value}</strong>
                </div>
              ))}
            </div>
            {report.legacyUnlinkedReports > 0 && (
              <p className="mt-3 text-[10px] text-amber-200">
                {report.legacyUnlinkedReports} relatório(s) anterior(es) ainda sem vínculo seguro entre colaboradores e navegador; podem contar o mesmo aparelho mais de uma vez.
              </p>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-amber-200">
              Só aparecem navegadores que já enviaram relatórios. Outros celulares ou navegadores são desconhecidos, portanto não há uma contagem confiável de dispositivos faltantes. Nenhum relatório autoriza a migração.
            </p>
            {report.browsers.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-4 text-xs text-slate-400">
                Nenhuma declaração de aparelho recebida até agora.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {report.browsers.map((browser, index) => (
                  <div key={browser.browserKey} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 p-3 text-[10px]">
                    <div className="min-w-0">
                      <p className="font-bold text-white">
                        Navegador relatado {index + 1}
                        {browser.legacyUnlinked ? ' · relato anterior sem vínculo' : ''}
                      </p>
                      <p className="mt-1 text-slate-400">
                        {browser.reporterCount} colaborador(es) · Última declaração: {reportTime(browser.reportedAt)}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className={browser.needsAttention ? 'font-bold text-amber-200' : 'font-bold text-cyan-200'}>
                        {browser.needsAttention ? 'Requer conferência' : 'Sem pendências declaradas'}
                      </p>
                      <p className="mt-1 text-slate-400">
                        {browser.pendingOperations} pendência(s) · {browser.openSessions} sessão(ões) local(is) aberta(s)
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </section>
  );
}
