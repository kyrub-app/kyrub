export interface OperationsReadinessReport {
  ready: boolean;
  checkedAt: string;
  projectId: string;
  publicAppUrl: string;
  authentication:
    | 'application-default-credentials'
    | 'service-account-json'
    | 'não configurada';
  endpoints: {
    ingressDrain: string;
    pollAll: string;
    deliveryFallback: string;
    applicationHealth: string;
    adminHealth: string;
  };
  schedules: {
    ingressDrain: string;
    pollAll: string;
    deliveryFallback: string;
  };
  issues: string[];
  warnings: string[];
}

export function evaluateOperationsReadiness(
  environment?: Record<string, string | undefined>
): OperationsReadinessReport;

export function formatOperationsReadiness(
  report: OperationsReadinessReport
): string;
