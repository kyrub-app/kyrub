# Bateria de Desenvolvimento — Pós AI Team / E2E & Product Expansion

Atualizado em: 2026-08-23

Esta é a bateria oficial de desenvolvimento do Kyrub para a fase de fechamento estrutural do projeto. A numeração e a organização abaixo preservam a lista oficial de 67 pontos definida pelo proprietário.

## Regra de execução

Tratar esta lista como fila contínua de trabalho. Executar os itens respeitando dependências, sem interromper para solicitar “continue”. Trabalhos independentes podem ser executados em paralelo.

Só interromper a frente bloqueada quando houver **AÇÃO DO PROPRIETÁRIO NECESSÁRIA**, como KYC, MFA, aceite contratual, fornecimento seguro de credencial, decisão comercial/jurídica ou autorização irreversível. As demais frentes independentes continuam.

Nenhum agente pode considerar merge = produção. Nenhuma ação financeira pode ser inferida pelo frontend. Nenhuma credencial pode aparecer em chat, código, log, Firestore em plaintext ou resposta ao navegador.

## Legenda de acompanhamento

- ✅ implementado e integrado com evidência suficiente
- 🟡 em andamento / parcialmente implementado / aguardando release gate
- ⏸️ bloqueado corretamente por Owner Gate
- 🔎 reconciliação necessária antes de implementar gaps
- ⬜ pendente

---

# FASE 0 — Sincronização e Release Authority

## 1. ✅ Resolver #284 — PRODUCTION_BEHIND_MAIN

Diagnosticar por que produção permaneceu no commit #280 enquanto #281/#283 já estavam na main.

Corrigir a causa raiz, não simplesmente disparar redeploy manual.

**Status atual:** concluído. A causa raiz de produção atrás da `main` foi corrigida e o fluxo atual não usa redeploy manual como substituto do release pipeline.

## 2. ✅ Confirmar production SHA === expected main/release SHA

Verificar o deployment efetivamente servido por www.kyrub.com.

Registrar a causa da divergência e sua correção.

**Status atual:** incorporado ao release gate operacional; todo fechamento de onda compara SHA esperado e deployment servido.

## 3. ✅ Criar Production Release Gate

Formalizar:

GitHub main → CI → Vercel deployment → deployment SHA → runtime verification

Nenhum agente poderá declarar algo “em produção” apenas porque o PR foi mergeado.

**Status atual:** vigente. O procedimento é aplicado nas releases atuais.

---

# FASE 1 — Admin → Vault → Payments

## 4. ✅ Criar Mercado Pago → Configurar

No admin.kyrub.com.

O segredo:

browser → backend → Vault

Nunca:

browser → Firestore

e nunca retorna integralmente ao frontend.

**Status atual:** implementado.

## 5. ✅ Implementar Credential Lifecycle

Cada integração deverá possuir metadados como:

provider;

environment (sandbox | production);

status;

masked fingerprint;

createdAt;

lastValidatedAt;

lastRotatedAt;

revokedAt;

audit correlation;

kill switch.

**Status atual:** fundação implementada e utilizada pelo Vault de integrações.

## 6. ✅ Construir Provider Credential Resolver

Admin
 ↓
Vault
 ↓
Credential Resolver
 ↓
MercadoPagoPixProvider

O provider deixa de depender diretamente de MERCADO_PAGO_ACCESS_TOKEN.

Fallback temporário por ENV só poderá existir se explicitamente controlado durante migração.

**Status atual:** implementado.

## 7. ✅ Implementar Testar conexão

O Admin solicita teste server-side.

Resultado possível:

connected | invalid | expired | insufficient_scope | unavailable

Nunca retornar o token.

**Status atual:** implementado server-side.

## 8. ✅ Preparar Webhook Management

Cadastrar/validar:

Mercado Pago → Kyrub webhook

com verificação de assinatura e consulta autoritativa do pagamento.

**Status atual:** webhook autoritativo e verificação implementados; credencial de webhook armazenada em Vault.

## 9. ✅ Credential Rotation / Revocation

Permitir trocar credencial sem alterar código.

Registrar tudo no Audit Trail.

**Status atual:** lifecycle/rotação/revogação fazem parte da autoridade de credenciais.

---

# FASE 2 — Sandbox + E2E Pix

## 10. 🟡 Criar Sandbox Gate

Antes de dinheiro real:

test account → test credential → Pix → webhook → PaymentIntent

Sempre que o PSP permitir.

**Status atual:** infraestrutura de provider/intents/webhook existe; execução sandbox completa ainda precisa ser fechada conforme capacidade oficial do PSP.

## 11. ⏸️ Executar E2E X-Burger

Cliente
 ↓
Loja Kyrub
 ↓
X-Burger
 ↓
Checkout
 ↓
PaymentIntent
 ↓
