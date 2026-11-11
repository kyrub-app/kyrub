# Revisão independente final - desafios globais

Data: 11/11/2026. Escopo inicial: API #1124 em `e12888846298159283efe71deb9f23614d489fb3`,
base main `c517e95c08ebf519b089ff924294e98c66965e27`; interface #1126 em
`27153e38119e6e20629a1050c7654d7d8a206bf5`, dependente da API.
Revisão estática separada da implementação, por outro agente, reconciliada com
reproduções e testes pelo responsável pelas correções. Não é uma certificação
externa ou uma aprovação humana. Não se inferiu segurança pelo CI.

## Achados na API #1124

| ID | Gravidade | Prova anterior | Correção |
| --- | --- | --- | --- |
| SEC-01 | Alta | Identidade Firebase Auth desabilitada, excluída ou com refresh tokens revogados; perfil Super Admin ativo; POST retornava 201 | Consulta por requisição ao Admin Auth SDK; disabled/missing e cutoff auth_time/tokensValidAfterTime bloqueiam com 401 |
| HTTP-01 | Média | 301 JSON inválidos retornavam 400 sem consumir a cota e sem chegar a 429 | Admissão antes de express.json; WeakSet privado evita cobrança duplicada; adapter Vercel mantém admissão no handler |

Reprodução inicial falhou nos quatro controles esperados (três estados de identidade
e cota de JSON inválido). Após a correção, 47 testes da API/emuladores passaram.
O teste final aceita o MESMO token antes da alteração e o rejeita depois; não trata
um token já inválido antes da mudança como prova de revogação. A reautenticação
após o cutoff é aceita. Falha do Auth retorna 503 sem expor mensagem interna,
criar desafio ou auditoria. Fixture concorrente de identidade trata criação
simultânea no emulador; isso não altera o código de negócio.

## Fronteiras revisadas

- Assinatura RSA, issuer/audience/subject/tempos/e-mail no verificador Firebase
  existente; rejeição estrita de expiração e consulta atual da identidade.
- Perfil administrativo do servidor, uid/status/role, lido inicialmente e dentro
  da transação Firestore; rechecagem em retries. Custom claims de role não concedem
  acesso. Desativação do perfil, rebaixamento e exclusão abortam a operação.
- Campos permitidos, IDs, quantidades seguras, patrocinador global, rascunho inicial,
  período da publicação e rejeição de injeção de metadados administrativos.
- Criação/publicação e auditoria na mesma transação, conflito 409, rollback e corrida
  de oito requisições. ID estável impede efeitos duplicados; não há replay de sucesso.
- Limite de payload 32KiB, parser sem inflação, 411/413/415, no-store, Retry-After,
  cotas por UID transacionais e limite de entrada compartilhado por processo.
- Express e multiplexador serverless existentes; rewrite compilado mantém operation.
  Orçamento 11/12 funções. Não se criou endpoint paralelo.
- Regras compostas negam leitura/escrita direta em desafios/auditoria/cotas e escrita
  em perfis administrativos, inclusive ao cliente com claim forjada de Super Admin.
- Nenhuma chamada ao ledger, conclusão ou emissão de XP/K-Coins/recompensas.
  Quantidades são apenas definições de desafios.

Busca de reutilização: server/ai/consultantAuth, server/admin/integrationReadinessService,
server/firebaseAdmin, outros routers que já usam adminAuth, server/gamification,
shared/gamification e lifecycle, parser/rate-limit, health multiplexer, regras e testes.
A correção ficou no autorizador e no router existentes; outros módulos não mudaram.

## Validação local da API corrigida

| Gate | Resultado |
| --- | --- |
| test:global-challenges (Firestore + Auth Emulator) | 47 aprovados; zero falhas/skips |
| Prebuild / contrato MVP / TypeScript | 2561 aprovados |
| Build Vite + servidor | Aprovado |
| Normalização serverless + TypeScript normalizado | Aprovado; arquivos normalizados restaurados, sem mudanças fora do escopo |
| Orçamento Vercel | 11 funções ativas, 1 slot reservado |
| diff --check | Aprovado |

Os emuladores usam projeto demo-global-challenges e endpoints de loopback. Os tokens
são assinados por chave de teste em memória e o certificado é uma fixture. Nenhuma
credencial de produção é carregada. Node local 24.22.1 / Java21; CI Node22 é gate
adicional. Links e conclusão dos workflows do novo commit serão registrados nas PRs.

## Limitações e ordem de integração

Firebase Auth e Firestore não compõem uma transação distribuída. O estado Auth é
checado na autorização da requisição; o perfil Firestore é a autoridade para revogação
transacional, inclusive retry. Revogações ordenadas após um commit não o desfazem.
O limite global por processo pode ser esgotado anonimamente; é uma proteção de carga,
não garantia de disponibilidade ou DDoS distribuído. Há uma chamada Auth adicional
por requisição administrativa. Sem teste de produção ou edge hospedado nesta revisão.

Não repetir a inspeção visual: evidências do commit27153e3 permanecem válidas para
os componentes sem alterações visuais. A interface depende da API; a ordem futura é
integrar #1124, atualizar a base de #1126 para main e conferir o diff/CI antes de
integrar #1126. Nada disso é executado nesta revisão.

O parecer conclusivo individual depende dos workflows dos novos commits e será
registrado em cada PR após sua verificação. Ambas permanecem Draft. Esta revisão
não autoriza merge, deploy, pagamentos ou alteração de flags de produção.

## Resultado de auditoria das regras no escopo

```json
{"score":5,"summary":"Fronteiras de desafios, auditoria, cotas e escrita de perfis administrativos negadas ao cliente e verificadas no emulador; sem alteração de regras necessária.","findings":[]}
```

A avaliação é apenas dessas fronteiras; não atribui aprovação às regras de outros
módulos do repositório.
