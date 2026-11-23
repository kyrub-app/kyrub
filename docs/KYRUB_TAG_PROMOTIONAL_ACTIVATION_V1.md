# Kyrub Tag — distribuição promocional e primeira ativação

Atualização: 23/11/2026. Implementação candidata isolada, **não liberar emissão real** sem a bateria de aceitação abaixo.

## Decisão do proprietário
- Adesivo promocional pode ser distribuído sem nome, conta ou e-mail de destinatário. O recebedor pode entregá-lo como presente.
- **A primeira pessoa com e-mail comprovadamente verificado que concluir a ativação ganha a titularidade.** A posse física prévia não é exigida nem comprovada: o endereço NFC pode ser copiado e reivindicado por quem o conheça. Esse risco foi expressamente aceito para adesivos promocionais.
- Produtos oficiais futuros de venda **não herdam** a política promocional: usam contrato próprio de entrega, ativação e eventual autorização individual, sem necessidade de cadastrar destinatário no ato de emissão.
- A leitura pública não é autenticação. O e-mail é **privado**, nunca incorporado à URL NDEF, à página pública ou aos links de SOS.
- A conta Kyrub completa é **opcional**. Um usuário Firebase Auth mínimo, verificado via link enviado ao e-mail, pode administrar a unidade. A futura ligação com perfil, lojas e comunidades exige prova de controle da conta Kairubido, não digitar o nome de usuário de outra pessoa.

## Domínios e modos distintos
- `distribution='promotional'`: somente estoque criado expressamente pelo provisionador confiável. `ownerId=null`, `enabled=false`, `activationHash=null`, `reservedEmailHash=null`, `blocked=false`. Primeira reivindicação ocorre em transação.
- `protected`/legado/sem campo: mantém reserva/código/UID e checagens atuais. **A unidade experimental 001 não pode ser convertida automaticamente** em promocional.
- O provisionamento promocional inicial está implementado como **função de servidor confiável**, sem emissão anônima HTTP. Ferramentas administrativas para lotes, produção física e comercialização pertencem a uma etapa de controle específica.

## Experiência
1. Admin emite um ID forte e imprime/grava somente `https://kyrub.com/tag/{id}` no adesivo. Nunca registra credenciais no chip.
2. O destinatário lê e abre o formulário público: nome, atividade e apresentação opcionais. Foto de capa/perfil e contatos pessoais de emergência permanecem pendentes até existir armazenamento e consentimento adequados.
3. Ao salvar, confirma seu e-mail via Firebase Auth (link por e-mail). Não precisa fazer onboarding Kyrub.
4. O endpoint obtém o e-mail **diretamente do Firebase Admin Auth**, com `emailVerified=true`, e registra o primeiro proprietário em uma transação. Nenhum código de entrega é solicitado.
5. O servidor fornece um código de recuperação com 192 bits aleatórios, exibido uma vez, cujo hash fica no banco. Um código novo é gerado ao recuperar a tag, invalidando o anterior. Não exibir nem enviar o código nos URLs, logs, respostas públicas ou chip NFC.
6. O proprietário pode salvar a apresentação pública, pausar ou bloquear a tag individualmente. O bloqueio deixa de expor o cartão; chip e URL permanecem legíveis.
7. Em caso de perda do e-mail, uma **nova identidade de e-mail verificada** e o código de recuperação podem reassumir a gerência, mantendo `firstOwnerId` para auditoria. Após recuperação, a tag fica bloqueada até revisão explícita. Não é livre transferência: sem o código, conhecer URL/e-mail ou possuir o chip não basta.
8. O visitante vê cartão público e SOS estático com 190/192/193 para discagem local no Brasil; a tag não chama atendimento nem envia localização automaticamente.
9. A vinculação opcional posterior do titular ao seu perfil Kairubido requer desenho adicional de linking de identidades Firebase sem tomada de conta. Não transferir `ownerId` com base em @ público.

## Controles e pendências de produção
- Flag server-side `KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED` **desligada por padrão**, exigindo ativação operacional separada para emitir/reivindicar estoque promocional; não habilitar no deploy desta PR.
- Firebase Auth precisa ter provedor email/password e login por link habilitados, com domínio `kyrub.com` autorizado. Homologar links em Android e navegador, inclusive mudança de aparelho e de e-mail, sem expor o e-mail na URL.
- Revisar abuso de envios, limitação de tentativas, logs de alteração e procedimentos de suporte.
- Implementar preparação de lotes de adesivos no Control Plane, inventário, verificação física NFC e identificação de duplicatas antes de distribuição em escala.
- Confirmar política de foto/capa, consentimento de contatos de terceiros e links de lojas/comunidades, com avaliação de LGPD.
- Adicionar comprovantes de transações no emulador: dois claimants simultâneos; idempotência; tentativa com e-mail não verificado; URL de piloto/protegida; bloqueio; recuperação e revogação; tentativa de outro UID; acesso público sem titularidade.
- Validar o retorno do editor por e-mail em celular Android e navegador; testes com atendimento de recuperação. A confirmação de disparo do Firebase Auth em produção é um gate separado.
- Como o URL público **não prova posse do adesivo**, prevenir falsa alegação de chip seguro ou antifalsificação física.

## Compatibilidade
- Não excluir, migrar, alterar ou reaproveitar a unidade piloto 001, os campos da loja, IDs de outras tags ou os produtos Pro/Business.
- Não reutilizar código de ativação de produto comercial como código de recuperação.
- Não expor `Instagram` nas novas apresentações promocionais; redes sociais externas legadas permanecem sob revisão separada, sem exclusão silenciosa de dados de titulares existentes.
- Nova função de claim não deve fazer merge nem habilitar flag por passar testes unitários: aceite de segurança e do fluxo de recuperação é obrigatório.
