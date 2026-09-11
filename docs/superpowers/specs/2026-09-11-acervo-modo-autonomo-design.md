# Modo autônomo do acervo: briefing, estrategista e aprovação no celular — design

**Data:** 2026-09-11
**Status:** aguardando revisão do dono
**Estende:** `docs/superpowers/specs/2026-09-10-scheduled-post-campaigns-design.md` e `docs/automation-libraries.md` (o acervo, migração 077)
**Migrations livres na hora do desenho:** a última é a `077_automation_libraries.sql`; este design ocupa a **`078`**.

---

## 1. Por que existe

O acervo de hoje sabe coletar, tratar e publicar. O que ele **não** sabe é decidir. As regras do Gemini são um texto fixo aplicado igual a toda mensagem, e o agendamento é aritmética: `delivery_mode: interval` soma N segundos ao anterior. Isso funciona, mas o dono continua sendo o cérebro — ele escreve a instrução, ele escolhe o ritmo, e ele revisa item a item.

O pedido é mover o cérebro para dentro: um modo em que a IA **escolhe o que vai ao ar e quando**, guiada por um briefing sobre o negócio, e chama o dono no celular quando precisa do aval.

O risco é diferente de tudo que a IA faz hoje neste repositório. O tratamento erra um texto e o dono corrige antes de publicar. Aqui, uma decisão errada **publica no canal de verdade**, e o Telegram não desfaz. Todo o desenho abaixo existe para que a autonomia seja real sem que o pior caso seja "a IA despejou quarenta posts de madrugada".

## 2. O princípio que governa o escopo

Emprestado do Jarvis do projeto Darius (`/d/projetos/clone instagram/app/jarvis_conversa.py`), onde está escrito no cabeçalho do módulo:

> "**Nada do que o modelo pede é executado aqui.** O processo Qt não abre o banco. Toda chamada de função viaja pelo cano até a ponte, passa por `validar` e pelo `ExecutorJarvis` no processo do Studio, e o que volta é só o resultado."

Traduzido para cá: **o modelo propõe, um validador sem rede dispõe, e o que publica continua sendo a engrenagem que já existe.** Em concreto, três regras que o resto do documento obedece:

1. A IA nunca escreve direto em coluna que controla publicação. Ela devolve uma proposta; uma função pura confere e converte.
2. A validação roda contra a **linha do banco**, nunca contra o que o modelo devolveu sobre si mesmo.
3. Nenhum caminho novo toca o Telegram. O plano aprovado vira `scheduled_at` + `delivery_status: pending` — exatamente o que `automation_library_claim_due` já consome.

## 3. Estado de partida

O que já existe e este design **reusa em vez de recriar**:

- **`automation_library_items`** já tem `scheduled_at`, `delivery_status`, `status` e recibo por etapa. Um item tratado em modo revisão fica `status: ready` + `delivery_status: draft` — que é exatamente a forma de um *candidato*.
- **`automation_library_claim_due`** (migração 077) já reivindica um item vencido por vez, com trava por bot, e o worker já publica com retomada por etapa confirmada.
- **`GeminiClient.generateJson`** já faz structured output nativo com `responseSchema`, e desde hoje repete 408/429/5xx com backoff e marca o erro como `transient`.
- **`sendPushToTenant`** (`server/src/services/push.ts`) já entrega push web por tenant, com VAPID configurado no worker; `push_subscriptions` é a migração 037.
- **A pista do worker** (`server/src/workers/library-worker.ts`) já tem o formato de "uma função por tarefa, chamada a cada 5s, com trava em memória" — coletar, tratar, entregar. O estrategista entra como a quarta.

**O que NÃO existe e este design cria:** um documento de estratégia legível, um cerco que o modelo não alcança, um objeto "plano do dia" com aprovação, e a tela que os mostra.

## 4. As quatro peças

### 4.1 O briefing

Aba nova no acervo (`/dashboard/automations/scheduled/libraries/[id]/brief`), ao lado de Acervo · Origens · Regras · Fila. Duas metades:

**O chat.** O dono conta a oferta, o público, o que quer ver no canal. A cada mensagem, o Gemini devolve `{resposta, brief}`: a resposta aparece na conversa, o `brief` substitui o documento estruturado.

**O documento, visível e editável em formulário:**

| Campo | O que é | Limite |
|---|---|---|
| `oferta` | o que se vende, em uma frase | 500 |
| `publico` | quem é, o que quer | 500 |
| `tom` | a voz do canal | 300 |
| `pilares` | temas que devem aparecer | 10 itens × 80 |
| `evitar` | o que nunca entra | 20 itens × 80 |
| `cta` | a chamada principal | 200 |
| `objetivo` | `vendas` \| `audiencia` \| `aquecimento` | enum |

