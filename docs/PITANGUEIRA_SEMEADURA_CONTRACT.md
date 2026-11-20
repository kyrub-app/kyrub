# Jornada da Pitangueira — contrato de semeadura (pré-homologação)

**Status:** implementação isolada e desativada em produção. Este documento não autoriza
publicação, distribuição de recompensas, conversão automática ou acesso a saldos.

## Semear, um gesto social

- O botão **Semear** substituirá **Curtir** em publicações elegíveis, primeiro nas
  Comunidades e depois nas pessoais. O coração dos cards é reservado a **Favoritar**;
  **Salvar** permanece ação distinta.
- Uma pessoa autenticada só pode semear uma vez cada publicação canônica. A
  semeadura da própria publicação é proibida.
- Uma publicação de Comunidade compartilhada na Praça não vira outra fonte de
  sementes: conserva a identidade da publicação original.
- O autor, não o administrador ou fundador da Comunidade, é o único beneficiário
  econômico possível.
- A Comunidade soma as semeaduras de suas publicações exclusivamente para uma
  **Jornada coletiva pública** (bosques e estágios). Isso não gera uma carteira
  monetária da Comunidade nem rendimento automático para seu proprietário.

## Progressão aritmética

| Estágio | Total de sementes reconhecidas | Equivalência |
|---|---:|---|
| Semente | 1 | Uma semeadura válida |
| Broto | 10 | Dez sementes |
| Muda | 100 | Dez brotos |
| Pitangueira | 1.000 | Dez mudas = **uma Pitanga** |
| Bosque | 100.000 | **100 pitangueiras = 100 Pitangas** |
| Cocar (ícone de XP) | 1.000.000 | Dez bosques = **1.000 Pitangas = 1 XP** |

O **1 XP não é creditado automaticamente** ao alcançar dez bosques: ele depende
da conversão voluntária existente, com os controles do ledger canônico.

**Teto definitivo por publicação:** a centésima milésima semeadura aceita
conclui um bosque e fecha permanentemente aquela publicação para novas
semeaduras. Não existe reabertura automática nem um segundo bosque por post.

**Acúmulo pessoal:** o mesmo autor pode totalizar sementes de muitas
publicações pessoais e comunitárias. Dez publicações com um bosque cada
equivalem a um milhão de sementes / mil Pitangas, sem precisar de um post viral.

## Separação entre progresso e economia

- A métrica de sementes, brotos, mudas, pitangueiras e bosques é pública em
  superfícies que tenham autorização de leitura.
- O **saldo disponível de Pitangas**, o extrato econômico e os **XP pessoais**
  pertencem à conta privada do autor, não aos visitantes.
- A projeção `pitangasEquivalent` do módulo compartilhado é **informativa**;
  nunca deve ser lida como saldo creditado, bônus a sacar ou conversão já feita.
- O crédito real por completar uma pitangueira exige um escritor de
  recompensas **no servidor**, transação no ledger existente, recibos de
  elegibilidade verificável e proteção antifraude. Não usar um contador
  editável nem confiar no navegador.

## Estado técnico desta PR

1. `shared/pitangueiraJourney.ts` define os fatores e o fechamento por um bosque.
2. `server/gamification/semeaduraService.ts` escreve contador e recibos
   **imutáveis** numa única transação Firestore e recusa autorreconhecimento,
   repetição, publicação inválida e falta de associação à Comunidade.
3. `api/action-execute.ts?transport=semeadura` usa a função Vercel existente,
   token Firebase validado e a flag `KYRUB_SEMEADURA_SERVER_ENABLED`.
   Por padrão, responde `SEMEADURA_NOT_ENABLED` antes de tocar no banco.
4. As interfaces de Mural, Praça e perfil pessoal já contêm **Semear**,
   mas exibem a ação nova somente com a flag de build
   `VITE_SEMEADURA_UI_ENABLED=true`. Com flag desligada, o botão Curtir
   anterior segue intacto e funcional.
5. As leituras autenticadas `status`, `journey` e `community-journey`
   distinguem publicação fechada/semear já realizado, mostram progresso
   acumulado do autor e bosques visuais da comunidade.
6. Cada semeadura atualiza, na mesma transação, o contador do post e
   projeções **não econômicas** do autor e da comunidade; a comunidade
   não recebe Pitangas. Nenhuma coleção nova está exposta por regras do
   cliente: o acesso passa somente pelo serviço autenticado.
7. **Não** migra curtidas antigas, **não concede Pitangas ou XP**, nem
   publica eventos econômicos. As curtidas atuais só mudam mediante
   liberação explícita do modo Semear e migração segura do histórico.

## Bloqueios de ativação

- Definir e testar a migração de curtidas antigas para semeaduras sem criar
  recompensas duplicadas.
- Validar no navegador real os cards nas três superfícies e os painéis
  de jornada. A leitura autorizada já está implementada; ainda requer testes
  visuais, experiência mobile e validação de volume/concorrência.
- Validar o comportamento de desfazer (por enquanto, recibos imutáveis; nunca
  permitir farming sem reversão econômica segura).
- Desenvolver antifraude, elegibilidade, retenção e conciliação do ledger
  canônico e prêmio por pitangueira. Não criar uma segunda moeda.
- Testar concorrência de 99.999 → 100.000 semeaduras em Firestore Emulator,
  repetição, troca de conta, múltiplos posts e post deletado.
- Só habilitar flags e publicar após homologação da jornada completa.
