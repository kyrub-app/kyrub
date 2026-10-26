# Homologação de acesso Firestore — 26/10/2026

## Escopo e origem

Workstream F, a partir de `feat/profile-react-rebuild`, commit `56670975cf45a14b89f3c66e757817cec4427e5c`, em `homolog/firestore-access-hardening`.

O anexo `Texto colado(4).txt` foi recuperado da conversa e tratado como snapshot fornecido pelo usuário do Firebase Console. SHA-256: `b8e15042a61631d9e55dc0844edbb68706b7d03c6b332ee14a59d6c2eed0f8c2`. Não houve consulta ao ruleset de produção para confirmar se esse snapshot continua publicado.

`firebase.json` aponta para `.firebase/firestore.combined.rules`. A fonte das correções é `scripts/firestore-rule-composition.mjs`; editar somente `firestore.rules` não basta, pois o compositor substitui seções completas. O arquivo gerado continua ignorado pelo Git.

## Console versus composição da base

A comparação ignora diferenças de fim de linha. Além das permissões em artifacts, a composição da base já contém alterações ausentes no anexo: catálogo privado em `users/{uid}/private_store/catalog_customization`, bloqueio de mudanças diretas de status/pagamento por funcionários e coordenação do caixa para bloquear escritas legadas durante migração. Essas diferenças foram preservadas, sem redesenhar os respectivos contratos.

| Área | Anexo do Console / base | Homologação |
| --- | --- | --- |
| Entregas | Qualquer autenticado lê todas, inclusive atribuídas/concluídas | Leitura por UID de loja, comprador ou entregador atribuído; disponíveis apenas para entregador com identidade aprovada |
| Candidaturas | Leitura geral; claims globais permitem alterar/remover; candidato pode alterar vínculos | Leitura do candidato ou administrador; nenhuma escrita de cliente |
| Artifacts | Console permite leitura entre tenants; base já restringe leitura, mas fallback permite ao dono apagar pedidos | Mantém isolamento da base e remove customerOrders do fallback cumulativo |
| Catálogo privado | Regra ausente no anexo, presente na base | Preservada; regressões de proprietário, terceiros, listagem, exclusão e tamanho executadas |

## Contratos e compatibilidade

As entregas permanecem projeções escritas exclusivamente pelo servidor. UIDs confiáveis são `storeId`, `buyerId` e `acceptedBy`; nomes de exibição nunca autorizam leituras. Não foi concedido acesso adicional a claims globais de funcionário.

Quatro consultas de acompanhamento agora filtram pelo respectivo UID no Firestore. O mural usa consulta OR pelos três vínculos e inclui `status == available` apenas após observar aprovação de bicicleta/motorizado. Mudança da aprovação recompõe a consulta; troca de conta, revogação e erros limpam o cache. O teste real da assinatura cobre aprovação, revogação e encerramento.

O contrato legado de tenant continua baseado em UID do proprietário. A regra geral preserva operações em outros documentos legados; a exceção de customerOrders mantém criação de pedido presencial pendente/não pago e cancelamento restrito pelo comprador. A exclusão de customerOrders fica proibida inclusive para o dono, sem permissão cumulativa alternativa.

O modal atual de freelas já bloqueia candidaturas até existir registro seguro no servidor. Não foi inventado um schema de vaga/tenant nem uma autorização por papel global: submissão, aceite, atualização e exclusão passam a exigir um fluxo privilegiado futuro. Empregadores não recebem acesso a candidaturas de terceiros sem um vínculo validado.

## Evidências e validação

Três testes de negação foram executados contra a composição original: leitura de entrega por estranho não aprovado, leitura de candidaturas sem filtro e exclusão de pedido pelo dono. Os três falharam porque as operações foram permitidas; isso reproduz os riscos da base, sem tocar em dados reais.

Passaram 118 testes de regras (sem falhas/cancelamentos) e 86 testes de regressão do aplicativo, incluindo os 12 de composição: total 204. A compilação Vite e do servidor esbuild terminou com sucesso. `npm run lint` (TypeScript, sem emissão) também passou. Os hashes constam no relatório entregue com os logs. Os testes novos de candidaturas e artifacts foram incluídos no comando padrão `test:rules`, que antes omitia a suíte de artifacts.

A composição foi repetida e gerou bytes idênticos. Os testes de composição cobrem idempotência e Windows CRLF. O emulador compila o ruleset completo; nenhum `firebase deploy`, inclusive dry-run, é necessário para esta validação local.

Neste Windows, foi necessário iniciar o JAR local do emulador com `-Duser.language=en -Duser.country=US` para evitar uma falha interna de mensagens no locale pt_BR. A instalação npm exigiu `NODE_OPTIONS=--use-system-ca` para usar certificados confiáveis do Windows. Não foi desativada a validação TLS e nenhum desses ajustes altera produção.

## Limites e pendências

- Nenhuma publicação Firebase, migração de dados ou alteração de produção foi executada.
- Entregadores aprovados ainda leem o documento completo de oportunidades disponíveis, incluindo destino. Uma projeção pública reduzida é uma evolução distinta, que exige contrato com o servidor e o produto.
- Registros antigos de entrega sem UID confiável não ganham acesso por nome; precisam de reconciliação no servidor.
- A liberação funcional de candidaturas depende de serviço que valide vaga, tenant, identidade e transições.
- Permissões gerais já existentes em `users` e `vagas` permanecem fora deste patch. O documento users pode conter email; a leitura geral por autenticados merece revisão separada. Claims globais ainda permitem mudanças em vagas.
- Emulador não comprova índices, autenticação e comportamento de produção. Gates remotos `Application build` e `Validate Kyrub`, revisão independente e homologação com contas representativas continuam necessários antes de merge/deploy.
- O rollback deste patch é reverter o commit de homologação. Nenhum rollback em produção é necessário porque ela não foi alterada; reverter futuras regras publicadas exige revisão, pois reabre riscos conhecidos.

## Revisão das regras propostas

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for delivery participants, approved couriers viewing available jobs, private applications and tenant-owned artifacts. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Referências do Firebase: [regras não filtram consultas](https://firebase.google.com/docs/firestore/security/rules-query) e [permissões cumulativas em matches sobrepostos](https://firebase.google.com/docs/firestore/security/rules-structure).
