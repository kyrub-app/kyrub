/**
 * Kyrub Logistics & Active Sessions Concurrency Manager
 * Implements db.runTransaction() atomic operations to prevent staff/customer race conditions.
 */
import { 
  Firestore, 
  doc, 
  runTransaction,
  Timestamp 
} from 'firebase/firestore';

export interface ActiveSession {
  id: string;
  locationIdentifier: string | number;
  status: 'open' | 'closing' | 'closed';
  currentBill: number;
  staffId: string;
  lastUpdated: Timestamp | Date | string;
  itemsCount: number;
}

export interface TransactionStepLog {
  timestamp: string;
  step: string;
  details: string;
  status: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Atomic checkout closure for active sessions (tables, fitting rooms, collection spots)
 * Uses runTransaction to prevent concurrent staff edits or simultaneous customer mobile orders.
 */
export async function closeActiveSessionTransaction(
  db: any, // Firestore or mock db
  tenantId: string,
  sessionId: string,
  staffId: string,
  onStepLogged?: (log: TransactionStepLog) => void
): Promise<{ success: boolean; finalBill: number; transactionLog: TransactionStepLog[] }> {
  const steps: TransactionStepLog[] = [];
  const addStep = (step: string, details: string, status: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const log: TransactionStepLog = { timestamp: new Date().toLocaleTimeString(), step, details, status };
    steps.push(log);
    if (onStepLogged) onStepLogged(log);
  };

  addStep('Iniciar Transação', `Buscando sessão ativa ${sessionId} para o Tenant: ${tenantId}...`, 'info');

  try {
    // If it is a simulated database (for browser-side playground) or standard Firestore
    if (!db || typeof db.runTransaction !== 'function') {
      addStep('Modo Simulado', 'Detectado banco local para simulação no browser. Iniciando lock atômico...', 'warning');
      
      // Simulate transaction read-write pipeline with random latency
      await new Promise(resolve => setTimeout(resolve, 600));
      addStep('Leitura Atômica', 'Sessão lida com status "open" e Bill = R$ 289.90', 'info');
      
      await new Promise(resolve => setTimeout(resolve, 400));
      addStep('Mutex Guard', 'Validando que nenhum outro atendente editou a conta nos últimos 5ms...', 'success');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      addStep('Commit de Estado', 'Sessão atualizada para "closed". Balanço finalizado com sucesso.', 'success');
      
      return { success: true, finalBill: 289.90, transactionLog: steps };
    }

    // REAL FIRESTORE TRANSACTION PATHWAY
    const result = await runTransaction(db as Firestore, async (transaction) => {
      const sessionDocRef = doc(db as Firestore, `tenants/${tenantId}/active_sessions`, sessionId);
      
      addStep('Leitura Firestore', 'Realizando leitura estrita do documento na transação...', 'info');
      const sessionSnap = await transaction.get(sessionDocRef);
      
      if (!sessionSnap.exists()) {
        addStep('Erro de Validação', 'Sessão ativa não encontrada.', 'error');
        throw new Error('Sessão ativa não encontrada.');
      }

      const sessionData = sessionSnap.data() as ActiveSession;
      addStep('Análise de Estado', `Local ${sessionData.locationIdentifier} lido. Status atual: ${sessionData.status}`, 'info');

      // Prevent closing an already closed or closing session concurrently
      if (sessionData.status === 'closed') {
        addStep('Bloqueio de Concorrência', 'Sessão já foi finalizada por outro atendente/cliente!', 'error');
        throw new Error('Esta sessão já foi finalizada por outro dispositivo.');
      }

      const finalBill = sessionData.currentBill;
      addStep('Escrita de Estado', `Atualizando sessão para "closed". Atendente: ${staffId}`, 'info');

      // Update the document atomically
      transaction.update(sessionDocRef, {
        status: 'closed',
        staffId: staffId,
        lastUpdated: new Date().toISOString()
      });

      addStep('Transação Commited', `Sessão gravada com sucesso! Total: R$ ${finalBill.toFixed(2)}`, 'success');
      return { success: true, finalBill };
    });

    return { ...result, transactionLog: steps };

  } catch (error: any) {
    addStep('Abortar Transação', `Transação revertida de forma segura: ${error.message || error}`, 'error');
    return { success: false, finalBill: 0, transactionLog: steps };
  }
}
