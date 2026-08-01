# Ambientes e variáveis

## Regras gerais

- Segredos nunca devem ser adicionados ao Git, enviados ao navegador ou copiados para logs.
- Variáveis prefixadas com `VITE_` são incorporadas ao bundle do navegador e, portanto, devem ser consideradas públicas.
- Variáveis sem `VITE_` devem permanecer no servidor.
- Produção, Preview e desenvolvimento devem usar credenciais separadas quando o fornecedor permitir.
- Uma alteração de variável na Vercel exige nova implantação para atingir funções já construídas.

Use `.env.example` como referência sem preencher valores reais no repositório.

## Núcleo

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `NODE_ENV` | conforme runtime | `development`, `test` ou `production` |
| `PORT` | não | porta do servidor Express local/Node |
| `PUBLIC_APP_URL` | produção/integr. | origem pública usada por callbacks, webhooks e schedulers |
| `KYRUB_RELEASE` | recomendada | identificador legível da implantação |

Vercel fornece automaticamente `VERCEL_ENV` e `VERCEL_GIT_COMMIT_SHA`. O endpoint `/api/health` utiliza esses valores quando disponíveis.

## Kyrubia

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `GEMINI_API_KEY` | sim para IA | chave do Gemini usada somente no servidor |
| `GEMINI_MODEL` | não | substitui o modelo padrão da Kyrubia |

A presença da chave não garante que ela seja válida, tenha cota ou possa acessar o modelo. Valide com uma conversa autenticada e consulte os logs do provedor quando houver erro.

Nunca crie `VITE_GEMINI_API_KEY`.

## Firebase Admin

O cliente possui configuração pública Firebase em `src/utils/firebase.ts`. Isso não é uma credencial administrativa; a proteção dos dados depende das regras e da autenticação.

O servidor usa uma das estratégias abaixo:

1. Application Default Credentials no ambiente Google;
2. `FIREBASE_SERVICE_ACCOUNT_JSON` em ambientes externos;
3. `FIREBASE_PROJECT_ID` ou `GCLOUD_PROJECT` para identificar o projeto.

`FIREBASE_SERVICE_ACCOUNT_JSON` deve conter JSON completo e válido, armazenado apenas no gerenciador de segredos do ambiente.

## Integrações

| Variável | Uso |
| --- | --- |
| `INTEGRATION_MASTER_KEY` | proteção de credenciais de integrações armazenadas pelo servidor |
| `INTEGRATION_CRON_SECRET` | autenticação de jobs internos e schedulers |
| `SCHEDULER_LOCATION` | região dos jobs operacionais |
| `SCHEDULER_TIME_ZONE` | fuso dos jobs |
| `NINETY_NINE_FOOD_POLL_SCHEDULE` | frequência de polling, após confirmação com o parceiro |

Credenciais específicas de uma loja para integrações não devem ser colocadas em variáveis globais compartilhadas quando o serviço já possui cofre por tenant.

## Google Drive e Google Photos

Variáveis `VITE_` abaixo são públicas e controlam pickers no navegador:

- `VITE_GOOGLE_PICKER_API_KEY`;
- `VITE_GOOGLE_CLOUD_PROJECT_NUMBER`.

O projeto Google Cloud também precisa habilitar as APIs correspondentes e configurar corretamente a tela de consentimento OAuth.

## Ambientes recomendados

### Desenvolvimento

- projeto ou dados de teste;
- Gemini com cota limitada;
- integrações externas em sandbox;
- logs detalhados sem dados pessoais completos.

### Preview

- credenciais separadas da produção;
- regras e índices equivalentes;
- integrações destrutivas desabilitadas;
- usada para validação de PR.

### Produção

- acesso mínimo necessário;
- rotação de segredos definida;
- alertas de erro e custo habilitados;
- backups e recuperação testados;
- schedulers protegidos por segredo;
- domínio, OAuth e callbacks revisados.

## Checklist de rotação

Ao trocar um segredo:

1. gere um valor novo;
2. configure-o no ambiente correto;
3. faça uma nova implantação;
4. valide o endpoint ou integração;
5. revogue o valor antigo;
6. registre data, motivo e responsável sem registrar o segredo.