Mercado Pago Pix
 ↓
Pagamento
 ↓
Webhook
 ↓
confirmação autoritativa
 ↓
KDS
 ↓
produção
 ↓
entregador
 ↓
entrega

**Status atual:** Owner Gate. Depende de produto legitimamente vendável e de confirmação explícita imediatamente antes de qualquer Pix real.

## 12. ✅ Confirmar Financial Authority

O frontend jamais executa algo equivalente a:

paid = true

Pagamento somente muda de estado por evidência autoritativa do backend/provider.

**Status atual:** implementado e protegido por contratos.

## 13. 🟡 Failure E2E

Testar:

Pix expirado;

pagamento cancelado;

timeout;

webhook duplicado;

webhook atrasado;

webhook fora de ordem;

replay;

PSP indisponível;

resposta desconhecida.

**Status atual:** matriz fail-closed e regressões do webhook implementadas nas PRs #318/#322. Falta fechar fixtures de integração do processor/provider/Firestore para chamar o item de E2E completo.

## 14. ⬜ Refund E2E

Testar:

refund total

e

refund parcial

com reconciliação de PaymentIntent, pedido, allocations e ledger.

**Status atual:** pendente; será atacado após o fechamento de #13 sem depender do Pix real.

---

# FASE 3 — Marketplace Payments / Split

## 15. 🔎 Implementar Seller Connection

Lojista conecta sua própria conta Mercado Pago através de OAuth.

Nunca solicitar token no chat da Kyrubia.

**Status atual:** reconciliação necessária com as fundações financeiras/onboarding existentes antes de implementar gaps.

## 16. 🔎 Implementar Split 1:1

Primeiro modelo:

comprador
   ↓
Mercado Pago
 ↙       ↘
lojista   Kyrub
          application_fee

**Status atual:** reconciliação necessária.

## 17. 🔎 Separar Payment de Allocation

Formalizar:

Payment
↓
Allocation
↓
Settlement
↓
Reconciliation

Allocation ≠ dinheiro liquidado.

**Status atual:** existe `paymentAllocationEngine`; reconciliar o contrato completo antes de marcar gaps.

## 18. 🔎 Entregador permanece como obrigação no Ledger

Enquanto não existir rail autorizado:

deliveryAllocation

registra quanto deveria receber.

Mas o Kyrub não improvisa custódia ou repasse financeiro pela própria conta.

**Status atual:** reconciliação necessária com Allocation/Ledger existentes.

## 19. 🔎 Criar Settlement Adapter

Contrato independente de PSP.

Possíveis implementações futuras:

Mercado Pago 1:N;

PagBank;

Pagar.me;

outro PSP qualificado.

**Status atual:** reconciliação necessária.

## 20. ⬜ PSP Qualification Matrix

Comparar:

Mercado Pago | PagBank | Pagar.me | outros

por:

Pix;

OAuth;

seller onboarding;

1:1;

1:N;

refunds;

webhook;

KYC;

settlement;

recipient onboarding;

sandbox;

produção;

suporte;

custos.

**Status atual:** pendente.

## 21. ⬜ Mercado Pago 1:N — Commercial Gate

Verificar oficialmente possibilidade de habilitação para o Kyrub.

Não bloqueia o MVP 1:1.

**Status atual:** pendente; será tratado como gate comercial, sem bloquear 1:1.

---

# FASE 4 — Store Connections / Omnichannel Onboarding — #285

## 22. 🟡 Kyrubia identifica canais existentes

Durante ativação da loja:

> “Você já vende em algum lugar?”

Exemplos:

Mercado Livre / Shopee / iFood / 99Food / Instagram / ERP / outros

**Status atual:** domínio e reconhecimento determinístico de canais implementados na PR #319; integração plena ao onboarding/Kyrubia ainda pendente.

## 23. 🟡 Criar Store Connection Registry

Separar rigorosamente:

PlatformConnection

de

StoreConnection.

**Status atual:** domínio separado na #319 e persistência server-authoritative/tenant-scoped na #323; release final da segunda onda ainda precisa do Production Release Gate.

## 24. ⬜ OAuth por lojista

Quando disponível:

Kyrubia
→ Conectar Mercado Livre
→ OAuth oficial
→ autorização
→ backend
→ Vault

Nunca:

> “mande seu token aqui”.

## 25. ⬜ Descoberta do catálogo

Depois da autorização:

discover products

sem importar automaticamente.

## 26. ⬜ Preview de importação

Mostrar:

produtos;

categorias;

preços;

imagens;

estoque;

possíveis conflitos.

## 27. ⬜ Confirmação humana

Somente após confirmação:

preview → confirm → import

## 28. 🟡 Provenance

Cada dado importado sabe sua origem:

manual
mercado_livre
shopee
ifood
99food
csv
ai
...

