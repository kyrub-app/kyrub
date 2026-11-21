# Endereços públicos e cartão digital multifuncional

## Decisão arquitetural — 21/11/2026
- Loja: /@kyrub-oficial (existente, preservar).
- Kairubido: /kairubido/maufco (identificador de usuário, não nome de exibição).
- Comunidade: /comunidade/nacao-roqueira (slug exclusivo nessa categoria).
- Cartão: /cartao/{identificador permanente} (não depende do nome do proprietário).
- Sem aliases curtos globais. /staff e /api continuam operacionais/privados.

## Aceite físico registrado
O gestor informou nesta conversa que gravou a tag NFC pelo cartão digital de Dispositivos com o endereço da Kyrub Oficial, aproximou novamente seu smartphone e abriu a vitrine. Aceite de gravação e reconhecimento de URI NDEF, não de HCE nem de comunicação entre dois celulares.

## Implementação na PR #1222
Contrato de URLs, reserva explícita por proprietário, páginas de apresentação, cartão com até oito destinos e gravação NFC sem sobrescrita. Lojas e comunidades públicas podem ser indicadas; não implicam titularidade. Identificadores sociais permanecem reservados e não podem ser alterados nesta versão. O cartão tem ID aleatório de 128 bits; desativá-lo bloqueia todos os acessórios associados, reativá-lo restaura todos. Para perda de um único acessório e revogação seletiva será necessária futura gestão de cartões por acessório. Nenhuma alteração de produção executada.

## Critérios de aceite e revisão antes de publicação
1. Resolver usuário pelo identificador canônico e verificar a política vigente de visibilidade; projetar apenas campos públicos permitidos, sem e-mail/telefone/documentos/UID privado.
2. Criar reserva transacional de slug de comunidade, vinculada ao ID imutável; tratar duplicidades e migração dos registros existentes; validar visibilidade atual em cada leitura. Comunidades privadas não são divulgadas; moderadas não têm conteúdo restrito exposto.
3. Criar registro de cartão com identificador aleatório estável, proprietário autenticado, destinos escolhidos e revogação. Revalidar cada destino no servidor a cada leitura, omitir removidos/privados, impedir gravação de links arbitrários.
4. Montar páginas públicas na aplicação e rewrites no Vercel sem nova função serverless; não ativar caminhos que não têm resolução real.
5. Expandir o card Dispositivos com seleção explícita de perfil, lojas e comunidades, prévia do cartão, confirmação e gravação de uma URI permanente. Preservar o modo direto da loja e nunca sobrescrever tag sem ação explícita. Não vincular automaticamente uma tag à conta.
6. Verificar concorrência, autorização, colisões, alterações de nome, revogação, visitantes anônimos e regressões do storefront. HCE fica em fase nativa independente.
