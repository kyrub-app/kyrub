# Convites de equipe para pessoas sem conta — contrato de segurança

## Estado
Especificação para implementação; **não existe envio automático nem resgate de convite por e-mail/telefone em produção**. Os convites atuais para contas existentes continuam em `stores/{storeId}/members/{uid}`.

## Autoridade e identidade
- O cliente autenticado solicita a emissão ao servidor com `storeId`, e-mail de destino e papel delegável. O servidor valida o token Firebase Auth, a associação ativa do solicitante à loja e a permissão de convidar aquele papel; nunca confia em `actorRole` fornecido pelo navegador.
- O e-mail do destinatário é normalizado no servidor. O registro pendente é privado, não enumerável e não pode ser lido por consultas públicas. Não salvar token de resgate em texto claro; guardar apenas hash criptográfico e expiração.
- WhatsApp, SMS e e-mail são **canais de entrega**, não prova de identidade. O link não concede acesso por si só. Não usar `users/{uid}.email` como prova, pois é editável pelo usuário.
- O resgate exige Firebase ID token válido, e-mail do Auth correspondente e `email_verified=true`, conferidos no servidor. O servidor associa o UID ao convite e cria ou ativa o **mesmo** registro canônico `stores/{storeId}/members/{uid}` em operação idempotente.
- O convite não deve ser aceito automaticamente. Após resgate, permanece `invited` até o destinatário aceitar no sino ou em Renda → Trabalhos → Minhas empresas.
- Nunca permitir que o emissor aceite em nome do destinatário; o proprietário não é papel delegável.

## Ciclo de vida e limites
1. `issued`: criado por emissor autorizado; armazena loja, emissor, e-mail normalizado, papel, dados organizacionais, expiração, estado e token em hash.
2. `claimed`: destinatário autenticado e verificado, com e-mail correspondente; associação ao UID criada com status `invited`.
3. `accepted` ou `declined`: apenas o destinatário decide, usando a associação canônica existente.
4. `expired` ou `revoked`: não pode ser resgatado.

Reenvio por canais diferentes referencia **o mesmo convite**, sem criar associações duplicadas. Definir expiração curta, limite de tentativas, auditoria sem token, revogação pelo gestor, tratamento de conflitos de UID e respostas que não revelem se um e-mail possui conta. Restringir leituras e gravações de convites pendentes ao servidor Admin SDK; atualizar regras e testes de emulador antes de disponibilizar endpoints.

## Interface
- No formulário, distinguir “Convidar conta existente” de “Convidar por e-mail quem ainda não tem conta”. A segunda ação fica indisponível até o endpoint seguro existir.
- WhatsApp/SMS podem abrir o aplicativo local com mensagem, mas a interface não pode afirmar que houve envio.
- Não usar link genérico `https://kyrub.com` como se fosse token de convite; para o fluxo de resgate futuro, emitir URL individual com token de uso limitado.
- A tela de login pode orientar o convidado a entrar com Google; após verificação, o resgate deve ocorrer no backend e o aceite aparecer nas notificações canônicas.

## Critérios de liberação
Testes: emissor sem permissão, e-mail não verificado, e-mail divergente, token inválido/expirado/reutilizado, convite revogado, corrida de dois resgates, usuário com vínculo prévio, tentativas entre lojas, rejeição pelo destinatário e não exposição do token em logs. Executar testes de regras e E2E antes de publicar.