O documento é editável na mão **de propósito**. Ele governa todas as decisões seguintes; um prompt escondido que o dono nunca lê seria impossível de depurar quando o estrategista começasse a decidir torto.

O chat não agenda, não publica e não mexe no cerco. A única saída dele é esse documento.

### 4.2 O cerco

Vive em `automation_libraries.rules.autonomy`, editado **só pela tela** de Regras:

```ts
autonomy: {
  enabled: boolean,          // desligado = tudo se comporta como hoje
  max_posts_per_day: number, // 1..24
  window: { start: "08:00", end: "22:00" },  // no fuso do acervo
  min_gap_minutes: number,   // 5..720
  weekdays: number[],        // 0..6, domingo = 0
}
```

Tipos de conteúdo liberados reusam `rules.allowed_kinds`, que já existe.

**Nenhum schema de IA contém esses campos.** O modelo não tem vocabulário para pedir mais posts por dia; a proposta dele só sabe falar de item e horário.

### 4.3 O estrategista

Uma função pura, em `server/src/services/automation-library/strategist.ts`:

```ts
planejarDia(entrada: {
  brief: Brief;
  cerco: Autonomy;
  candidatos: Candidato[];   // {id, kind, preview (200 ch), tem_midia, data_origem}
  recentes: Publicado[];     // {kind, at} dos últimos 3 dias
  agora: Date;
  fuso: string;
}, ai: JsonGenerator): Promise<{ slots: Slot[]; excecoes: Excecao[] }>
```

Os candidatos vão **resumidos**: o modelo escolhe entre eles, não precisa carregá-los inteiros. Os recentes são o que permite variar tipo e ritmo em vez de repetir.

Saída do modelo, via `responseSchema`: `{ slots: [{item_id, at, why}], notes? }`.

O `why` de cada slot não é enfeite: é o texto que o dono lê na tela de aprovação. Uma decisão que não sabe se explicar não merece ser aprovada.

### 4.4 O validador

`validarPlano(bruto, cerco, candidatos, agora, fuso) → {slots, excecoes}` — sem rede, no mesmo arquivo, e é onde mora o grosso do valor testável:

| Situação | Resultado |
|---|---|
| `item_id` inexistente, de outro acervo, ou já enviado | **descarta** (o modelo não inventa item) |
| mesmo `item_id` repetido | mantém o primeiro |
| horário fora da janela, ou em dia não liberado | **exceção** |
| acima do teto diário | mantém os primeiros; resto vira **exceção** |
| intervalo menor que o mínimo | descarta o slot que aperta |
| horário no passado, ou além de 48h | descarta |
| `kind` fora de `allowed_kinds` | **exceção** |

Descarte é silêncio (o modelo errou); exceção é pergunta (o modelo quis algo que o dono talvez queira permitir). A exceção carrega o bastante para o dono decidir sem abrir outra tela:

```ts
type Excecao = {
  motivo: "fora_da_janela" | "dia_nao_liberado" | "acima_do_teto" | "tipo_nao_liberado";
  item_id: string;
  at: string;      // o horário que o modelo queria
  why: string;     // a justificativa do modelo
};
```

Aprovar uma exceção agenda **aquele slot**, uma vez. Não afrouxa o cerco: o limite continua valendo para amanhã. Quem muda o cerco é a tela de Regras.

## 5. O plano do dia e a aprovação

A tela (`/dashboard/automations/scheduled/libraries/[id]/plano`) mostra o dia inteiro: horário, prévia, tipo e o `why` de cada slot; as exceções à parte, cada uma com sim ou não. Ações: **Aprovar o dia**, mudar um horário, remover um slot, recusar tudo.

O push web leva direto para essa tela (`sendPushToTenant` com `url`).

**Aprovar** chama a RPC `automation_library_approve_plan(p_plan_id, p_slots)`, `security definer`, conferindo `auth.uid()` contra o `tenant_id` lá dentro — granted a `authenticated`, ao contrário das três RPCs de worker, que são `service_role`. Ela, numa transação:

1. relê o plano e recusa se não estiver `pending`;
2. para cada slot: confere que o item ainda é `ready` + `draft` + do mesmo acervo, e que o horário ainda está no futuro;
3. grava `scheduled_at` + `delivery_status: pending` nos que passaram;
4. marca o plano `approved`, guardando quantos entraram e quantos foram pulados.

Meio-aprovado não existe. Aprovar duas vezes é inofensivo.

### Travas explícitas

- **Plano não aprovado não publica.** Expira no fim do dia. Silêncio nunca vira publicação.
- **Aprovação atrasada não despeja o dia.** Horários já vencidos no momento do sim são descartados com aviso — não saem seis posts de uma vez às 22h.
- **O cerco vai fotografado junto do plano.** Sem isso, aprovar amanhã um plano feito sob um cerco que mudou hoje aplicaria limites que já não valem.

