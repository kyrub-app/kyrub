# Identificação segura da chave do writer Firebase

## Escopo e reaproveitamento

Complemento delimitado à PR #1137, base `f4271df`. Busca realizada em
`server/firebaseAdmin.ts`, `server/gamification/`, `scripts/` e `tests/` por
`private_key_id`, atestação, assinatura e inventários. O bootstrap canônico usa
`FIREBASE_SERVICE_ACCOUNT_JSON`; não havia prova de posse de chave vinculada a
um desafio de inventário. Este utilitário usa a mesma variável no workload;
não inicializa outro Firebase app, não cria rota, coleção ou regra de saldo,
não altera o bootstrap e não substitui as guardas transacionais existentes.

Arquivos: `scripts/lib/firebase-key-attestation.mjs`, CLI
`scripts/attest-firebase-writer-key.mjs`, teste isolado Node sem dependências
`tests/firebase-key-attestation.test.mjs`. Frente C com dependência operacional
F (leitura de metadados do deployment). Sem comportamento novo na aplicação.

## O que a prova estabelece

Um desafio aleatório de 256 bits, válido por cinco minutos, identifica projeto
Vercel, equipe, deployment, URL imutável, SHA completo, ambiente e email da
service account. O workload assina uma representação restrita desses campos
com RSA-SHA256 e prefixo de domínio próprio, que não é um JWT OAuth.
Somente o key ID público e a assinatura saem do workload. Dados extras do JSON
de credenciais, chave privada e tokens não saem. Erros são sanitizados.

O verificador fixa o desafio original e uma tabela de certificados públicos
obtida do Google por um canal independente. Não aceita uma chave pública
fornecida pelo workload. Alteração de payload, nonce, chave declarada,
projeto Firebase, conta, validade ou assinatura rejeita a prova.

**Isso prova posse da chave, não a origem de execução.** Variáveis `VERCEL_*`
podem ser copiadas por quem possui a chave. A origem precisa de evidência
autoritativa adicional da Vercel: execução controlada no deployment/ambiente
selecionado, ID de execução e metadados de deployment/SHA obtidos pela conexão
autenticada. Sem essa evidência, registrar apenas `KEY_POSSESSION_ONLY`.
Um build comprova o ambiente de build; não comprova sozinho credencial do runtime.
Uma nova preview não comprova a variável efetiva de um deployment antigo.

O retorno exige `requiresProviderDeploymentEvidence=true` e conserva
`writersVerified=false`. O utilitário nunca escreve esse campo. A assinatura
não prova ausência de outros consumidores, a guarda transacional nem o SHA
efetivamente executado. Os metadados assinados são declarações, até correlação.

## Procedimento de coleta (preparado, não executado em produção)

1. Pela conexão autenticada Vercel da equipe
   `team_25OGqyxIioK3rzvUdgDPASc5`, obter o deployment de produção atual e as
   previews com acesso ao Firebase do projeto
   `prj_X7hpqaftcikyA8jAK7Iec8HOkqqp`: ID, URL imutável, SHA, funções/rotas,
   gatilhos, ambiente, revisões ativas, responsável. Preservar referência da
   consulta; não exportar valores de variáveis.
2. Em máquina confiável do verificador, fornecer contexto não secreto via stdin
   ao comando `node scripts/attest-firebase-writer-key.mjs challenge`.
   `projectId` é o ID do projeto **Vercel**; o Firebase é fixado em
   `kyrub-b8d0e`. Campos obrigatórios:

   ```json
   {
     "projectId": "prj_X7hpqaftcikyA8jAK7Iec8HOkqqp",
     "teamId": "team_25OGqyxIioK3rzvUdgDPASc5",
     "deploymentId": "ID confirmado na Vercel",
     "deploymentUrl": "host imutavel confirmado na Vercel",
     "gitSha": "SHA completo de 40 caracteres confirmado na Vercel",
     "environment": "production",
     "serviceAccountEmail": "firebase-adminsdk-fbsvc@kyrub-b8d0e.iam.gserviceaccount.com"
   }
   ```

   Substituir os três exemplos de deployment/host/SHA por valores reais. Nunca
   usar aliases móveis como prova de revisão.
