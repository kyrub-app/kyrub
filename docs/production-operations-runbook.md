# Runbook de operação 99Food, filas e Kyrub Entregas

Este documento transforma o código já mesclado em uma operação contínua. Nenhuma etapa abaixo substitui a homologação oficial da 99Food.

## 1. Pré-requisitos

- projeto Google Cloud/Firebase: `kyrub-b8d0e`;
- backend acessível por HTTPS em `PUBLIC_APP_URL`;
- identidade gerenciada/ADC ou service account exclusiva do backend;
- `INTEGRATION_MASTER_KEY` com 32 bytes;
- `INTEGRATION_CRON_SECRET` longo e aleatório;
- credenciais de sandbox 99Food por unidade;
- acesso ao Cloud Scheduler e ao gerenciamento de TTL do Firestore.

Nunca copie credenciais da 99Food, service account, chave mestra ou segredo de cron para documentos, issues, logs ou navegador.

## 2. Validar a configuração

```bash
npm run operations:check
npm run operations:check:json
```

O comando bloqueia a ativação quando:

- a URL pública não usa HTTPS;
- o projeto não é `kyrub-b8d0e`;
- a chave mestra não possui 32 bytes;
- o segredo do scheduler é curto;
- não há credencial de servidor ou identidade gerenciada detectável.

Avisos não bloqueiam o processo, mas precisam ser revisados antes da homologação.

## 3. Implantar o backend

Após o build e os testes:

```bash
npm ci
npm run prebuild
npm run build
```

Confirme:

```text
GET /api/health
```

Resultado esperado:

```json
{"status":"ok","app":"Kyrub"}
```

No `admin.kyrub.com`, um usuário `operations` ou `super_admin` deve conseguir consultar a área **Saúde do sistema**.

## 4. Habilitar retenção TTL

A fila `integrationIngress` remove payloads sensíveis após o processamento, mas conserva metadados de auditoria por 30 dias em `expiresAt`.

```bash
FIREBASE_PROJECT_ID=kyrub-b8d0e \
  bash infra/firestore/enable-integration-ingress-ttl.sh
```

O script executa a configuração do campo TTL e depois lista o estado para conferência.

## 5. Configurar schedulers

Defina no ambiente administrativo:

```bash
export FIREBASE_PROJECT_ID=kyrub-b8d0e
export PUBLIC_APP_URL=https://app.kyrub.com
export INTEGRATION_CRON_SECRET='segredo-gerado-no-cofre'
export SCHEDULER_LOCATION=southamerica-east1
export SCHEDULER_TIME_ZONE=America/Sao_Paulo
export NINETY_NINE_FOOD_POLL_SCHEDULE='*/5 * * * *'
```

O intervalo de polling acima é apenas um valor inicial. Substitua-o pelo intervalo autorizado na homologação da 99Food.

Aplique ou atualize os jobs:

```bash
bash infra/cloud-scheduler/apply-kyrub-operations.sh
```

Jobs resultantes:

| Job | Agenda | Endpoint |
| --- | --- | --- |
| `kyrub-99food-ingress-drain` | a cada minuto | `/api/integrations/99food/internal/drain` |
| `kyrub-99food-poll-all` | intervalo homologado | `/api/integrations/99food/internal/poll-all` |
| `kyrub-delivery-fallback` | a cada minuto | `/api/delivery-opportunities/internal/escalate` |

Cloud Scheduler não inicia uma nova execução enquanto a anterior do mesmo job ainda está pendente. Mesmo assim, os workers do Kyrub usam lease e idempotência e não dependem dessa proteção externa.

## 6. Testar os jobs manualmente

```bash
gcloud scheduler jobs run kyrub-99food-ingress-drain \
  --project=kyrub-b8d0e \
  --location=southamerica-east1

gcloud scheduler jobs run kyrub-99food-poll-all \
  --project=kyrub-b8d0e \
  --location=southamerica-east1

gcloud scheduler jobs run kyrub-delivery-fallback \
  --project=kyrub-b8d0e \
  --location=southamerica-east1
```

Após cada execução, confirme no painel de Saúde do sistema:

- fila sem crescimento contínuo;
- zero falhas permanentes;
- conexão 99Food sem estado `attention`;
- entregas aceitas não escaladas;
- escaladas sem entregador visíveis no controle administrativo.

## 7. Piloto em modo sombra

1. conectar uma única unidade em sandbox;
2. manter o gestor oficial da 99Food aberto;
3. criar pedidos de homologação;
4. comparar quantidade, itens, valores e horários;
5. testar duplicidade de webhook;
6. testar indisponibilidade temporária e reconciliação;
7. aceitar, preparar, marcar pronto, despachar e concluir;
8. publicar uma entrega e aceitá-la antes de três minutos;
9. repetir sem aceite e confirmar uma única escalada;
10. documentar qualquer divergência antes de ativar produção.

## 8. Critérios de ativação

A produção somente pode ser habilitada quando:

- `npm run operations:check` estiver aprovado;
- TypeScript, testes, bundle e regras estiverem verdes;
- TTL estiver listado como ativo;
- os três schedulers tiverem execução bem-sucedida;
- o painel de saúde estiver acessível;
- o webhook HTTPS estiver homologado;
- o polling respeitar o intervalo oficial;
- nenhum pedido for perdido ou duplicado no modo sombra;
- o restaurante tiver procedimento manual de contingência.

## 9. Rollback

Pausar imediatamente os jobs:

```bash
for job in \
  kyrub-99food-ingress-drain \
  kyrub-99food-poll-all \
  kyrub-delivery-fallback
do
  gcloud scheduler jobs pause "$job" \
    --project=kyrub-b8d0e \
    --location=southamerica-east1
done
```

Depois:

1. desabilitar a conexão da unidade no Kyrub;
2. manter os eventos e auditorias, sem apagar filas manualmente;
3. retornar o restaurante ao aplicativo oficial;
4. reverter a versão do backend para a última release aprovada;
5. investigar pelo painel de saúde e logs server-side;
6. corrigir em sandbox;
7. executar novamente o modo sombra antes de retomar produção.

Não desative o TTL durante um incidente; isso não recupera payloads já removidos e aumenta a retenção de dados desnecessários.

## 10. Rotação de segredos

- rotacione `INTEGRATION_CRON_SECRET` no cofre e reaplique os schedulers;
- para `INTEGRATION_MASTER_KEY`, implemente primeiro migração/recriptografia dos envelopes existentes;
- rotacione credenciais 99Food por estabelecimento, nunca globalmente;
- revogue credenciais antigas somente após validar o novo acesso;
- registre a rotação em auditoria administrativa.