## 6. Onde roda

Quarta pista no `library-worker`, ao lado de coletar / tratar / entregar:

```
planejar(library) → só se: autonomia ligada
                         · sem plano pendente ou aprovado para hoje
                         · existem candidatos
```

**Quando nasce e o que cobre:** o plano é criado no primeiro ciclo do dia em que
as três condições valem, e cobre de **agora até o fim do dia**, no fuso do
acervo — não o dia inteiro em retrospecto. Um acervo ligado às 14h recebe um
plano das 14h às 22h, não um que já nasce com a manhã vencida. Um dia só tem um
plano: se o dono recusar, não nasce outro até amanhã (recusar é uma decisão, não
um pedido de nova tentativa).

Reusa a janela de espera criada para o Gemini: um 503 não vira plano quebrado, apenas não vira plano **neste ciclo**. Sem candidatos não monta plano e **não notifica** — um app que avisa para dizer que não tem nada é um app que o dono silencia.

A mesma pista expira planos `pending` cujo `plan_date` já passou no fuso do acervo.

## 7. Falhas e estados degradados

| Falha | Comportamento |
|---|---|
| Gemini fora do ar / sobrecarregado | nenhum plano neste ciclo; tenta no próximo |
| Push não entrega | o plano continua lá, com aviso no painel. **Push é cortesia, não fonte da verdade** |
| Dono não aprova | expira no fim do dia; nada publica |
| Item mudou entre o plano e o aprovar | slot pulado, e a tela diz quais e por quê |
| Autonomia desligada | tudo idêntico a hoje |
| Briefing vazio | não planeja; a tela pede o briefing primeiro |

## 8. Dados (migração 078)

```sql
alter table public.automation_libraries
  add column brief jsonb not null default '{}'::jsonb,
  add column brief_version integer not null default 0;

create table public.automation_library_brief_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  library_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  foreign key (library_id, tenant_id)
    references public.automation_libraries(id, tenant_id) on delete cascade
);

create table public.automation_library_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  library_id uuid not null,
  plan_date date not null,                      -- dia coberto, no fuso do acervo
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired')),
  brief_version integer not null,
  limits jsonb not null,                        -- retrato do cerco
  slots jsonb not null,                         -- [{item_id, at, why, kind}]
  exceptions jsonb not null default '[]'::jsonb,
  scheduled_count integer,
  skipped_count integer,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (library_id, tenant_id)
    references public.automation_libraries(id, tenant_id) on delete cascade
);
create unique index automation_plan_open on public.automation_library_plans (library_id, plan_date)
  where status in ('pending','approved');
```

RLS nas duas tabelas novas no mesmo molde da 077 (`tenant_id = auth.uid() or public.is_admin()`).

## 9. Testes

O valor está concentrado numa função sem rede, então é lá que fica o grosso:

- **`validarPlano`**, em tabela — um caso por linha da matriz da seção 4.4, mais o caminho feliz.
- **`planejarDia`** com um Gemini falso: monta o pedido com candidatos resumidos, respeita o schema, e propaga `transient` sem virar plano.
- **RPC de aprovação**: item que mudou de estado no meio; aprovação atrasada descartando horário vencido; aprovação repetida sendo inofensiva; plano de outro tenant recusado.
- **Pista do worker**: não cria plano duplicado no mesmo dia; não cria com autonomia desligada; não notifica sem candidatos; expira plano de ontem.
- **Briefing**: o chat produz documento válido; documento inválido do modelo não sobrescreve o anterior; o chat não consegue alterar o cerco.
- **Telas**: plano renderiza slots e exceções; recusa da action aparece como dado (convenção do repo).

## 10. Fora de escopo, deliberadamente

- **Aprendizado por resultado** (visualizações via MTProto realimentando as decisões). É a fase 3. Sem histórico de post publicado, qualquer "aprendizado" agora seria chute com cara de dado.
- **Plano de mais de um dia.** Horizonte de 48h. Planejar a semana antes de saber se o diário acerta é otimismo.
- **Conversa contínua / voz, como no Jarvis.** Aqui o chat existe para produzir um documento, não para operar o sistema.
- **A IA escrever post do zero.** Ela escolhe e trata o que está no acervo. Conteúdo inventado é outro produto, com outro risco.

## 11. Ordem de implementação sugerida

1. Migração 078 + tipos e validação do briefing e do cerco (sem UI).
2. `validarPlano` com a bateria de testes — o coração, antes de qualquer rede.
3. `planejarDia` + pista do worker + push.
4. RPC de aprovação e a tela do plano.
5. A aba de briefing (chat + formulário).
6. Seção Autonomia na tela de Regras.

Cada passo é commit próprio e deixa o sistema funcionando: com autonomia desligada, nada do que está acima muda o comportamento atual.