3. Executar `node scripts/attest-firebase-writer-key.mjs attest`, com o desafio
   no stdin, **dentro do workload controlado**, que já possui a credencial.
   Não copiar o segredo da Vercel para a estação. O comando exige `VERCEL=1`,
   `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA` e `VERCEL_ENV` coerentes; valida os IDs
   adicionais quando injetados. Se a Vercel não oferecer execução no deployment
   existente, esse passo continua pendente. Este trabalho não cria uma rota
   remota nem promete que a Vercel oferece shell em runtime.
   Uma integração diagnóstica futura precisaria usar o controle administrativo
   existente, autenticação forte, autorização limitada ao operador e uma janela
   curta; qualquer implantação em produção exige autorização separada.
4. No verificador, obter os certificados públicos atuais de
   `https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40kyrub-b8d0e.iam.gserviceaccount.com`
   por HTTPS. Confirmar key ID/estado/tipo/validade no IAM. Não obter dados
   privados. Não reutilizar indiscriminadamente cache antigo nem aceitar
   certificado carregado junto com a prova.
5. Fornecer `{ "challenge": <original>, "proof": <retorno>, "trustedKeys":
   <mapa Google keyId -> PEM> }` por stdin a
   `node scripts/attest-firebase-writer-key.mjs verify`, dentro dos cinco minutos.
   Registrar o desafio como consumido no registro operacional do verificador;
   este utilitário sem persistência não oferece armazenamento antirreplay.
   Um desafio diferente invalida a prova antiga. Arquivar resultado e evidência
   de execução Vercel juntos. Não transformar uma repetição da mesma prova em
   confirmação independente.
6. Repetir por deployment/ambiente e por consumidor externo. A chave pode ser
   compartilhada por vários serviços. Ausência de métrica não prova desuso.

Nenhuma etapa requer revelar o valor da variável sensível. O utilitário não
consulta rede, não gera token, não acessa Firestore e não modifica credenciais.
O teste usa chaves efêmeras sintéticas e não acessa GCP/Vercel.

## Gate e sequência mínima futura

- Mapear cada uma das quatro chaves Firebase Admin a todos os consumidores ou
  obter evidência operacional verificável de desuso. Incluir impersonação e
  credenciais de usuário, não apenas as chaves listadas.
- Confirmar revisões de produção pela Vercel; cruzar os escritores já
  classificados em `WELCOME_100_PITANGAS_FINAL_INTEGRATION.md` com cada SHA
  realmente implantado. O `redemptionRepository` legado é isolado na PR e não
  possui guarda; não conectá-lo. Se surgir consumidor ativo, preparar remoção
  controlada do chamador ou migração ao emissor canônico, sem reescrever ledger.
- Exigir guarda na mesma transação antes de mutações dos writers conflitantes.
  Não considerar a mera identificação da chave suficiente para `writersVerified`.
- Só após fechar as evidências: autorização separada para merge, deploy e
  configuração do fence/epoch/corte. Integrar a PR, implantar revisões protegidas
  com campanhas desligadas, confirmar identidades/revisões e ausência de caminhos
  conflitantes, então configurar `writersVerified` e habilitar gradualmente os
  sinais existentes sob autorização. Deploy/configuração do gatilho Auth real
  também fazem parte dessa autorização; não retrocreditar contas antigas.
- Observar somente leituras e métricas/recibos autorizados; uma concessão real
  de homologação exige aprovação. Rollback operacional autorizado: desligar os
  sinais existentes para impedir novos créditos/conversões, preservando recibos,
  ledger e saldos. Não reintroduzir revisões antigas que ignorem o fence.

Sem a cobertura externa e as revisões, o gate continua fechado. Não há pedido
de novos papéis Owner/Editor nem de rotação por suposição.
