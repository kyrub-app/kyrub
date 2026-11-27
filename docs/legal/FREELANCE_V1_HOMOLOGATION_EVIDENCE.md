# Freelas V1 — consolidação de evidências e portões de encerramento

Data: 27/11/2026. Candidata empilhada, não implantada. Este documento registra evidências parciais; não é aprovação comercial.

## Evidências verificadas

- #1423: testes transacionais iniciais no Firestore Emulator.
- #1424: barreira de financiamento simulado; Application build 45982785817 e Store security rules 45982784435 aprovados.
- #1425: Application build 45983256055 e Store security rules 45983256519 aprovados; workflows de publicação de loja também passaram (não equivalem a E2E de Freelas).
- #1426: Application build 45983450701 aprovado.
- #1427: Application build 45983769497 e Store security rules 45983769378 aprovados.
- #1428: Application build 45985193001 e Store security rules 45985192978 aprovados.
- #1429: execução inicial 45985480445 falhou por expectativa incorreta do código HTTP da auto-seleção; corrigida em 60e22ac192eeaf00bbe60f20dd135b1181177714. Application build 45986349192 e Freelas authenticated HTTP homologation 45986349257 aprovados. Prova jornada autenticada isolada, financiamento simulado, remuneração única, acesso pessoal e ocorrência bloqueada sem MFA.
- #1430: Chromium 45986439441 falhou após publicação persistida, na localização da vaga pelo teste. Correção do locator relativo e validação da resposta da consulta, seguida de remoção do contador legado na candidata (5e0b574e48559eacf78397d5d30e9233c5de8d0a). Application build 45987048423 aprovado. Chromium 45987048509 interrompido antes da publicação por comparação literal de caixa do texto FAZER FREELA (CSS uppercase), sem contador legado, sem erros JS ou chamadas Firebase remotas registrados. Corrigida comparação sem distinção de caixa, preservada exigência de ausência de contador. Novo Chromium será executado na #1431; não declarar aprovação visual até confirmação.

Todos os runs podem ser consultados em https://github.com/kyrub-app/kyrub/actions/runs/{id}.

## Cobertura administrativa acrescentada nesta parcela

Teste com token do emulador validado pelo verificador original e injeção exclusivamente no processo de teste de uma claim TOTP fictícia. Exercita política de sessão recente, papel ativo, impedimento de julgar contrato próprio, ausência de concordância, retomada, cancelamento, concorrência, replay, auditoria e base de remuneração indefinida. Não altera código de autenticação, não cria mecanismo de bypass e não comprova login TOTP real. Aprovado no run 45987371634: 3 testes passaram, 0 falharam, incluindo transação administrativa. Application build 45987371693 aprovado. TOTP efetivo continua pendente.

## Portões remanescentes

- Confirmar execução Chromium e inspecionar evidências; validar ocorrência e decisão administrativa pela interface quando ambiente isolado com TOTP real estiver disponível.
- Validação positiva do provedor de identidade com autenticação multifator TOTP efetiva. Teste sintético não substitui essa validação.
- Resumos pessoais ainda limitados a 50 registros por consulta com falha explícita. Não há histórico de notificações/não lidas, expiração automática de seleção, edição de termos ou reconstituição de financiamento revogado.
- Reconciliar pilha candidata e branches independentes com baseline produtiva antes de qualquer promoção. Legado produtivo não foi substituído.
- Sem PSP real, política financeira definitiva, comissão aprovada ou liquidação verificada. Financiamento simulado bloqueado fora do emulador.
- Revisar posteriormente alternativas Mercado Pago sem Split 1:N, conforme direção do proprietário, sem ampliar escopo nesta parcela.
- Nenhum merge, deployment, contratação ou alteração de Firebase produtivo autorizado por este documento.

## TOTP — limite do emulador e procedimento de aceite futuro (27/11/2026)

A documentação do Firebase Auth Emulator descreve MFA por SMS, não TOTP. O README oficial do SDK JavaScript esclarece que testes TOTP não são suportados pelo emulador e usam backend real. Referências consultadas:
- https://firebase.google.com/docs/emulator-suite/connect_auth
- https://github.com/firebase/firebase-js-sdk/blob/main/packages/auth/README.md
- https://firebase.google.com/docs/auth/web/totp-mfa

A #1330 já recuperou a fundação/adaptador TOTP, sem montar inscrição e recuperação ou concluir a integração transversal. Portanto esta validação pertence também à frente de segurança de ingresso, não se resolve por repetição do teste local de Freelas. Não substituir TOTP por SMS nem remover a exigência de MFA.

Portão de aceite: em projeto de homologação dedicado, autorizado e sem dados produtivos, verificar disponibilidade e eventual custo do Identity Platform, inscrever uma conta fictícia autorizada no TOTP, concluir login com código verdadeiro, confirmar token verificado e sessão recente, validar papel administrativo e executar uma decisão auditada de teste. Confirmar rejeição de sessão antiga, fator ausente, papel revogado e participante próprio. Preservar apenas resultados redigidos, sem tokens, códigos TOTP, segredos ou dados pessoais. Não criar projeto, habilitar produto, contratar ou tocar produção para contornar esta limitação. Sem autorização e ambiente compatível, manter pendência explícita e operação administrativa bloqueada.

Reexecução do HTTP na #1431 (commit 6a18e548e2f2911109a16dfc5869516016cb860d): run 45987756222 aprovado. Chromium 45987756296 e build 45987756205 ainda sem resultado final no momento da consulta.

## Atualização da evidência Chromium — 27/11/2026

Run 45987756296 (artefato 15192580853): consultas de Solicitações e Publicados confirmadas via HTTP e elementos visíveis. Publicação, candidatura e seleção executadas via controles reais; timeout ao procurar a aba Fazendo. Captura failure-1.png mostra Catu com sessão ainda conectada, sem modal aberto. Causa do fechamento não determinada; sem erros JS não tratados ou Firebase remoto registrados. Ajustado roteiro para fechamento explícito quando aberto e reentrada pelo card Catu a cada consulta, comprovando persistência entre sessões de interface, não permanência contínua do modal. A hipótese de fechamento inesperado continua registrada para investigação; não declarar jornada completa ou estabilidade visual até aprovação e inspeção da próxima execução.

## Correção estrutural candidata — continuidade do painel

Encontrado mecanismo de remontagem intencional em AuthenticatedKyrubApp: ProductCrossDeviceSyncBridge, IntegrationTestOrderBridge e KyrubDeliveryOpportunityBridge acionam refreshLegacyCache, que incrementa a chave de LegacyApp. O modal candidato de Freelas estava dentro dessa árvore. É uma explicação plausível, não causa comprovada do fechamento observado. A correção move somente a propriedade do modal candidato e sua renderização para o pai estável, fora da árvore remontada; callbacks do card Catu delegam ao pai exclusivamente com gate local já existente. Estado vinculado ao UID autenticado e descartado quando usuário muda ou sai; nenhuma alteração ao modal legado, rotas, sincronização ERP, entregas ou requisitos de autenticação. Roteiro Chromium mantém reentrada deliberada e acrescenta verificação de presença do painel do prestador após seleção na outra conta. Não considerar correção comprovada sem nova CI.
