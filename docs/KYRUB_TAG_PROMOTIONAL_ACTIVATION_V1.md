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
- A emissão promocional no Control Plane utiliza o transporte administrativo já existente, limitado ao Super Admin ativo com e-mail verificado. Cria lotes de 1–10 adesivos por solicitação, com chave idempotente, registro de auditoria e URL individual; **não** comprova que o chip foi gravado. Não existe endpoint anônimo de emissão.
- `kyrub_tag_minimal_identities/{uid}` registra `tag_only` para a identidade verificada de uma tag, sem criar `users/{uid}` ou loja. A promoção para `full` depende de uma ação expressa do titular. Contas Kyrub que já possuem `users/{uid}` não são reclassificadas.

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
- **Três gates separados, todos desligados por padrão:** `KYRUB_TAG_PROMO_ISSUANCE_ENABLED` (emissão de lotes pelo Super Admin), `KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED` (primeira reivindicação e recuperação), `VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE` (a entrada do app consulta a identidade mínima antes de abrir o legado). Não ativar nenhum dos três sem homologação coordenada. O terceiro é flag de build Vite, portanto exige rebuild/redeploy.
- Enquanto a terceira flag estiver desligada, um usuário de identidade mínima que entrar diretamente na raiz `/` poderá passar pelo bootstrap legado. Para as telas da nova tag, os links de descoberta usam `/?entry=welcome`; o gate de identidade deve obrigatoriamente ser ativado e testado **antes** de liberar a campanha em produção.
- Firebase Auth precisa ter provedor email/password e login por link habilitados, com domínio `kyrub.com` autorizado. Homologar links em Android e navegador, inclusive mudança de aparelho e de e-mail, sem expor o e-mail na URL.
- Revisar abuso de envios, limitação de tentativas, logs de alteração e procedimentos de suporte.
- O inventário e a emissão administrativa inicial estão implementados no Control Plane, com limite de 10 unidades por lote e gravação NDEF `overwrite:false`. **Ainda faltam** verificação física NFC documentada por unidade, prevenção de duplicatas físicas, gestão de entrega, descarte e conciliação de estoque antes de distribuição em escala.
- Fotos de capa/perfil e contatos particulares foram modelados com isolamento, opt-in de divulgação e testes de regras; **ainda faltam** verificação visual/funcional em Android, limpeza de mídias e avaliação de LGPD. Links de lojas/comunidades seguem pendentes.
- Testes automatizados no emulador Firestore/Auth foram adicionados para concorrência de dois reivindicantes, idempotência, e-mail não verificado, URL protegida, emissão Super Admin, isolamento do piloto, bloqueio e recuperação, rotação de códigos, privacidade pública e ausência de `users/{uid}`/loja antes da promoção explícita. **Eles não substituem teste no Android nem o preflight do provedor email-link real.**
- Validar o retorno do editor por e-mail em celular Android e navegador; testes com atendimento de recuperação. A confirmação de disparo do Firebase Auth em produção é um gate separado.
- Como o URL público **não prova posse do adesivo**, prevenir falsa alegação de chip seguro ou antifalsificação física.


## Identidade mínima — salvaguardas
1. Ao concluir o link de e-mail, o navegador informa ao servidor o ID da unidade promocional; o servidor valida a sessão Firebase, verifica que a unidade é promocional e registra `tag_only`, se não houver conta Kyrub preexistente.
2. A própria primeira reivindicação transacional também cria o registro `tag_only`, evitando que uma corrida entre abas deixe a unidade sem marcação de identidade. A recuperação com outro e-mail faz o mesmo para o novo titular.
3. Na raiz `/`, com a flag Vite habilitada, o aplicativo consulta `view=identity` com ID token. `tag_only` recebe uma tela de escolha; somente o botão **Quero criar minha conta Kairubido** promove o registro para `full`.
4. Se a consulta falhar, o gate com flag ligada **falha fechado**, oferecendo repetição. O componente LegacyApp, que provisiona `users/{uid}` e a loja particular, não é montado silenciosamente.
5. A criação completa da conta depois da promoção ainda precisa de E2E visual e de Firestore em dispositivos reais. O fluxo de vínculo opcional de uma identidade de tag com uma **outra conta Kyrub já existente** é uma etapa separada e não deve reatribuir `ownerId` apenas com um @ informado.

