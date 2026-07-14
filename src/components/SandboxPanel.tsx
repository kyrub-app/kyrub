import React, { useState, useEffect } from 'react';
import { 
  Layers, Database, Terminal, Activity, RefreshCw, 
  MessageSquare, Sparkles, ShieldCheck, AlertTriangle, 
  DollarSign, Check, Trash2, ArrowRight, UserCheck 
} from 'lucide-react';
import { closeActiveSessionTransaction, TransactionStepLog } from '../utils/logisticManager';
import { syncOfflineBatch, resolveConflictLWW, SyncRecord, SyncConflict } from '../utils/syncEngine';
import { logExternalAPIFailure, getSystemErrorLogs, resolveErrorLog, clearErrorLogs, SystemErrorLog } from '../utils/observability';
import { processPaymentAndLogAudit, calculatePaymentSplit, PaymentAuditLog, SplitResult } from '../utils/paymentController';

export const SandboxPanel: React.FC = () => {
  // ---------------------------------------------
  // PILAR 1: FIRESTORE TRANSACTION CONCURRENCY STATE
  // ---------------------------------------------
  const [sessionStatus, setSessionStatus] = useState<'open' | 'closed'>('open');
  const [concurrencyLogs, setConcurrencyLogs] = useState<TransactionStepLog[]>([]);
  const [isProcessingTx, setIsProcessingTx] = useState(false);

  const triggerConcurrentTransactions = async () => {
    setIsProcessingTx(true);
    setConcurrencyLogs([]);
    setSessionStatus('open');

    // Simulate Staff A and Staff B executing closeActiveSessionTransaction concurrently
    const mockStepLogged = (log: TransactionStepLog) => {
      setConcurrencyLogs(prev => [...prev, log]);
    };

    // Run close active session transaction simulation
    const result = await closeActiveSessionTransaction(null, 'tenant_restaurante', 'provador_04', 'atendente_A', mockStepLogged);
    if (result.success) {
      setSessionStatus('closed');
    }
    setIsProcessingTx(false);
  };

  // ---------------------------------------------
  // PILAR 1.2: OFFLINE SYNC ENGINE STATE
  // ---------------------------------------------
  const [localDexieDb, setLocalDexieDb] = useState<SyncRecord[]>([
    { id: 'prod-01', name: 'Mochila Impermeável', price: 189.90, stock: 45, category: 'Moda', updatedAt: '2026-07-10T10:00:00Z' },
    { id: 'prod-02', name: 'Garrafa Térmica 1L', price: 120.00, stock: 120, category: 'Acessórios', updatedAt: '2026-07-10T09:30:00Z' }
  ]);

  const [remoteFirestoreDb, setRemoteFirestoreDb] = useState<SyncRecord[]>([
    { id: 'prod-01', name: 'Mochila Impermeável (Server)', price: 199.90, stock: 42, category: 'Moda', updatedAt: '2026-07-10T10:15:00Z' }, // Server is newer
    { id: 'prod-02', name: 'Garrafa Térmica 1L', price: 115.00, stock: 120, category: 'Acessórios', updatedAt: '2026-07-10T09:00:00Z' } // Local is newer
  ]);

  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);

  const handleSyncOffline = async () => {
    const result = await syncOfflineBatch(localDexieDb, remoteFirestoreDb);
    setSyncLogs(result.logs);
    setSyncConflicts(result.conflicts);

    // Apply the resolution locally and remotely
    setLocalDexieDb(result.syncedRecords);
    setRemoteFirestoreDb(result.syncedRecords);
  };

  const handleEditLocalPrice = (id: string, newPrice: number) => {
    setLocalDexieDb(prev => prev.map(item => item.id === id ? {
      ...item,
      price: newPrice,
      updatedAt: new Date().toISOString() // Set updatedAt to NOW
    } : item));
  };

  const handleEditRemotePrice = (id: string, newPrice: number) => {
    setRemoteFirestoreDb(prev => prev.map(item => item.id === id ? {
      ...item,
      price: newPrice,
      updatedAt: new Date().toISOString() // Set updatedAt to NOW
    } : item));
  };

  // ---------------------------------------------
  // PILAR 2: CENTRAL OBSERVABILITY TELEMETRY STATE
  // ---------------------------------------------
  const [apiLogs, setApiLogs] = useState<SystemErrorLog[]>(getSystemErrorLogs());

  const triggerMockApiFailure = (module: 'deliveryBridge' | 'baasController') => {
    if (module === 'deliveryBridge') {
      logExternalAPIFailure(
        'deliveryBridge',
        'API_TIMEOUT',
        'https://api.melhorenvio.com/v1/shipment/calculate',
        { origin: '01310-100', destination: '80010-010', weight: 1.2 },
        'Timeout de conexão com o Melhor Envio após 10000ms.',
        504,
        'error'
      );
    } else {
      logExternalAPIFailure(
        'baasController',
        'GATEWAY_ERROR',
        'https://api.bancofator.com.br/v2/split',
        { paymentId: 'pay-77c8', supplierId: 't-1', amount: 399 },
        'Erro na integração Banco Fator. Gateway recusou split por payload corrompido.',
        422,
        'critical'
      );
    }
    setApiLogs(getSystemErrorLogs());
  };

  const handleResolveLog = (id: string) => {
    resolveErrorLog(id);
    setApiLogs(getSystemErrorLogs());
  };

  const handleClearLogs = () => {
    clearErrorLogs();
    setApiLogs([]);
  };

  // ---------------------------------------------
  // PILAR 2.2: AUDIT LOG LEDGER STATE
  // ---------------------------------------------
  const [orderTotal, setOrderTotal] = useState<number>(399.0);
  const [b2bItems, setB2bItems] = useState<any[]>([
    { productId: 'p-b2b-1', name: 'Fone de Ouvido Kyrub Sound', price: 399.0, wholesalePrice: 199.0, quantity: 1 }
  ]);
  const [auditLedger, setAuditLedger] = useState<PaymentAuditLog[]>([]);

  const handleProcessSplitAndAudit = async () => {
    const result = await processPaymentAndLogAudit(
      null, // Mock DB mode
      'tenant_varejo_1',
      `ord-b2b2c-${Date.now().toString().slice(-4)}`,
      orderTotal,
      b2bItems,
      'cliente@gmail.com',
      'credit_card'
    );

    if (result.success && result.auditLog) {
      setAuditLedger(prev => [result.auditLog!, ...prev]);
    }
  };

  // ---------------------------------------------
  // PILAR 5: SECURE & RATE-LIMITED GEMINI STATE
  // ---------------------------------------------
  const [geminiQuery, setGeminiQuery] = useState('');
  const [geminiResponse, setGeminiResponse] = useState('');
  const [isQueryingGemini, setIsQueryingGemini] = useState(false);
  const [minuteRequestCount, setMinuteRequestCount] = useState(0);

  // Poll server health or simply use our rate counter
  useEffect(() => {
    // Reset rate counter every 1 minute
    const interval = setInterval(() => {
      setMinuteRequestCount(0);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const askMentorKyrub = async () => {
    if (!geminiQuery.trim()) return;
    setIsQueryingGemini(true);
    setMinuteRequestCount(prev => prev + 1);

    try {
      const response = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: geminiQuery })
      });

      const data = await response.json();
      if (data.error) {
        setGeminiResponse(`[REJEITADO PELO GATEWAY] ${data.error}`);
      } else {
        setGeminiResponse(data.text);
      }
    } catch (err: any) {
      setGeminiResponse(`Erro ao contatar servidor de segurança Kyrub: ${err.message}`);
    } finally {
      setIsQueryingGemini(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in" id="architect-sandbox-container">
      <div>
        <span className="text-xs font-semibold tracking-wider text-purple-400 uppercase font-mono">Ambiente de Testes do Engenheiro</span>
        <h2 className="text-3xl font-black text-white tracking-tight">Arquitetura de Produção Kyrub</h2>
        <p className="text-slate-400 text-sm mt-1">
          Inspecione os mecanismos de isolamento, transações concorrentes do Firestore, sincronização offline LWW, logs de auditoria e limitação de taxa da API Gemini.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* PILAR 1: FIRESTORE TRANSACTION CONCURRENCY */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="pilar-concurrency">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Concorrência no Firestore: db.runTransaction()</span>
            </h3>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
              sessionStatus === 'open' ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'
            }`}>
              Provador 04 / Mesa 12: {sessionStatus === 'open' ? 'Ativo / R$ 289.90' : 'Finalizado'}
            </span>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            Garante atomicidade estrita no encerramento de comandas e sessões ativas (mesas de restaurantes, provadores inteligentes ou vagas Click & Collect), bloqueando condições de corrida quando atendentes e clientes tentam ler ou escrever simultaneamente.
          </p>

          <div className="flex gap-4">
            <button
              onClick={triggerConcurrentTransactions}
              disabled={isProcessingTx}
              className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Activity className="w-4 h-4" />
              <span>Simular Acesso Simultâneo</span>
            </button>
            <button
              onClick={() => { setSessionStatus('open'); setConcurrencyLogs([]); }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-2.5 rounded-xl text-xs transition-all"
            >
              Resetar Sessão
            </button>
          </div>

          {/* Terminal output */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs space-y-2 max-h-[220px] overflow-y-auto" id="concurrency-terminal">
            <div className="text-slate-500 flex items-center gap-1"><Terminal className="w-3.5 h-3.5" /> Terminal de Concorrência</div>
            {concurrencyLogs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[10px] text-slate-600">{log.timestamp}</span>
                <span className={`font-bold uppercase text-[9px] px-1 rounded ${
                  log.status === 'success' ? 'bg-emerald-950/80 text-emerald-400' :
                  log.status === 'error' ? 'bg-red-950/80 text-red-400' :
                  log.status === 'warning' ? 'bg-yellow-950/80 text-yellow-400' : 'bg-slate-900 text-slate-400'
                }`}>{log.step}</span>
                <span className="text-slate-300">{log.details}</span>
              </div>
            ))}
            {concurrencyLogs.length === 0 && (
              <p className="text-slate-600 italic">Pronto para disparar transações concorrentes...</p>
            )}
          </div>
        </div>

        {/* PILAR 1.2: OFFLINE SYNC ENGINE */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="pilar-sync">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" />
            <span>Dexie Sync Engine: Last-Write-Wins (LWW)</span>
          </h3>
          <p className="text-slate-400 text-xs leading-relaxed">
            Resolução determinística de conflitos locais e em nuvem usando marcas de data e hora do campo <code className="text-purple-400 font-mono">updatedAt</code>.
          </p>

          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            {/* Local DB */}
            <div className="space-y-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-indigo-400 font-bold uppercase">Dexie DB (Local)</span>
              {localDexieDb.map(item => (
                <div key={item.id} className="border-b border-slate-900 pb-2 last:border-0 last:pb-0 space-y-1">
                  <div className="flex justify-between text-white font-bold">
                    <span>{item.name}</span>
                    <span className="text-indigo-400">R$ {item.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <button 
                      onClick={() => handleEditLocalPrice(item.id, Number((item.price + 5).toFixed(2)))}
                      className="text-indigo-400 hover:underline"
                    >
                      Editar (+R$5)
                    </button>
                    <span>{item.updatedAt.slice(11, 19)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Remote DB */}
            <div className="space-y-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-emerald-400 font-bold uppercase">Firestore (Nuvem)</span>
              {remoteFirestoreDb.map(item => (
                <div key={item.id} className="border-b border-slate-900 pb-2 last:border-0 last:pb-0 space-y-1">
                  <div className="flex justify-between text-white font-bold">
                    <span>{item.name}</span>
                    <span className="text-emerald-400">R$ {item.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <button 
                      onClick={() => handleEditRemotePrice(item.id, Number((item.price - 5).toFixed(2)))}
                      className="text-emerald-400 hover:underline"
                    >
                      Editar (-R$5)
                    </button>
                    <span>{item.updatedAt.slice(11, 19)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSyncOffline}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sincronizar Bancos de Dados</span>
          </button>

          {/* Sync output */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[11px] max-h-[160px] overflow-y-auto space-y-1 text-slate-400">
            {syncLogs.map((log, i) => (
              <p key={i} className={log.includes('CONFLITO') ? 'text-yellow-400' : 'text-slate-400'}>{log}</p>
            ))}
            {syncLogs.length === 0 && (
              <p className="text-slate-600 italic">Pronto para rodar o sync engine...</p>
            )}
          </div>
        </div>

        {/* PILAR 2: CENTRAL API OBSERVABILITY & TELEMETRY */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="pilar-observability">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <span>Observabilidade: Telemetria de Falhas de API</span>
            </h3>
            <button
              onClick={handleClearLogs}
              className="text-[10px] font-bold text-red-400 hover:underline flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Limpar Logs
            </button>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            Centraliza erros críticos de chamadas de APIs externas (Melhor Envio / Banco Fator), gerando dashboards operacionais em tempo real sem expor dados internos de rede.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => triggerMockApiFailure('deliveryBridge')}
              className="flex-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 font-semibold py-2 rounded-lg text-[10px] transition-all"
            >
              Forçar Erro: Melhor Envio API
            </button>
            <button
              onClick={() => triggerMockApiFailure('baasController')}
              className="flex-1 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 font-semibold py-2 rounded-lg text-[10px] transition-all"
            >
              Forçar Erro: Banco Fator Split API
            </button>
          </div>

          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
            {apiLogs.map(log => (
              <div key={log.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      log.severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500'
                    }`} />
                    <span className="text-[10px] font-bold font-mono uppercase text-slate-300">{log.sourceModule}</span>
                  </div>
                  <span className="font-mono text-[9px] text-slate-500">{log.id}</span>
                </div>
                <p className="text-xs text-red-400 font-mono">{log.errorMessage}</p>
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-900">
                  <span>Endpoint: {log.endpoint.slice(0, 35)}...</span>
                  {log.resolved ? (
                    <span className="text-emerald-500 font-bold">✓ Resolvido</span>
                  ) : (
                    <button
                      onClick={() => handleResolveLog(log.id)}
                      className="text-purple-400 hover:underline font-bold"
                    >
                      Resolver
                    </button>
                  )}
                </div>
              </div>
            ))}

            {apiLogs.length === 0 && (
              <p className="text-center text-slate-500 text-xs py-8">Nenhum erro registrado na telemetria.</p>
            )}
          </div>
        </div>

        {/* PILAR 2.2: AUDIT LOGS LEDGER (PAYMENT SPLITS) */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="pilar-audit-logs">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            <span>Compliance: Auditoria Imutável de Splits</span>
          </h3>
          <p className="text-slate-400 text-xs leading-relaxed">
            Cada split de transação escreve automaticamente uma prova imutável na subcoleção <code className="text-purple-400 font-mono">audit_logs</code>. Regras de segurança Firestore vetam qualquer edição ou deleção deste histórico para auditoria contábil.
          </p>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Ordem Simulada de Fone ANC</span>
                <span className="text-sm font-bold text-white">Venda B2C de R$ 399.00</span>
              </div>
              <button
                onClick={handleProcessSplitAndAudit}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all cursor-pointer"
              >
                Processar Split & Registrar
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center text-[10px] font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-900">
              <div className="border-r border-slate-800">
                <span className="text-slate-500 block">Comissão Kyrub (10%)</span>
                <strong className="text-yellow-500">R$ 39.90</strong>
              </div>
              <div className="border-r border-slate-800">
                <span className="text-slate-500 block">Repasse Fornecedor</span>
                <strong className="text-indigo-400">R$ 199.00</strong>
              </div>
              <div>
                <span className="text-slate-500 block">Lucro Varejista (Net)</span>
                <strong className="text-emerald-400">R$ 160.10</strong>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[170px] overflow-y-auto pr-1">
            {auditLedger.map(log => (
              <div key={log.id} className="bg-slate-950 p-3 rounded-xl border border-emerald-950 text-[10px] font-mono text-slate-400 space-y-1.5" id={`audit-ledger-log-${log.id}`}>
                <div className="flex justify-between text-emerald-400 font-bold">
                  <span>Audit ID: {log.id}</span>
                  <span>R$ {log.postSplitState.totalAmount.toFixed(2)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-500">
                  <span>Comprador: {log.preSplitState.buyerEmail}</span>
                  <span className="text-right">Split Ativo: 100% OK</span>
                </div>
                <p className="text-[9px] text-slate-500">Audit Status: <span className="text-yellow-400 uppercase font-bold">Immutable Ledger Lock</span></p>
              </div>
            ))}

            {auditLedger.length === 0 && (
              <p className="text-center text-slate-600 text-xs py-6 italic font-mono">Nenhum log gravado no Ledger.</p>
            )}
          </div>
        </div>

      </div>

      {/* PILAR 5: PROTEÇÃO E INTEGRAÇÃO SECURE DA API DO GEMINI */}
      <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="pilar-gemini-protection">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-400" />
              <span>Pilar 5: Mentor Kyrub AI & Express Rate-Limiter (20 req/min)</span>
            </h3>
            <p className="text-slate-400 text-sm mt-1">
              Consulte nossa IA de negócios. As requisições são processadas de forma segura no servidor (Express + Node SDK) e protegidas com <code className="text-purple-400 font-mono">express-rate-limit</code> a no máximo 20 requisições/minuto por IP para controle de custos contra ataques de bot.
            </p>
          </div>

          {/* Rate Tracker Meter */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center gap-4 shrink-0 min-w-[240px]">
            <div className="flex-1 space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Taxa de IP (1 min):</span>
                <span className={minuteRequestCount >= 15 ? "text-red-400 font-bold" : "text-purple-400 font-bold"}>
                  {minuteRequestCount} / 20 reqs
                </span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${minuteRequestCount >= 15 ? 'bg-red-500' : 'bg-purple-500'}`}
                  style={{ width: `${Math.min((minuteRequestCount / 20) * 100, 100)}%` }} 
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3.5 lg:col-span-1">
            <span className="text-xs font-mono uppercase text-slate-500">Perguntas Rápidas ao Mentor:</span>
            <div className="space-y-2 flex flex-col">
              {[
                "Qual a melhor estratégia para o plano grátis Kyrub?",
                "Como o split do Banco Fator protege meu faturamento?",
                "Por que as transações no Firestore evitam erros concorrentes?",
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => setGeminiQuery(q)}
                  className="bg-slate-950 hover:bg-slate-800 border border-slate-850 p-3 rounded-xl text-left text-xs text-slate-300 transition-all font-semibold"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Pergunte ao Mentor Kyrub sobre negócios, ERP, splits e concorrência..."
                value={geminiQuery}
                onChange={(e) => setGeminiQuery(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500 font-medium"
                id="gemini-sandbox-input"
              />
              <button
                onClick={askMentorKyrub}
                disabled={isQueryingGemini}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-3 rounded-2xl text-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                id="gemini-sandbox-submit"
              >
                <Sparkles className="w-4 h-4" />
                <span>Perguntar</span>
              </button>
            </div>

            {/* AI Answer Box */}
            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 min-h-[140px] flex flex-col justify-between" id="gemini-sandbox-output">
              {isQueryingGemini ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
                  <p className="text-xs font-mono">Processando com segurança na nuvem Kyrub...</p>
                </div>
              ) : geminiResponse ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <span className="text-xs font-mono font-bold text-slate-300">Mentor Kyrub:</span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed font-sans">{geminiResponse}</p>
                </div>
              ) : (
                <p className="text-slate-500 text-xs italic my-auto text-center">Digite uma pergunta ou selecione uma sugestão para consultar o Mentor Kyrub.</p>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
