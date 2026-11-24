# Gamificação V1 — validação integrada (24/11/2026)

Base auditada: e4bc5301108f087693ce3a94dafbc4104fdb2fd2. Branch de teste independente das PRs #1271–#1274. Vercel desabilitada nesta branch pelo wildcard existente em vercel.json.

## Escopo e evidências

- Boas-vindas: gatilho Auth emulado e recibo de criação confiável, 100 Pitangas, sem retroatividade.
- Primeira publicação: verificador de evidência persistida, 2 XP/0 Pitangas, chave compartilhada com desafio legado para impedir duplicidade. A mera criação da loja não prova publicação.
- Conversão: /api/pitangas, 1000:1 voluntária, débito/XP/recibo atômicos, fence transacional com projeto e epoch, recusa de saldo insuficiente.
- Jornada: semeadura é projeção não econômica. Crédito por pitangueira ainda não existe; não fabricar saldo para simular integração.
- Lacuna de teste: mesma identidade Auth e conta canônica, reexecução concorrente da recompensa, saldo/XP antes/depois e conversão negada sem mutação.

O novo cenário em tests/welcome-auth-created-emulator.test.ts reutiliza o Auth/Firestore/Functions Emulator. Evidência de publicação é fixture explícita, não uma execução real da jornada ERP. Conversão positiva continua sendo requisito separado; este caso demonstra a recusa com 100 Pitangas e a negação com fence não verificado. O CI do novo commit ainda não foi verificado.

## Liberação continua bloqueada

Consultar docs/PITANGA_WRITER_DEPLOYMENT_EVIDENCE.md e docs/GAMIFICATION_ACTIVATION_DELIVERY.md. Revisão estática não prova todos os escritores implantados. Não habilitar flags, writersVerified em projetos reais, emitir Pitangas/XP, publicar regras ou alterar faturamento. Não requer Blaze para o emulador. Sem mudanças em runtime.


## Jornada transversal — diretriz do proprietário, 24/11/2026

A validação comercial e a social/gamificação compõem um único E2E de aceitação: descoberta da Kyrub (Tag ou acesso direto), cadastro autenticado, comunidade, desafio da plataforma divulgado em publicação da comunidade e encaminhado à Taba, engajamento/Conectados, Catu e loja, publicação verificada, pedido/ERP/estoque/conciliação, conta de recompensas e conversão voluntária.

Não transformar a ordem de teste em pré-requisito obrigatório do produto: loja e acesso direto continuam independentes de comunidade/Tag. A publicação divulga um desafio; a autoridade continua sendo o cadastro canônico do Control Plane e a comprovação server-side do evento. Encaminhamento não cria novo desafio nem duplica recompensa; expiração da Taba não elimina o desafio na origem. Semeadura não representa saldo creditado hoje. A ligação de divulgação de desafio ao post canônico e seu CTA deve ser auditada antes de qualquer implementação. Reutilizar a mesma conta de aceitação e uma segunda identidade para interações que exigem outra pessoa. Não conceder 900 Pitangas artificiais em ambiente real para forçar conversão. Conversão positiva deve usar saldo legitimamente creditado ou fixture explicitamente isolada, jamais equivalência visual.

Dependências: #1274 autenticação isolada aprovada conforme relato do Work; regras publicadas e cache ainda não comprovados, piloto reservado desligado; inventário de escritores econômicos e autorização de emissão ainda pendentes; testes Pix/PSP e GPS condicionados a seus próprios gates. Não misturar branches nem habilitar funcionalidades para contornar bloqueios. E2E automatizado complementa, não substitui aceitação real.

CI 790fda5: build, Validate Kyrub e Phase 10 aprovados; workflow Welcome falhou na última asserção do novo teste (linha 206), porque Auth Emulator omite isNewUser em login existente. O teste havia alcançado a etapa após as verificações de saldo, publicação concorrente e recusa de conversão. Corrigida a asserção para notEqual(true), mesmo contrato dos testes existentes, mantendo igualdade de UID e extrato. Nova execução pendente.

## Vínculo institucional — primeira etapa
Vinculação explícita e única de comunidade pública própria por Super Admin ativo e proprietário com membership owner ativo. GET/POST autenticados reutilizam autorização e cotas existentes; rechecagem transacional e auditoria. Documento server-only, sem alteração de regras de comunidades, autorias, recompensas ou postagens. Não é possível substituir vínculo nesta etapa; futura operação de suspensão/reconfiguração exige revisão. A divulgação de desafios e Taba continua pendente. A comunidade real ainda precisa ser selecionada após homologação autorizada. CI do vínculo pendente.

### Resultado do CI e correção do teste
12949ce: Application build e Welcome 100 aprovados. Validate Kyrub falhou no primeiro GET do teste institucional (429 em vez de 401): os casos de saturação deliberada do ingress eram anteriores ao teste novo. Movido o teste institucional para antes de ambos os casos de saturação, sem modificar limites, autorização, regras ou runtime. Acrescentado teste UI para carregamento sob demanda, seleção exata, cancelamento, confirmação e reconsulta do vínculo; novo CI pendente.

## Divulgação institucional em emulador
08480fc: 11/11 workflows aprovados. Implementada divulgação autenticada e transacional de desafio publicado/ativo no canal vinculado, com post canônico e ponteiro Taba opcional (janela existente de 24h), recibo por desafio e replay sem duplicação. Autor sintético sem conta pessoal; marcador fora do whitelist de criação/edição de posts comuns. Os mapeadores mural/Taba reconhecem o marcador. Semear não disponível em comunicados institucionais nesta etapa, para não acumular progresso econômico em conta pessoal ou sintética antes da política correspondente. O texto remete à Central Pessoal, sem duplicar recompensa ou concedê-la; CTA direto para desafio e catálogo vivo ainda pendentes. UI de divulgação e confirmação usa API existente. A operação de escrita exige flag, projeto demo-global-challenges e ambos emuladores locais, sem Vercel ou credenciais; não pode ser habilitada em produção. Revisar demais superfícies de leitura, moderação/retirada e publicação real antes da liberação. Teste novo em suite existente; CI pendente. Nenhuma mudança em regras publicadas, flags reais, saldos ou faturamento.
