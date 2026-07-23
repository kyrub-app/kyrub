# Bootstrap do primeiro Super Admin

Este procedimento cria o primeiro perfil administrativo do Kyrub fora do navegador, usando uma identidade IAM autorizada e credenciais temporárias do Application Default Credentials (ADC).

## Garantias do script

- aceita somente o projeto `kyrub-b8d0e`;
- executa em simulação por padrão;
- valida UID, e-mail e `emailVerified` no Firebase Auth;
- bloqueia a execução se já existir um `super_admin`;
- exige confirmação adicional para o modo real;
- cria lock, perfil e auditoria em um único commit atômico;
- usa precondição `exists: false` nos três documentos;
- não grava nem versiona credenciais;
- não altera regras do Firestore;
- não cria Functions nem habilita mutações administrativas.

## Caminhos criados no modo real

```text
/kyrub_admin/control_plane/bootstrap/first_super_admin
/kyrub_admin/control_plane/admins/{uid}
/kyrub_admin/control_plane/audit_logs/bootstrap_{requestId}
```

## Pré-requisitos

1. Google Cloud CLI instalada.
2. A conta Google alvo já deve ter entrado no Kyrub pelo menos uma vez.
3. O e-mail da conta Firebase Auth deve estar verificado.
4. A identidade usada pelo ADC deve ter permissão para:
   - ler a conta no Firebase Auth (`firebaseauth.users.get`);
   - consultar e criar documentos no Firestore do projeto.
5. Não use chaves JSON de conta de serviço no repositório.

## Preparar o ADC

No PowerShell:

```powershell
gcloud auth application-default login
gcloud config set project kyrub-b8d0e
```

As credenciais locais do ADC ficam fora do projeto e não devem ser copiadas para o repositório.

## Simulação obrigatória

```powershell
npm run admin:bootstrap:first-super-admin -- `
  --project kyrub-b8d0e `
  --confirm-project kyrub-b8d0e `
  --uid "FIREBASE_UID" `
  --email "conta@dominio.com" `
  --display-name "Nome do administrador"
```

A simulação consulta Firebase Auth e Firestore, mas não grava documentos.

Saída esperada:

```text
SIMULAÇÃO APROVADA
- nenhuma escrita foi executada
- conta Firebase Auth validada
- nenhum Super Admin existente encontrado
```

## Aplicação real

Execute somente depois de revisar a simulação e confirmar os dados:

```powershell
npm run admin:bootstrap:first-super-admin -- `
  --project kyrub-b8d0e `
  --confirm-project kyrub-b8d0e `
  --uid "FIREBASE_UID" `
  --email "conta@dominio.com" `
  --display-name "Nome do administrador" `
  --apply `
  --confirm-action CREATE-FIRST-SUPER-ADMIN
```

Se o lock, o perfil ou a auditoria já existirem, a operação inteira falha sem gravação parcial.

## Validação após o bootstrap

1. Sair de `http://localhost:3000/admin`.
2. Entrar novamente com a mesma conta Google.
3. Confirmar que o painel exibe o papel **Super Admin**.
4. Testar apenas os módulos de leitura já disponíveis.
5. Não implantar o PR do backend privilegiado nem alterar regras como parte deste bootstrap.

## Revogação do ADC local

Após concluir e registrar a evidência do bootstrap:

```powershell
gcloud auth application-default revoke
```

A revogação remove as credenciais locais usadas pelo script; ela não remove o perfil administrativo criado no Firestore.