Com:

externalId / connectionId / importedAt / lastSyncedAt.

**Status atual:** contrato de provenance entrou na #319; aplicação completa aos imports ainda pendente.

## 29. 🟡 Sync Authority

Definir quem é autoridade após importação.

Exemplo:

Mercado Livre → Kyrub

ou

Kyrub → Mercado Livre

ou

bidirectional

quando seguro.

**Status atual:** enum/contrato de autoridade entrou na #319; configuração operacional ainda pendente.

## 30. 🟡 Tenant Isolation

Uma Store Connection jamais pode acessar credenciais ou dados de outra loja.

**Status atual:** tenant assertion e registry server-side entraram nas #319/#323; ainda serão adicionadas regras/testes de autorização end-to-end quando o registry for exposto ao produto.

---

# FASE 5 — Gamificação: Fundação

Aqui aplicaremos primeiro uma regra:

> Reconciliação antes de implementação.

Como parte dessa fundação já entrou na Wave anterior, o Gamification Agent primeiro classifica cada requisito como:

implemented | partial | missing

e implementa somente os gaps.

## 31. ✅ Formalizar economias separadas

Clube da Loja

Kyrub Clube

K-Coins

E:

XP ≠ K-Coins

Pontos da loja ≠ K-Coins

K-Coins ≠ saldo financeiro

**Status atual:** contrato explícito integrado na #320, incluindo separação de Créditos Kyrubia.

## 32. 🟡 Consolidar domínio Gamification

Challenges, participações, evidências, conquistas, recompensas, vouchers, expiração e antifraude.

**Status atual:** `shared/gamification.ts` já contém base significativa de challenges/rewards/claims; consolidação continua.

## 33. 🟡 Consolidar Reward Ledger

Toda movimentação contém:

user;

origin;

challenge;

timestamp;

reason;

correlationId;

idempotency key.

Saldo sempre derivável.

**Status atual:** builder auditável e idempotência adicionados na #324 sobre o ledger existente; release final da segunda onda ainda precisa do Production Release Gate.

## 34. ⬜ Antifraude

Cobrir inicialmente:

multi-account;

autoindicação;

farming;

evidência falsa;

resgate duplicado;

replay;

rate limiting.

## 35. ⬜ Governança econômica

Admin acompanha:

emitido / circulando / resgatado / expirado

e limites de emissão.

---

# FASE 6 — Kyrub Clube

## 36. 🔎 Criar experiência Kyrub Clube

Página com:

K-Coins;

XP;

nível;

desafios;

conquistas;

histórico;

recompensas.

**Status atual:** reconciliar UI/fundações existentes antes de implementar gaps.

## 37. 🔎 Challenge Engine

Desafio possui:

objetivo / descrição / período / público / critérios / evidência / recompensa / orçamento / status

**Status atual:** existe `KyrubChallengeDefinition`; reconciliar campos e persistência/execução.

## 38. 🟡 Tipos de validação

Suportar:

automática;

evidência;

feed;

integração externa;

comunitária;

manual;

Kyrubia-assisted.

**Status atual:** modos equivalentes já existem no domínio compartilhado; falta execução completa por modo.

## 39. ⬜ Feed como evidência

Publicações podem comprovar progresso.

Mas:

postar ≠ automaticamente cumprir desafio.

## 40. 🔎 Catálogo global de recompensas

K-Coins podem ser trocados por benefícios definidos.

Sem paridade monetária automática.

**Status atual:** `KyrubRewardDefinition` já existe; reconciliar catálogo/persistência/UI.

## 41. ⬜ Redemption Engine

Resgate:

atomic debit → voucher único → validade → audit event

com proteção contra duplicação.

---

# FASE 7 — Clube da Loja

## 42. 🔎 Criar Clube da Loja

Cada estabelecimento possui:

membros;

fidelidade;

campanhas;

vouchers;

benefícios;

regras.

## 43. 🔎 Desafios próprios

Lojista pode criar desafios para seus clientes.

## 44. 🔎 Funding local

Recompensas da loja são financiadas pela própria loja.

## 45. ✅ Separação econômica

Nenhuma conversão automática:

Pontos Loja ↔ K-Coins

**Status atual:** invariável explícita adicionada na #320.

## 46. 🔎 Loja oferecendo benefícios ao Kyrub Clube

Exemplo:

500 K-Coins → voucher da Loja X

## 47. ⬜ Campaign Dashboard

Lojista acompanha:

orçamento;

participantes;

resgates;

conversão;

receita atribuída.

## 48. ⬜ Sponsored Challenges

Preparar:

marca financia
↓
Kyrub distribui
↓
usuário participa
↓
reward
↓
marca recebe métricas

---

# FASE 8 — Gamificação transversal + Kyrubia

