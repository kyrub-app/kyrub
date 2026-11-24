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
