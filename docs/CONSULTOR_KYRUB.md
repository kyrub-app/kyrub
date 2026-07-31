# Consultor Kyrub

## Propósito

O Consultor Kyrub é a camada de inteligência artificial do aplicativo. Ele deve tornar o Kyrub mais simples para o usuário sem substituir o modo manual, duplicar regras de negócio ou criar uma dependência operacional da IA.

## Princípios obrigatórios

1. **O modo manual nunca será removido.** Toda função existente deve continuar disponível pelas telas tradicionais.
2. **A IA é uma nova porta de entrada.** Texto, voz, botões e automações devem convergir para as mesmas ações e serviços do Kyrub.
3. **A IA não grava diretamente no Firestore.** Toda ação passa por serviços, validações, permissões e auditoria do Kyrub.
4. **Ações importantes exigem confirmação.** Criações em lote, publicações, convites, alterações de preço ou estoque e exclusões devem apresentar um resumo antes da execução.
5. **O Consultor nunca inventa dados do usuário.** Sugestões precisam ser identificadas como sugestões e dados necessários devem ser perguntados.
6. **Falhas da IA não podem impedir o uso do aplicativo.** O modo manual continua disponível quando o provedor estiver fora do ar ou sem cota.
7. **Cada habilidade é independente.** Uma falha em uma skill não deve afetar as demais.
8. **Toda execução futura deve ser auditável.** O Kyrub deve registrar quem solicitou, o que foi proposto, o que foi confirmado, qual serviço executou e qual foi o resultado.

## Primeira fase funcional

A primeira fase oferece conversa real por texto na guia Kyrub I.A.

Disponível:

- conversa autenticada com o Consultor Kyrub;
- assuntos e conversas independentes;
- histórico local no dispositivo;
- orientação, organização e preparação de planos;
- mensagens de erro honestas quando o provedor não estiver configurado ou disponível.

Ainda não disponível:

- execução de ações no aplicativo;
- chamada de skills;
- histórico persistente na nuvem;
- voz;
- automações;
- acesso autônomo a dados privados do usuário.

## Arquitetura alvo

```text
Tela manual ───────┐
Consultor Kyrub ───┼──► Ação/serviço do Kyrub ───► validação ───► Firestore
Voz ───────────────┤
Automação ─────────┘
```

O provedor de modelo fica atrás de uma interface interna. A primeira implementação usa Gemini, mas o restante do Kyrub não deve depender diretamente do SDK ou do formato do provedor.

## Política de confirmação futura

Antes de executar uma ação relevante, o Consultor deve informar:

- ação pretendida;
- registros afetados;
- dados que serão usados;
- campos ainda ausentes;
- efeitos públicos, financeiros ou irreversíveis;
- opção de confirmar, alterar ou cancelar.

## Áreas sensíveis

Para saúde, treino e bem-estar, o Consultor oferece informação geral, organização e apoio, sem se apresentar como médico, psicólogo ou substituto de atendimento profissional. Em situações de risco, deve priorizar segurança e orientação para ajuda adequada.

## Bússola de produto

> O Kyrub deve parecer simples para o usuário, mesmo sendo poderoso por dentro.
