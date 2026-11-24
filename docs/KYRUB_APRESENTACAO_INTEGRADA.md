# Apresentação integrada e múltiplas Kyrub Tags

Uma identidade de apresentação, adesão voluntária ao Kyrub e divulgação explícita por dispositivo. Evolução empilhada sobre #1271; não alterar sua prévia ou unidades de homologação.

## Primeiro incremento
Apelido privado por unidade; seleção explícita de uma ou várias unidades ativas e de destinos públicos do cartão multifuncional publicado. Sem pré-seleção, sem regravação, sem alterar apresentação, SOS ou titularidade. Atualização transacional, com limite de oito destinos, verificação de propriedade, e-mail confirmado e conta completa. Destinos privados não são projetados publicamente.

## Próximos incrementos (não implementados)
- Importação consentida da apresentação ao concluir o cadastro com a mesma identidade verificada; seleção da Tag de origem se múltiplas. Não sobrescrever perfil preexistente, nem importar SOS, segredos ou caminhos privados de mídia.
- Consolidar fonte canônica e configurações por dispositivo; definir conflitos e migração.
- Editor de perfil com comunidades e lojas, cartão dos contatos da Minha Tribo e convite opcional de atualização seletiva. Reutilizar seletor e destinos canônicos.
- Remoção individual de destinos nos adesivos promocionais; revogação explícita.
- Homologação isolada e aprovação antes de merge.

## Segundo incremento
Na adesão voluntária, escolha opcional da Tag de origem. O servidor importa nome, atividade e até 280 caracteres de biografia para o perfil existente na arquitetura, somente se ainda não houver conta nem apresentação. O marcador de adesão e a criação do perfil são transacionais. Sem importação de SOS, fotos ou segredos. A apresentação original permanece intacta. A atividade passa a ser editável no perfil. A integração com o editor de espaços e o cartão dos contatos ainda requer implementação.

## Terceiro incremento
O editor de perfil reaproveita o cartão multifuncional, com catálogo de espaços públicos pertencentes à conta, seleção por nome, confirmação explícita de publicação e seletor opcional de Tags. Não se cria outra coleção de links. Destinos anteriormente cadastrados permanecem editáveis, inclusive indicações públicas. Ainda falta a projeção desses espaços no cartão dos contatos e a sincronização de apresentação/mídia. A publicação do cartão é uma ação separada de salvar nome e biografia.

## Quarto incremento
Cartão de apresentação compartilhado entre as superfícies de contatos, com nome, foto pública, atividade, biografia, links públicos do cartão multifuncional e ação de chat para conexões existentes. Consulta autenticada no servidor, respeita visibilidade do perfil e dos destinos; sem feed, Status, e-mail, SOS ou campos privados. A apresentação privada não é reconstruída a partir de dados antigos do contato. Capa e sincronização de mídias permanecem pendentes.

## Quinto incremento
Sincronização explícita a partir do perfil salvo: escolha uma ou várias Tags promocionais ativas, selecione texto, foto própria armazenada no Firebase e/ou capa. As imagens são reencodadas e carregadas separadamente para cada unidade, sem reutilizar referências privadas entre dispositivos. A publicação dos campos é transacional, condicionada à titularidade e à revisão da fonte. Fotos externas não são copiadas. SOS, destinos e credenciais permanecem intactos. O editor passa a permitir capa e o cartão de apresentação a exibi-la. Ainda falta importação de mídia da Tag para o perfil, remoção seletiva de destinos, testes reais de Storage e navegador, e limpeza de arquivos staged sem referência após falha. Não habilitar em produção sem homologação.

## Personalização de fundo
Imagem de fundo opcional e independente de foto e capa, com camada escura para leitura. Pode ser adicionada/removida no perfil e no editor promocional de cada Tag. Cópia seletiva do fundo do perfil salvo para unidades escolhidas usa o mesmo fluxo de reencodificação, verificação de mídia e transação. Nenhuma publicação automática; mídia de fundo da Tag usa slot privado próprio e proxy revogável. Homologação de navegador e Storage pendente.

## Componente visual comum e ações contextuais
PresentationCard reúne foto, capa, fundo, nome, atividade, biografia e espaços públicos. ContactPresentationModal mantém a ação de chat; PublicKyrubTagPage mantém o SOS, contatos de emergência e edição da unidade. A Tag promocional permite retirar cada espaço de forma independente, inclusive quando bloqueada, sem reativá-la. Nenhuma alteração de titularidade, segredo, perfil, outras unidades ou NFC. Importação de mídia da Tag para o perfil e homologação funcional continuam pendentes.

## Simplificação: primeiro incremento
O endereço permanente /kairubido/{identificador} renderiza PresentationCard com a mesma projeção pública do cartão da Minha Tribo, sem SOS nem chat. Link copiável e compartilhamento nativo no endereço público e na Tag publicada; sem QR externo. SOS fixo na parte inferior da Tag ativa, com painel rolável e espaço reservado para não encobrir o conteúdo. O editor visual, o modo de acompanhar perfil com consentimento e controle de privacidade, QR local e importação de imagens ainda precisam ser concluídos. Nenhuma alteração em produção.

## Rodapé de aquisição
Rodapé complementar após a apresentação e a CTA principal. Link de adesão com contorno, acesso à Loja Oficial e lema. Titular promocional de identidade mínima recebe mensagem específica e pode promover voluntariamente a conta pelo fluxo já existente. Visitantes recebem mensagem sem sugestão de reaproveitar dados alheios; membros confirmados recebem Explorar o Kyrub. Identificação consulta a rota autenticada existente; não classifica uma sessão mínima como conta completa. SOS inline e barra fixa continuam acessíveis durante rolagem. Corrigida a importação de readFileSync no teste de compartilhamento que causou TS2304. Ações sociais contextuais, notificações, QR local, edição visual, acompanhamento automático e importação de mídia continuam pendentes.

## Conexões contextuais — primeiro incremento
Ações de relação consultam uma transação autenticada sobre a coleção connections existente. Tag promocional exige conta completa, perfil público, unidade ativa e consentimento por dispositivo (inicialmente desligado). Identidades mínimas não enviam/recebem conexão. O sino acompanha solicitações pendentes da mesma coleção em tempo real; aceitar/recusar atualiza Minha Tribo sem criar registros de notificação duplicados. O indicador soma pendências e notificações não lidas (marcar lidas não resolve pedidos). O chat usa a regra existente de conexão aceita. Bloqueio legado ainda é local; falta consolidar bloqueios no servidor antes da liberação social NFC. QR, editor visual, acompanhamento automático e importação de imagens continuam pendentes. Testes de navegador e emulador específicos obrigatórios.

## Bloqueio social persistente
Bloqueios direcionais privados em social_contact_blocks/{uid}/blocked/{targetId}, escrita exclusiva do servidor. A transação remove a conexão correspondente sem apagar mensagens; consultas e mutações sociais verificam ambas as direções. Regras Firestore impedem recriação, aceitação e chat enquanto houver bloqueio. Desbloqueio remove somente a própria decisão e não restaura relacionamento. O painel exibe os bloqueios próprios e a migração dos antigos registros locais no aparelho autenticado, preservando entradas até confirmação. Bloqueios antigos em dispositivos ainda não utilizados não são detectáveis à distância. SOS e acesso público anônimo permanecem independentes. Corrigido teste de contrato do botão de chat movido para PresentationRelationship. Homologação específica ainda pendente.
