# Minha Tribo — refinamento incremental

PR #1272, sem dependência da PR #1273. Menu contextual ancorado ao card nativo, sem modal de tela inteira; fecha ao tocar fora, Escape e deslocamento da tela. Favoritos privados sincronizados por Firestore, usando a conexão existente; estrela apenas indicativa. Grupo usa transação e preserva alterações concorrentes; histórico individual usa o mesmo marcador da PR #1272; denúncia usa o fluxo de moderação existente e independe de status publicado. Remover conexão conserva confirmação.

Bloqueio centralizado pertence à PR #1273; não duplicar lógica de bloqueio local. Tribo Reservada ainda não implementada: exige política de acesso, PIN protegido, limitação de tentativas, bloqueio de vazamentos em outras superfícies e testes. Não afirmar privacidade forte a partir de mera ocultação no cliente. Antes de combinar branches, revisar conflitos em ProfileSocialHubNative, useSocialDirectoryV2 e regras, preservar histórico individual e bloqueios servidor. Não realizar merge/deploy de produção.

## Nomenclatura oficial aprovada em 24/11/2026
- Conectados: relações pessoais individuais e área que reúne Geral, Frequentes, Tribos e Novos.
- Tribos: círculos personalizados de contatos, anteriormente Grupos.
- Tribo Reservada: círculo protegido de contatos, futura implementação com autorização específica, código secreto e proteção nas demais superfícies.
- Comunidades: espaços coletivos, nomenclatura inalterada.
Mudança de apresentação somente: IDs, eventos, rotas, limites e coleção users/{uid}/contact_groups permanecem. Não migrar dados. Reaplicar esta nomenclatura ao reconciliar a PR #1273, que permanece intacta durante a homologação. Não confundir Tribo Reservada com bloqueio social ou privacidade de comunidade.
