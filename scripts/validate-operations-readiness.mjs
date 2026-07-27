import { pathToFileURL } from 'node:url';

const clean = value => typeof value === 'string' ? value.trim() : '';

const isHttpsUrl = value => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const validMasterKey = value => {
  const normalized = clean(value);
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) return true;
  try {
    return Buffer.from(normalized, 'base64').length === 32;
  } catch {
    return false;
  }
};

const validServiceAccount = value => {
  if (!clean(value)) return false;
  try {
    const parsed = JSON.parse(value);
    return Boolean(
      clean(parsed.project_id) &&
      clean(parsed.client_email) &&
      clean(parsed.private_key)
    );
  } catch {
    return false;
  }
};

export const evaluateOperationsReadiness = (environment = process.env) => {
  const issues = [];
  const warnings = [];
  const publicAppUrl = clean(environment.PUBLIC_APP_URL || environment.APP_URL);
  const projectId = clean(environment.FIREBASE_PROJECT_ID);
  const cronSecret = clean(environment.INTEGRATION_CRON_SECRET);
  const hasManagedIdentity = Boolean(
    clean(environment.GOOGLE_APPLICATION_CREDENTIALS) ||
    clean(environment.K_SERVICE) ||
    clean(environment.GAE_SERVICE)
  );
  const hasServiceAccount = validServiceAccount(
    environment.FIREBASE_SERVICE_ACCOUNT_JSON
  );

  if (!isHttpsUrl(publicAppUrl)) {
    issues.push('PUBLIC_APP_URL deve ser uma URL HTTPS pública.');
  }
  if (projectId !== 'kyrub-b8d0e') {
    issues.push('FIREBASE_PROJECT_ID deve apontar para kyrub-b8d0e.');
  }
  if (!validMasterKey(environment.INTEGRATION_MASTER_KEY)) {
    issues.push(
      'INTEGRATION_MASTER_KEY deve ter 32 bytes em base64 ou 64 caracteres hexadecimais.'
    );
  }
  if (cronSecret.length < 32) {
    issues.push('INTEGRATION_CRON_SECRET deve possuir pelo menos 32 caracteres.');
  }
  if (!hasManagedIdentity && !hasServiceAccount) {
    issues.push(
      'Configure identidade gerenciada/ADC ou FIREBASE_SERVICE_ACCOUNT_JSON válido.'
    );
  }

  const pollSchedule = clean(environment.NINETY_NINE_FOOD_POLL_SCHEDULE);
  if (!pollSchedule) {
    warnings.push(
      'NINETY_NINE_FOOD_POLL_SCHEDULE não foi definido; o instalador usará */5 * * * * até a homologação informar outro intervalo.'
    );
  }
  if (!clean(environment.SCHEDULER_LOCATION)) {
    warnings.push(
      'SCHEDULER_LOCATION não foi definido; o instalador usará southamerica-east1.'
    );
  }

  const baseUrl = isHttpsUrl(publicAppUrl)
    ? publicAppUrl.replace(/\/$/, '')
    : 'https://app.kyrub.com';

  return {
    ready: issues.length === 0,
    checkedAt: new Date().toISOString(),
    projectId: projectId || 'não configurado',
    publicAppUrl: publicAppUrl || 'não configurada',
    authentication: hasManagedIdentity
      ? 'application-default-credentials'
      : hasServiceAccount
        ? 'service-account-json'
        : 'não configurada',
    endpoints: {
      ingressDrain: `${baseUrl}/api/integrations/99food/internal/drain`,
      pollAll: `${baseUrl}/api/integrations/99food/internal/poll-all`,
      deliveryFallback: `${baseUrl}/api/delivery-opportunities/internal/escalate`,
      applicationHealth: `${baseUrl}/api/health`,
      adminHealth: `${baseUrl}/api/admin/operations/health`,
    },
    schedules: {
      ingressDrain: '* * * * *',
      pollAll: pollSchedule || '*/5 * * * *',
      deliveryFallback: '* * * * *',
    },
    issues,
    warnings,
  };
};

export const formatOperationsReadiness = report => {
  const lines = [
    `Prontidão operacional: ${report.ready ? 'APROVADA' : 'BLOQUEADA'}`,
    `Projeto: ${report.projectId}`,
    `Aplicação: ${report.publicAppUrl}`,
    `Identidade Firebase: ${report.authentication}`,
  ];
  if (report.issues.length > 0) {
    lines.push('', 'Bloqueios:', ...report.issues.map(issue => `- ${issue}`));
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Avisos:', ...report.warnings.map(warning => `- ${warning}`));
  }
  lines.push('', 'Endpoints:');
  for (const [name, endpoint] of Object.entries(report.endpoints)) {
    lines.push(`- ${name}: ${endpoint}`);
  }
  return lines.join('\n');
};

const runningDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runningDirectly) {
  const report = evaluateOperationsReadiness(process.env);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatOperationsReadiness(report));
  }
  process.exitCode = report.ready ? 0 : 1;
}