## 49. 🔎 Desafios multidomínio

Permitir desafios de:

empreendedorismo;

estudo;

freelancer;

entregas;

compras;

vendas;

comunidade;

perfil;

conteúdo;

indicação.

## 50. 🔎 XP / Level / Achievement

Formalizar separadamente:

XP

Level

Achievement

Badge

K-Coin

**Status atual:** XP e K-Coin já estão separados; reconciliar Level/Achievement/Badge.

## 51. ⬜ Kyrubia Gamification Assistant

A Kyrubia poderá:

encontrar desafios;

explicar regras;

acompanhar progresso;

informar recompensa;

sugerir oportunidades.

## 52. ⬜ Opportunity → Challenge Engine

O Opportunity Engine poderá gerar propostas de desafios/campanhas.

Nunca publicar automaticamente sem política de autonomia.

## 53. 🟡 Reward Funding Authority

Toda recompensa declara quem paga:

Kyrub | loja | patrocinador | parceiro | combinação

**Status atual:** funding/sponsor types já existem nas fundações; consolidar enforcement.

## 54. ⬜ Budget Guard

Campanhas possuem:

budget;

issuance cap;

redemption cap;

período;

kill switch.

Nenhum agente pode criar custo ilimitado.

---

# FASE 9 — Governance / Legal / Trust

Esta é a frente que faltava na lista consolidada.

## 55. ✅ Criar GovernanceDocument

Documento possui:

type / version / hash / status / owner / createdAt / approvedAt / publishedAt.

**Status atual:** domínio implementado na #321.

## 56. 🟡 Central de Governança

No Admin:

Jurídico / Privacidade / Termos / Pagamentos / IA / LGPD / Contratos / Políticas.

**Status atual:** repository server-authoritative para a Central entrou na #325; interface/admin transport ainda pendentes e release final da segunda onda ainda precisa do Production Release Gate.

## 57. ✅ Document Lifecycle

DRAFT
↓
LEGAL_REVIEW
↓
APPROVED
↓
PUBLISHED
↓
SUPERSEDED

**Status atual:** lifecycle e transições válidas implementados na #321.

## 58. 🟡 Versioned Consent

Registrar:

> Termos v1.3 — aceito por usuário X — timestamp Y.

**Status atual:** domínio e persistência server-side implementados nas #321/#325; integração com pontos de aceite do produto ainda pendente.

## 59. ⬜ Legal Drift Detector

Mudança relevante no produto pode gerar:

> ⚠️ Esta alteração pode tornar a Política de Privacidade desatualizada.

## 60. ⬜ Compliance Agent Integration

Observar principalmente:

Payments / AI / Gamification / Store Connections / Logistics.

## 61. ⬜ Release Compliance Gate

Mudanças classificadas como materialmente relevantes podem exigir revisão antes da produção.

## 62. ✅ Human Legal Gate

IA pode:

detectar → comparar → apontar → preparar

Mas aprovação/publicação jurídica permanece uma decisão humana apropriada.

**Status atual:** princípio preservado no domínio e nos fluxos atuais; nenhuma automação pode publicar aprovação jurídica sozinha.

---

# FASE 10 — Final Integrated Validation

## 63. ⬜ Cross-domain E2E

Executar cenário atravessando vários domínios.

Por exemplo:

lojista conectado
→ produto
→ cliente compra
→ Pix
→ KDS
→ entrega
→ conclusão
→ XP/K-Coins quando aplicável
→ voucher
→ audit trail

## 64. ⬜ Security Regression

QA Agent executa revisão independente:

auth / tenant isolation / secrets / payments / ledger / replay / privilege escalation.

## 65. ⬜ Production Verification

Novamente:

expected SHA === deployed SHA

smoke tests.

## 66. ⬜ Documentation Drift

Comparar implementação final contra:

arquitetura;

roadmap;

documentação técnica;

documentos jurídicos;

contratos MCP/API.

## 67. ⬜ Phase Closeout

Gerar relatório único:

implemented / partial / blocked / failed / owner action

e construir a próxima fila a partir de gaps reais, não de ideias duplicadas.

---

# Workstreams oficiais

🔴 **Critical Path: #1 → #21** — produção + Mercado Pago + E2E + split.

🔵 **Product: #22 → #54** — Omnichannel + Gamificação + Clubes.

🟣 **Governance: #55 → #62** — Compliance / Legal / Trust.

Os **#63–#67** voltam a reunir tudo para validação final.

## Owner Gates atualmente abertos

- ⏸️ #11 — primeiro E2E Pix real do X-Burger: aguarda produto legitimamente vendável e confirmação explícita imediatamente antes de dinheiro real.
- ⏸️ Teste real BYO-AI fora desta bateria de 67: proprietário fará diretamente em `Minha IA`, sem enviar chave em chat.
