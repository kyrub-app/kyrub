# Kyrub V1 — Handoff de ingresso e segurança para homologação integrada

Status: candidato parcial. Não representa funcionalidade homologada, lançamento autorizado, parecer jurídico ou conclusão de tarefas anteriores. PR #1316 empilhada sobre #1315; reconciliar também #1271 (Tag) e #1277 (gamificação), e confirmar HEADs e bases atuais antes de editar.

## Decisões de negócio preservadas
- Google permanece; e-mail/senha e link mágico aprovados; SMS e Apple adiados; Facebook descartado.
- E-mail verificado, perfil progressivo, CPF/identidade civil conforme atividade. Sem duplicar conta ou transferir Tag implicitamente.
- 18+ para experiência completa; inconclusivo somente modo pessoal estritamente privado/educacional, condicionado à revisão jurídica e controles suficientes; menor declarado/comprovado não ingressa. Não tratar autodeclaração como prova. Cotação Unico/Yoti adiada, sem contratação ou despesa nova.
- 2FA opcional comum e obrigatório para responsabilidades administrativas/financeiras. TOTP candidato, sem ativar Identity Platform/Blaze ou cobrança sem autorização.
- 100 Pitangas uma vez pelo desafio permanente de perfil, independente de Sempitangas. Sem recompensa por dados privados, documentação, semeadura ou recompensa nova no modo inconclusivo. Reutilizar ledger/idempotência existente.
- Tag: aviso versionado antes de publicar, aceite no servidor, sem afastar deveres legais; contatos de terceiros separados. Não publicar em estado inconclusivo sem nova deliberação e revisão jurídica.

## Entregues como código candidato
shared/ageEligibility.ts; server/identity/ageEligibilityService.ts; src/utils/kyrubEmailAccess.ts; testes de domínio e regras de privacidade. Serviço não exposto por HTTP; funções de e-mail não montadas; não há prova de que a aplicação inteira imponha elegibilidade. O gate genérico anterior não pode contornar o gate por capacidade.

## Etapas de execução e comprovação
1. Reconciliar branches/PRs sem sobrescrever alterações aprovadas. Inspecionar autenticação, usuário legado, Tag-only, roteamento /staff, diretório, APIs, regras Firestore/Storage compostas, cache e operações admin. Preservar login Google e dados antigos.
2. Integrar serviço de triagem somente em ambiente isolado com autenticação revogada/desabilitada rejeitada, e-mail verificado, UID derivado do token, validação de método/corpo, limite de tentativas, no-store, resposta mínima, sem registrar data de nascimento em logs. Não usar Admin SDK contra projeto real. Testar transações, falhas, revisão e repetição. Confirmar compatibilidade Admin Auth com Vercel.
3. Integrar onboarding sem acesso automático a dados protegidos. O frontend não substitui autorização. Regras/servidor devem impor as permissões por capacidade, inclusive leitura e escrita, consultas, compartilhamento, convite, mensagens, mídia e rotas alternativas. Notas/tarefas privadas não podem herdar colaboração, sharedWith, contatos ou directory; preservar dados antigos e acesso a suporte/direitos.
4. Integrar os métodos de e-mail aprovados em homologação: configuração de domínios e ação de link, confirmação de e-mail após cadastro por senha, recuperação sem enumeração, não registrar tokens/e-mails desnecessários, sessão trocada, link expirado/reutilizado, link da Tag separado, concorrência e colisão com Google. Não criar/mesclar perfis automaticamente. Não montar funções candidatas antes dos gates. Testar visitante, Google e entrada direta.
5. Integrar aviso de publicação da Tag em claim inicial e configuração posterior, com registro server-side de versão/hash e ator/data; separar salvar privado de publicar, validar idade e titularidade, mídia pública, recuperação, bloqueio e retirada. Não regravar adesivos nem alterar piloto existente.
6. Avaliar 2FA/TOTP via Firebase e custos, recovery, revogação, prova de segundo fator na sessão e imposição por papel no servidor/regras. Não confundir MFA cadastrada ou login Google com segundo fator efetivamente usado. Não mudar infraestrutura/plano ou expor operações financeiras/admin sem controle.
7. Integrar desafio de perfil em branch de gamificação somente após reconciliar #1277 e preservar campanha. Testar concessão idempotente, concorrência, edição posterior, campos da Tag autorizados, idade, bloqueios e ausência de recompensa por dados sensíveis; não ativar.
8. Documentos públicos e direitos: revisão jurídica humana, conteúdo versionado, canal real, termos/aviso de privacidade e registros de aceite apropriados. Não publicar minutas. Parecer define escopos possíveis com controles atuais; manter bloqueados os demais.
9. Executar lint/typecheck/build, testes unitários de idade, testes de regras compostas e emuladores, testes dos métodos de e-mail e E2E de cada estado. Registrar comandos, resultados, SHA, limitações e evidências; não declarar aprovado sem execução. Não usar conta real ou segredos em evidências.

## Limites
Sem merge/main, deployment de produção, mudança de Firebase real, contratação, Blaze/Identity Platform pagos, alteração de Kairubia ou ativação de gamificação. Prévia isolada apenas se já autorizada e com projeto de teste validado. Não bloquear as demais frentes independentes. Entregar relatório de integração, pendências e decisão recomendada por funcionalidade; aprovação comercial/jurídica separada.
