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
