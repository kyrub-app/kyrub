/**
 * Kyrub Central Observability & External API Logger
 * Provides telemetry and centralized structured logging of external API breakdowns (e.g. deliveryBridge, baasController).
 */

export interface SystemErrorLog {
  id: string;
  timestamp: string;
  sourceModule: 'deliveryBridge' | 'baasController' | 'paymentController' | 'geminiAPI';
  errorType: 'API_TIMEOUT' | 'GATEWAY_ERROR' | 'AUTH_FAILURE' | 'RATE_LIMIT' | 'DATABASE_FAIL';
  endpoint: string;
  payloadSent: any;
  errorMessage: string;
  httpStatus?: number;
  severity: 'warning' | 'error' | 'critical';
  resolved: boolean;
}

// Memory database of logs (for simulation in UI)
let errorLogDatabase: SystemErrorLog[] = [
  {
    id: "err-baas-1",
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
    sourceModule: "baasController",
    errorType: "GATEWAY_ERROR",
    endpoint: "https://api.bancofator.com.br/v2/split",
    payloadSent: { split: { supplier: "70%", platform: "30%" }, orderId: "ord-b2b-1" },
    errorMessage: "Banco Fator Gateway split API returned 502 Bad Gateway - Timeout connecting to ledger.",
    httpStatus: 502,
    severity: "critical",
    resolved: false
  },
  {
    id: "err-del-1",
    timestamp: new Date(Date.now() - 1800000).toISOString(), // 30 mins ago
    sourceModule: "deliveryBridge",
    errorType: "API_TIMEOUT",
    endpoint: "https://api.melhorenvio.com/v1/shipment/calculate",
    payloadSent: { origin: "01001-000", destination: "20040-002", weight: 1.5 },
    errorMessage: "Melhor Envio shipping calculate gateway timed out after 10000ms.",
    httpStatus: 504,
    severity: "error",
    resolved: false
  }
];

/**
 * Centrally log any critical external API failure
 */
export function logExternalAPIFailure(
  sourceModule: 'deliveryBridge' | 'baasController' | 'paymentController' | 'geminiAPI',
  errorType: 'API_TIMEOUT' | 'GATEWAY_ERROR' | 'AUTH_FAILURE' | 'RATE_LIMIT' | 'DATABASE_FAIL',
  endpoint: string,
  payload: any,
  errorMessage: string,
  httpStatus?: number,
  severity: 'warning' | 'error' | 'critical' = 'error'
): SystemErrorLog {
  const newLog: SystemErrorLog = {
    id: `err-${sourceModule.slice(0, 3)}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    sourceModule,
    errorType,
    endpoint,
    payloadSent: payload,
    errorMessage,
    httpStatus,
    severity,
    resolved: false
  };

  errorLogDatabase = [newLog, ...errorLogDatabase];
  console.error(`[Kyrub Observability] [${severity.toUpperCase()}] Error in ${sourceModule}: ${errorMessage}`, {
    endpoint,
    errorType,
    httpStatus
  });

  return newLog;
}

/**
 * Returns all active system logs
 */
export function getSystemErrorLogs(): SystemErrorLog[] {
  return errorLogDatabase;
}

/**
 * Resolve an error log
 */
export function resolveErrorLog(id: string): void {
  errorLogDatabase = errorLogDatabase.map(l => l.id === id ? { ...l, resolved: true } : l);
}

/**
 * Clear all logs
 */
export function clearErrorLogs(): void {
  errorLogDatabase = [];
}
