# Kyrub — inventário Mercado Pago somente leitura, antes do novo Pix

**Objetivo:** disponibilizar em Admin → Integrações & Infraestrutura uma consulta limitada de lojas publicadas e vínculo OAuth Mercado Pago para planejar a migração. Esta PR NÃO muda o checkout nem habilita o emissor da PR #956.

**Fonte:** `tenants` com `publicationStatus=published`, limitada a 50 registros (a 51ª linha determina se a leitura é parcial); usa `stores` e o caminho primário existente somente para confirmar identidade canônica. Registro em `stores/{uid}/paymentProviderConnections/mercado_pago` é consultado como metadado, sem abrir o cofre de tokens e sem atualizar nada.

**Segurança:** GET autenticado de Super Admin já existente em `/api/admin/operations/health?transport=mercado-pago-migration-inventory`; `Cache-Control: no-store`; apenas quatro últimos dígitos da conta MP. O relatório contém indicadores de possível identidade ambígua e obriga pré-validação real e revisão de pedidos em aberto. Um estabelecimento *publicado* não é necessariamente uma loja *com vendas ativas*, e zero estabelecimentos publicados não prova ausência de pagamentos históricos.

**Operação:** o usuário informou haver uma única loja ativa, mas o sistema deverá confirmar a situação do seu cadastro e recebimentos. Não habilitar novas flags; não alterar token, conexão, estoque, pedido ou split; não presumir que todos os lojistas estão migrados.

**Após merge futuro:** abrir o inventário no Admin e confirmar o cadastro. A PR #956 será sincronizada a esse commit, sem duplicar o inventário. Uma transação Pix real precisa de autorização humana separada.
