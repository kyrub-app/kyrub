import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const EXPECTED_PROJECT_ID = 'kyrub-b8d0e';
const DATABASE_ID = '(default)';
const CONFIRMATION_PHRASE = 'CREATE-FIRST-SUPER-ADMIN';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const usage = `
Uso seguro (simulação por padrão):
  npm run admin:bootstrap:first-super-admin -- \\
    --project ${EXPECTED_PROJECT_ID} \\
    --confirm-project ${EXPECTED_PROJECT_ID} \\
    --uid <FIREBASE_UID> \\
    --email <EMAIL_DA_CONTA> \\
    --display-name "<NOME>"

Para aplicar de verdade, acrescente:
  --apply --confirm-action ${CONFIRMATION_PHRASE}

Pré-requisitos:
  1. Google Cloud CLI instalada.
  2. ADC configurado com: gcloud auth application-default login
  3. A identidade ADC precisa poder ler usuários do Firebase Auth e gravar no Firestore.
`;

const parseArgs = argv => {
  const result = { apply: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--apply') {
      result.apply = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Argumento inesperado: ${token}`);
    }

    const key = token.slice(2).replaceAll('-', '_');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Valor ausente para ${token}`);
    }

    result[key] = value;
    index += 1;
  }

  return result;
};

const fail = message => {
  console.error(`\nERRO: ${message}\n`);
  process.exitCode = 1;
};

const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
const stringValue = value => ({ stringValue: String(value) });
const timestampValue = value => ({ timestampValue: value });

const runGcloud = args => {
  const executable = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

  try {
    return execFileSync(executable, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    throw new Error(
      stderr ||
        'Não foi possível executar a Google Cloud CLI. Confirme que gcloud está instalado e disponível no PATH.'
    );
  }
};

const getAccessToken = () => {
  const token = runGcloud(['auth', 'application-default', 'print-access-token']);
  if (!token) {
    throw new Error(
      'ADC não retornou token. Execute gcloud auth application-default login.'
    );
  }
  return token;
};

const getOperatorAccount = () => {
  try {
    const account = runGcloud(['config', 'get-value', 'account', '--quiet']);
    return account && account !== '(unset)' ? account : 'adc-principal-unavailable';
  } catch {
    return 'adc-principal-unavailable';
  }
};

const requestJson = async (url, accessToken, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const apiMessage =
      data && typeof data === 'object'
        ? data.error?.message || data.message
        : String(data ?? '');
    const error = new Error(
      `${response.status} ${response.statusText}${apiMessage ? `: ${apiMessage}` : ''}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

const verifyFirebaseAuthAccount = async ({ projectId, uid, email, accessToken }) => {
  const endpoint = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/accounts:lookup`;

  const result = await requestJson(endpoint, accessToken, {
    method: 'POST',
    body: JSON.stringify({ localId: [uid] }),
  });

  const users = Array.isArray(result?.users) ? result.users : [];
  if (users.length !== 1) {
    throw new Error(`Nenhuma conta Firebase Auth única foi encontrada para o UID ${uid}.`);
  }

  const account = users[0];
  const authEmail = normalizeEmail(account.email);
  if (authEmail !== email) {
    throw new Error(
      `O e-mail informado (${email}) não corresponde ao Firebase Auth (${authEmail || 'ausente'}).`
    );
  }

  if (account.emailVerified !== true) {
    throw new Error('A conta Firebase Auth existe, mas o e-mail ainda não está verificado.');
  }

  return {
    uid: String(account.localId),
    email: authEmail,
    displayName: String(account.displayName ?? '').trim(),
    emailVerified: true,
  };
};

const findExistingSuperAdmin = async ({ projectId, accessToken }) => {
  const parent = `projects/${projectId}/databases/${DATABASE_ID}/documents/kyrub_admin/control_plane`;
  const endpoint = `https://firestore.googleapis.com/v1/${parent}:runQuery`;
  const result = await requestJson(endpoint, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'admins' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'role' },
            op: 'EQUAL',
            value: { stringValue: 'super_admin' },
          },
        },
        limit: 1,
      },
    }),
  });

  const rows = Array.isArray(result) ? result : [];
  return rows.find(row => row?.document)?.document ?? null;
};

const documentName = (projectId, path) =>
  `projects/${projectId}/databases/${DATABASE_ID}/documents/${path}`;

const createBootstrapWrites = ({
  projectId,
  uid,
  email,
  displayName,
  operatorAccount,
  requestId,
  createdAt,
}) => {
  const adminName = documentName(
    projectId,
    `kyrub_admin/control_plane/admins/${uid}`
  );
  const lockName = documentName(
    projectId,
    'kyrub_admin/control_plane/bootstrap/first_super_admin'
  );
  const auditId = `bootstrap_${requestId}`;
  const auditName = documentName(
    projectId,
    `kyrub_admin/control_plane/audit_logs/${auditId}`
  );

  return [
    {
      update: {
        name: lockName,
        fields: {
          type: stringValue('first_super_admin'),
          status: stringValue('completed'),
          projectId: stringValue(projectId),
          targetUid: stringValue(uid),
          targetEmail: stringValue(email),
          provisionedBy: stringValue(operatorAccount),
          requestId: stringValue(requestId),
          createdAt: timestampValue(createdAt),
        },
      },
      currentDocument: { exists: false },
    },
    {
      update: {
        name: adminName,
        fields: {
          uid: stringValue(uid),
          email: stringValue(email),
          displayName: stringValue(displayName),
          role: stringValue('super_admin'),
          status: stringValue('active'),
          createdBy: stringValue(operatorAccount),
          createdAt: timestampValue(createdAt),
          updatedAt: timestampValue(createdAt),
          suspendedAt: stringValue(''),
          revokedAt: stringValue(''),
        },
      },
      currentDocument: { exists: false },
    },
    {
      update: {
        name: auditName,
        fields: {
          id: stringValue(auditId),
          requestId: stringValue(requestId),
          action: stringValue('admin.bootstrap.first_super_admin.created'),
          actorId: stringValue(operatorAccount),
          actorRole: stringValue('bootstrap_operator'),
          targetType: stringValue('admin'),
          targetId: stringValue(uid),
          source: stringValue('bootstrap'),
          outcome: stringValue('success'),
          projectId: stringValue(projectId),
          createdAt: timestampValue(createdAt),
        },
      },
      currentDocument: { exists: false },
    },
  ];
};