## Lotes promocionais — limites
- O Super Admin confirma explicitamente a emissão e recebe um lote de 1 a 10 endereços. A mesma solicitação repetida com o mesmo `requestId` não cria novo lote, mesmo com concorrência.
- O botão **Gravar em tag vazia** executa Web NFC NDEF com `overwrite:false` e somente a URL da unidade. A interface não armazena status físico comprovado no Firestore e orienta nova leitura manual.
- Unidades protegidas/código de entrega e unidade piloto 001 não são emitidas nem reivindicadas pelas rotas promocionais.

## Cartão visual e SOS particular — etapa de implementação

- O editor do titular contém capa e foto de perfil opcionais. O aplicativo aceita JPEG, PNG ou WebP de até 8 MB de entrada; no próprio dispositivo redimensiona e reencoda para WebP de no máximo 1 MiB, eliminando metadados incorporados na imagem de origem. A imagem não é salva na conta Kyrub nem em uma URL social externa.
- A tag guarda somente os caminhos privados das duas mídias. A coleção Storage `kyrub-tag-media/{id}/{slot}/{assetId}` exige autenticação do proprietário, e-mail verificado, finalidade e metadados coerentes, e não permite substituir arquivo existente. Uploads somente após a reivindicação do adesivo.
- **O visitante não recebe caminhos privados nem URLs permanentes de Firebase Storage.** A rota consolidada `GET /api/health?transport=public-kyrub-tag-media&id=...&slot=cover|avatar` consulta a versão atual da tag e só devolve bytes WebP quando estiver publicada e não bloqueada, sem cache. Se ocorrer bloqueio simultâneo, a rota revalida o estado antes de responder.
- O bloqueio interrompe novas leituras da apresentação e imagens pela aplicação, mas **não apaga cópias previamente salvas, capturas de tela ou URLs compartilhadas externamente**. A política de retenção/limpeza de arquivos substituídos e de imagens órfãs ainda precisa de homologação.
- O titular pode cadastrar até **dois contatos particulares de emergência**. Por padrão ficam privados, sem projeção pública. Para mostrar um contato no SOS, deve optar pela exposição e declarar que informou e obteve a concordância da pessoa. Essa declaração não representa verificação independente do consentimento de terceiros.
- Os contatos podem ter nome, relação, telefone brasileiro com DDD e indicação opcional de WhatsApp; a URL de WhatsApp é derivada do número validado apenas no painel SOS. O novo cartão **não divulga Instagram ou redes sociais gerais**.
- A API pública usa uma projeção mínima que exclui contatos privados, e-mail de administração, identificador interno do proprietário e caminhos privados de fotos. O conteúdo persistido não é liberado diretamente pelo Firestore, sujeito às regras existentes.
- 190/192/193 são apresentados como discagem no Brasil; **não** há acionamento automático de emergência, envio de localização nem garantia de atendimento.

### Pendências e testes antes de lançamento

1. Integrar e verificar as regras Storage atualizadas em ambiente isolado, depois fazer preflight das regras realmente publicadas, somente com autorização.
2. Comprovar upload, remoção, substituição, bloqueio e reativação de fotos no Chrome Android e navegador, inclusive quando a conexão falha.
3. Medir custo, latência e limite da rota de imagem, implementar limpeza autorizada de arquivos substituídos/órfãos e política de retenção após bloqueio definitivo.
4. Revisar com privacidade/LGPD a divulgação de telefones de terceiros; opção de retirar autorização e corrigir contato deve funcionar imediatamente, inclusive em dispositivos diferentes.
5. Confirmar limites de tamanho, exibição do cartão em tela pequena, legibilidade do SOS e fluxo de recuperação após perda do e-mail. Não usar imagem em atendimento automático.
6. Proteger a publicação de imagens contra conteúdo inadequado ou malicioso antes de ampliar a distribuição promocional.
7. Prosseguir com vínculo opcional entre a identidade mínima e conta Kyrub já existente, preservando a prova de titularidade.

## Compatibilidade
- Não excluir, migrar, alterar ou reaproveitar a unidade piloto 001, os campos da loja, IDs de outras tags ou os produtos Pro/Business.
- Não reutilizar código de ativação de produto comercial como código de recuperação.
- Não expor `Instagram` nas novas apresentações promocionais; redes sociais externas legadas permanecem sob revisão separada, sem exclusão silenciosa de dados de titulares existentes.
- Nova função de claim não deve fazer merge nem habilitar flag por passar testes unitários: aceite de segurança e do fluxo de recuperação é obrigatório.