const commitBootstrap = async ({ projectId, accessToken, writes }) => {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${DATABASE_ID}/documents:commit`;

  return requestJson(endpoint, accessToken, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });
};

const readAdminDocument = async ({ projectId, uid, accessToken }) => {
  const name = documentName(
    projectId,
    `kyrub_admin/control_plane/admins/${uid}`
  );
  const endpoint = `https://firestore.googleapis.com/v1/${name}`;
  return requestJson(endpoint, accessToken);
};

const fieldString = (document, field) =>
  String(document?.fields?.[field]?.stringValue ?? '');

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const projectId = String(args.project ?? '').trim();
  const confirmedProject = String(args.confirm_project ?? '').trim();
  const uid = String(args.uid ?? '').trim();
  const email = normalizeEmail(args.email);
  const displayName = String(args.display_name ?? '').trim();
  const confirmation = String(args.confirm_action ?? '').trim();

  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Este script aceita somente o projeto ${EXPECTED_PROJECT_ID}. Recebido: ${projectId || 'ausente'}.`
    );
  }
  if (confirmedProject !== EXPECTED_PROJECT_ID) {
    throw new Error(`Confirme o projeto com --confirm-project ${EXPECTED_PROJECT_ID}.`);
  }
  if (!SAFE_ID.test(uid)) {
    throw new Error('UID inválido. Use de 1 a 128 caracteres: letras, números, _ ou -.');
  }
  if (!EMAIL.test(email) || email.length > 254) {
    throw new Error('E-mail inválido.');
  }
  if (!displayName || displayName.length > 120) {
    throw new Error('Informe --display-name com até 120 caracteres.');
  }
  if (args.apply && confirmation !== CONFIRMATION_PHRASE) {
    throw new Error(
      `Para aplicar, confirme com --confirm-action ${CONFIRMATION_PHRASE}.`
    );
  }

  console.log(`\nProjeto fixado: ${projectId}`);
  console.log(`Modo: ${args.apply ? 'APLICAÇÃO REAL' : 'SIMULAÇÃO (nenhuma gravação)'}`);
  console.log(`UID alvo: ${uid}`);
  console.log(`E-mail alvo: ${email}`);

  const operatorAccount = getOperatorAccount();
  console.log(`Conta gcloud ativa (referência de auditoria): ${operatorAccount}`);

  const accessToken = getAccessToken();
  const authAccount = await verifyFirebaseAuthAccount({
    projectId,
    uid,
    email,
    accessToken,
  });
  console.log('Firebase Auth: conta encontrada, e-mail correspondente e verificado.');

  const existingSuperAdmin = await findExistingSuperAdmin({ projectId, accessToken });
  if (existingSuperAdmin) {
    const existingUid = fieldString(existingSuperAdmin, 'uid') || 'desconhecido';
    throw new Error(
      `Já existe um Super Admin no projeto (UID ${existingUid}). O bootstrap inicial foi bloqueado.`
    );
  }
  console.log('Firestore: nenhum Super Admin existente foi encontrado.');

  const effectiveDisplayName = displayName || authAccount.displayName;
  const requestId = randomUUID().replaceAll('-', '_');
  const createdAt = new Date().toISOString();
  const writes = createBootstrapWrites({
    projectId,
    uid,
    email,
    displayName: effectiveDisplayName,
    operatorAccount,
    requestId,
    createdAt,
  });

  if (!args.apply) {
    console.log('\nSIMULAÇÃO APROVADA:');
    console.log('- nenhuma escrita foi executada;');
    console.log('- a conta Firebase Auth foi validada;');
    console.log('- nenhum Super Admin existente foi encontrado;');
    console.log('- o modo real criará lock, perfil e auditoria em um único commit atômico.');
    console.log(`\n${usage.trim()}\n`);
    return;
  }

  await commitBootstrap({ projectId, accessToken, writes });
  const saved = await readAdminDocument({ projectId, uid, accessToken });

  if (
    fieldString(saved, 'uid') !== uid ||
    fieldString(saved, 'email') !== email ||
    fieldString(saved, 'role') !== 'super_admin' ||
    fieldString(saved, 'status') !== 'active'
  ) {
    throw new Error(
      'O commit respondeu com sucesso, mas a verificação final do perfil administrativo falhou.'
    );
  }

  console.log('\nSUCESSO: primeiro Super Admin provisionado.');
  console.log(`Documento: kyrub_admin/control_plane/admins/${uid}`);
  console.log('Lock e auditoria foram criados no mesmo commit atômico.');
  console.log('Saia do painel e entre novamente com a mesma conta Google.\n');
};

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error));
  console.error(usage);
});
