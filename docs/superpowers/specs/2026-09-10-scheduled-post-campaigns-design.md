# Campanhas de postagem agendada, clone em rascunho e tratamento por IA — design

**Data:** 2026-09-10
**Status:** aprovado, pronto pra virar plano de implementação
**Estende:** `docs/superpowers/specs/2026-07-23-telegram-channel-clone-design.md` (modo rascunho no clone), `docs/superpowers/specs/2026-09-02-social-proof-composer-v2-design.md` (o composer que vira genérico)
**Migrations livres na hora do desenho:** a última aplicada é a `073_social_proof_v2.sql`; este design ocupa a **`074`** e a **`075`**.

---

## 1. Por que existe

`app/dashboard/automations` sabe fazer duas coisas com uma conta MTProto: disparar **um** texto pra **muitos** alvos (`mtproto_campaigns` + `mtproto_targets`, a rota `new-campaign`) e **clonar** um canal inteiro pra outro quase instantaneamente (`clone_jobs`). Falta a terceira, que é a que sustenta canal de conteúdo: **muitas** mensagens, ao longo do tempo, pra **um** destino.

E falta o passo humano no meio. Hoje o clone raspa e publica na mesma passada: o dono descobre o que foi pro canal novo depois de já estar lá. Este design insere um estado intermediário — o **rascunho** — onde o conteúdo raspado fica editável, reordenável e agendável antes de qualquer coisa chegar no Telegram.

O terceiro eixo é autonomia: o Gemini limpa menções e links do concorrente, opcionalmente reescreve os textos, decide a cadência entre os posts e marca o que não vale a pena publicar — tudo antes de o dono abrir a tela, e tudo reversível depois que ele abrir.

**O princípio que governa o escopo:** a tela que já existe (`ComposerShell` + `FeedPreview` + `MessageEditor`, da Prova Social) é a tela certa pra isso. Nada de UI nova onde dá pra generalizar a existente, e nenhuma regressão na Prova Social — os testes dela são o portão da refatoração.

## 2. Estado de partida

O que já existe e este design **reusa em vez de recriar**:

- **`CloneRunner`** (`server/src/services/mtproto/clone/clone-runner.ts:26`) é injeção de dependência pura. `publish(group, replyToDestId)` é a única costura necessária: trocar essa função não toca cursor, retomada pós-`FLOOD_WAIT`, contadores, `clone_message_map`, pausa nem `messageLimit`.
- **`downloadAndRehostMedia`** (`server/src/services/mtproto/bot-clone/media-rehost.ts`) já baixa mídia via MTProto e sobe pro bucket `media` do Supabase, devolvendo URL pública estável.
- **`CompanionBot`** (`clone/bot-client.ts`) já publica texto com entities, mídia, álbum, enquete, botões inline e pin — via Bot API, com fallback MTProto pro que a Bot API não cobre.
- **O poller de recorrência** (`server/src/queue.ts:472`) é o molde exato do worker de disparo: a cada 30s, lê o que venceu, enfileira, marca pra não repetir no tick seguinte.
- **`FeedPreview` / `MessageEditor` / `MediaPicker`** leem *nomes de coluna*, não a tabela: `kind`, `content_text`, `media` (jsonb no shape `MediaItem[]`), `reply_to_id`, `offset_seconds`, `display_time`, `reactions`, `views_count`.
- **`promoteBotToAdmin`** (`services/mtproto/client.ts:1007`) já sabe convidar e promover o bot num canal, tolerando `USER_ALREADY_PARTICIPANT` e `USER_BOT`.
- **Zero integração de LLM no repositório.** O padrão do projeto pra API externa é `fetch` direto numa classe de serviço com deps injetáveis (`nowpayments.ts`, `zuckpay.ts`, `evpay.ts`), sem SDK.

## 3. Modelo de dados

### 3.1 Por que tabelas dedicadas, e não expansão de `mtproto_campaigns`

A pergunta foi levantada explicitamente. A resposta é não, por três motivos concretos:

1. `mtproto_campaigns.message_text` é `NOT NULL` e aqui não existe um texto único.
2. `mtproto_targets` modela *1 texto × N alvos*. Isto é a transposta: *N mensagens × 1 destino*. Não é o mesmo formato com um campo a mais.
3. **O que quebraria em produção:** `queue.ts:481` varre `mtproto_campaigns where status='scheduled' and recurrence_hours is not null` e enfileira `campaign.run`. Uma campanha de conteúdo morando nessa tabela cairia no `CampaignRunner` de Mass DM e tentaria mandar DM pros alvos. Toda query existente sobre `mtproto_campaigns` precisaria ganhar um filtro `kind`, e esquecer um único ponto é bug silencioso em produção.

O reuso que importa está na **UI** e na **camada de publicação**, não no formato da linha de campanha.

### 3.2 `074_scheduled_campaigns.sql` — a campanha

```sql
create table public.mtproto_scheduled_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',

  -- Destino: um dialog existente do tenant. null enquanto o rascunho não
  -- escolheu. dest_channel_id/access_hash são snapshot (o dialog pode sumir
  -- no próximo sync), mesmo raciocínio de clone_jobs.source_peer_id.
  dest_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  dest_channel_id text,
  dest_access_hash text,
  dest_title text,

  source_clone_job_id uuid references public.clone_jobs(id) on delete set null,

  status text not null default 'draft'
    check (status in ('draft','ai_processing','ready','running','paused','completed','failed')),

  start_at timestamptz,
  default_delay_seconds int not null default 900,

  ai_clean boolean not null default false,
  ai_rewrite boolean not null default false,
  ai_smart_delay boolean not null default false,
  ai_status text not null default 'idle'
    check (ai_status in ('idle','queued','processing','done','partial','failed')),
  ai_processed_count int not null default 0,
  ai_error text,
  ai_started_at timestamptz,

  total_messages int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
```

`ai_started_at` existe pelo mesmo motivo de `processing_started_at` na `030`: a trava de processamento da IA precisa de um TTL pra não deixar a campanha presa em `ai_processing` se o worker morrer no meio.

### 3.3 `074` — as mensagens

Os nomes de coluna da primeira seção **não são escolha estética**. São iguais aos de `social_proof_messages` porque é isso, e só isso, que faz `FeedPreview`, `MessageEditor` e `MediaPicker` funcionarem sem reescrita de lógica.

```sql
create table public.mtproto_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null
    references public.mtproto_scheduled_campaigns(id) on delete cascade,

  -- ── Espelho de social_proof_messages: o contrato com a UI existente.
  kind text not null default 'text'
    check (kind in ('text','photo','video','audio','album','document','poll')),
  content_text text,
  media jsonb not null default '[]'::jsonb,   -- MediaItem[], mesmo shape da 073
  reply_to_id uuid references public.mtproto_scheduled_messages(id) on delete set null,
  position integer not null default 0,

  -- ── Agendamento
  delay_seconds int not null default 900,     -- espera DEPOIS da anterior
  scheduled_at timestamptz,                   -- absoluto, calculado no launch
  silent boolean not null default true,

  -- ── Envio
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','skipped')),
  dest_msg_id bigint,
  sent_at timestamptz,
  error_message text,
  attempts int not null default 0,
  claimed_at timestamptz,

  -- ── Procedência do clone: o que o publish-router hoje entrega direto ao
  --    Telegram e que, no rascunho, precisa sobreviver em repouso.
  source_msg_id bigint,
  entities jsonb,        -- Api.MessageEntity[] cruas: negrito, link, spoiler
  inline_links jsonb,    -- [{label,url}] quando copy_buttons
  poll jsonb,            -- SourcePoll (question, options, isAnonymous, ...)
  file_name text,
  is_pinned boolean not null default false,

  -- ── IA
  content_text_original text,
  ai_action text check (ai_action in ('none','cleaned','rewritten','discarded')),
  ai_reason text,
  ai_discarded boolean not null default false,

  created_at timestamptz not null default now(),
  constraint sched_msgs_has_content
    check (content_text is not null
           or jsonb_array_length(media) > 0
           or poll is not null)
);
```

| Coluna | Papel |
|---|---|
| `delay_seconds` | O que o usuário edita. Relativo à mensagem anterior. |
| `scheduled_at` | Derivado, escrito uma vez no launch. É o que o poller consulta. |
| `source_msg_id` | Id na origem. Chave de idempotência (ver 3.4) e âncora do reply. |
| `entities` | Sem isso o rascunho perde negrito, link e spoiler — o clone live nunca precisou persistir porque publicava na hora. |
| `content_text_original` | Preenchido só na **primeira** vez que a IA mexe. Reescrever duas vezes não pode apagar o texto raspado. |
| `ai_discarded` | Independente de `status='skipped'`: separa "a IA reprovou" de "falhou no envio". |

**Sobre `kind`:** o domínio tem dois valores a mais que o de `social_proof_messages` — `document` e `poll` — porque o clone os produz e o bot sabe publicá-los. O `MessageEditor` continua oferecendo só os cinco tipos editáveis (`text`, `photo`, `video`, `audio`, `album`); uma linha `document` ou `poll` vinda do clone aparece no preview e pode ter texto editado, reordenado, atrasado ou apagado, mas **o seletor de tipo fica desabilitado nela** — converter uma enquete em foto não é uma operação que faça sentido. `CampaignExtras` mostra o motivo em vez do seletor.

Índices:

```sql
-- Idempotência do rascunho. Ver 3.4 — é o índice mais importante deste design.
create unique index idx_sched_msgs_source
  on public.mtproto_scheduled_messages (campaign_id, source_msg_id)
  where source_msg_id is not null;

-- O poller: status + vencimento. Parcial porque só 'pending' é consultado.
create index idx_sched_msgs_due
  on public.mtproto_scheduled_messages (status, scheduled_at) where status = 'pending';

-- A leitura da tela, com o mesmo desempate por created_at da 071.
create index idx_sched_msgs_campaign_pos
  on public.mtproto_scheduled_messages (campaign_id, position, created_at);
```

RLS no padrão da `071` — `tenant_id = auth.uid() or public.is_admin()` na campanha, subquery via `campaign_id` nas mensagens (o admin da plataforma gerencia a automação do cliente; sem `is_admin()` a tela abriria vazia pra ele).

### 3.4 O unique parcial compra idempotência que o clone live não tem

A migration `050_clone_resume_hardening.sql` documenta que **`publish()` não é idempotente**: dois runners no mesmo lote duplicam posts no destino, porque o upsert em `clone_message_map` dedupa a linha do mapa, não o envio real.

No modo rascunho isso deixa de valer. `publish` vira um `upsert` em `(campaign_id, source_msg_id)`, então uma retomada pós-`FLOOD_WAIT` que reprocesse um lote já gravado sobrescreve as mesmas linhas em vez de criar novas. A trava de processamento da `050` continua necessária (duas conexões MTProto lendo em paralelo é desperdício e risco de flood), mas o pior sintoma — conteúdo duplicado — deixa de existir nesse modo.

### 3.5 `075_clone_draft_mode.sql`

```sql
alter table public.clone_jobs
  add column if not exists mode text not null default 'live'
    check (mode in ('live','draft')),
  add column if not exists draft_campaign_id uuid
    references public.mtproto_scheduled_campaigns(id) on delete set null,
  add column if not exists ai_clean boolean not null default false,
  add column if not exists ai_rewrite boolean not null default false,
  add column if not exists ai_smart_delay boolean not null default false;
```

`default 'live'` mantém todo job existente com o comportamento de hoje. `dest_kind` e `dest_title` continuam `NOT NULL`: no modo rascunho, `dest_title` recebe o nome da campanha e `dest_kind` é derivado do dialog de origem como sempre — inofensivo, porque nada no caminho draft os lê.

## 4. Extração: o clone em modo rascunho

### 4.1 A costura

`CloneRunner.deps.publish` é o único ponto de troca. O runner não muda.

Novo `server/src/services/mtproto/clone/draft-publisher.ts`:

```ts
export function createDraftPublisher(ctx: DraftPublisherContext):
  (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]>
```

Reusa as mesmas peças que `publish-router.ts` já usa — `planForMessage`, `SourceReader.downloadToPath`, `rewriteMessageLinks`, `SourceReader.extractInlineLinks`, `SourceReader.pollData`. A única substituição: onde o router chama `bot.publishText/publishMedia/publishAlbum/publishPoll`, o draft chama `rehost(filePath)` (URL pública no bucket `media`) e `upsertStaged(row)`.

### 4.2 O id sintético

`publish` precisa devolver um `destMsgId` numérico — o runner o usa pra remapear respostas e pins. Em vez de inventar numeração, o draft devolve **o próprio `source_msg_id`**.

Consequências, todas desejáveis:

- `idMap` vira a identidade, e `highestCopiedSource()` continua produzindo o cursor certo na retomada.
- `resolveReply()` devolve o *source id* da mensagem respondida, que vira um lookup em `(campaign_id, source_msg_id)` pra achar o uuid e gravar `reply_to_id`.
- Alvo fora do `messageLimit` não é encontrado e degrada pra `null` — exatamente a mesma degradação documentada no clone live.

### 4.3 Álbum

Um grupo com `groupedId` vira **uma linha** `kind='album'` com N itens em `media`, `source_msg_id` do primeiro. O contrato do runner exige um `CloneOutcome` por mensagem do grupo, então todas voltam `copied` e as demais existem só no `clone_message_map` — inofensivo, e mantém o cursor consistente.

### 4.4 O que o `clone-handler` pula

| Etapa | `mode='live'` | `mode='draft'` |
|---|---|---|
| `automation_bots` obrigatório | sim, falha o job sem ele | **pulado** — o bot só entra na publicação |
| `ensureDestination` | cria canal, identidade, promove bot, convite | **pulado inteiro** |
| `syncTopics` / `finalizeTopics` | roda quando a origem é fórum | **pulado** |
| `chooseStrategy` | `auto`/`batch`/`download` | **`download` forçado** |
| `publish` | `createPublisher` | `createDraftPublisher` |
| `pinInDest` | `bot.pin()` | marca `is_pinned = true` |
| ao completar | fim | encadeia IA, ou marca o rascunho pronto |

`chooseStrategy` ganha `draftMode?: boolean` como **primeira** guarda, antes de `crossAccount`. O motivo é o mesmo já documentado ali pra `copyButtons` e `linkReplaceConfigured`: `ForwardMessages` copia server-side e o app nunca vê `raw.message`/`entities`/mídia. Rascunho sem download é impossível por construção.

### 4.5 Formulário e teto

`clone-form.tsx` ganha um radio **"O que fazer com o conteúdo"**:

- *Publicar direto no destino* — comportamento de hoje, com o seletor de conta de destino visível.
- *Mandar pro rascunho de uma campanha* — some o seletor de destino, aparecem as três alavancas de IA.

`createCloneJob` aplica o teto no modo rascunho: `messageLimit = min(input.messageLimit ?? 500, 1000)`. O default de 500 existe porque um clone de 20 mil posts com vídeo viraria dezenas de GB no Storage e horas só pra montar o rascunho, e nenhuma campanha de conteúdo real tem esse tamanho.

Ao criar o job em modo rascunho, a action cria junto a `mtproto_scheduled_campaigns` (status `draft`, sem destino) e grava `draft_campaign_id`.

## 5. IA (Gemini)

### 5.1 Cliente

`server/src/services/ai/gemini.ts`, `fetch` direto, sem SDK — mesmo formato de `nowpayments.ts`:

```ts
export interface GeminiDeps { fetch: typeof fetch }

export class GeminiClient {
  constructor(
    private apiKey: string,
    private model: string,          // config.geminiModel, default "gemini-2.5-flash"
    private deps: GeminiDeps = { fetch },
  ) {}
  isConfigured(): boolean;
  async generateJson<T>(input: { system: string; user: string; schema: object }): Promise<T>;
}
```

`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` com `generationConfig.responseMimeType = "application/json"` e `responseSchema`. **Structured output nativo** — arrancar JSON de markdown com regex é a fonte clássica de flakiness e não entra aqui.

Config nova em `server/src/config.ts`, toda com `envOptional` — nenhuma delas pode derrubar o boot do worker via `assert`:

| Chave | Default | Papel |
|---|---|---|
| `GEMINI_API_KEY` | `""` | Vazia = IA silenciosamente desativada, mesmo padrão de `vapidPublicKey` |
| `GEMINI_MODEL` | `"gemini-2.5-flash"` | Trocável sem deploy. O nome exato do modelo é confirmado contra a documentação da Google na Fase 6, antes da primeira chamada real |
| `INTERNAL_API_SECRET` | `""` | Segredo compartilhado Next ↔ worker do endpoint de assistente (§5.5). Vazio = endpoint recusa toda chamada |

O mesmo par de variáveis vai pro `.env` do Next apenas como `BOT_SERVER_URL` + `INTERNAL_API_SECRET`; a chave do Gemini **não** é replicada lá.

### 5.2 Núcleo puro

`server/src/services/ai/content-treatment.ts` — sem rede, testável:

```ts
export interface DraftMessageForAi {
  id: string;
  position: number;
  text: string | null;
  mediaKinds: string[];    // ['photo'] — a IA precisa saber que há mídia pra escrever legenda
  hasButtons: boolean;
}

export interface AiTreatment {
  id: string;
  action: "keep" | "clean" | "rewrite" | "discard";
  text: string | null;     // null = mantém o atual
  delaySeconds: number;
  reason: string;
}

export function buildTreatmentPrompt(batch, opts): { system: string; user: string; schema: object };
export function applyTreatment(row, t, opts): Partial<StagedRow>;
```

`applyTreatment` é onde moram as regras que não podem depender do humor do modelo: só preenche `content_text_original` se ainda for null; só aplica `delaySeconds` se `ai_smart_delay` estiver ligado; só aceita `rewrite` se `ai_rewrite` estiver ligado (um modelo que devolve `rewrite` com a alavanca desligada é degradado pra `clean`); e trunca `delaySeconds` na faixa permitida.

### 5.3 Guardas do prompt

No *system*, porque são o que separa "limpou o @ do concorrente" de "estragou a oferta":

- nunca alterar preço, prazo, número, código de cupom;
- nunca inventar link nem @ que não estava no original;
- em dúvida, devolver `keep`;
- `delaySeconds` entre 60 e 86400;
- `discard` só pra anúncio puro do concorrente ou mensagem de serviço, com `reason` obrigatório e legível pro dono.

### 5.4 Worker

`server/src/workers/campaign-ai-handler.ts` — `handleCampaignAiProcess(campaignId)`:

1. Claim CAS: `ai_status='processing'` onde `ai_status in ('queued','failed')`, com TTL stale de 10 min sobre `ai_started_at`. Mesmo padrão da `030` e da `050`.
2. Lê as mensagens ordenadas por `position`.
3. Fatia em lotes de 20, **com janela de contexto**: cada lote leva as 2 últimas do lote anterior como leitura, sem serem retratadas. Sem isso a cadência quebra na emenda entre lotes — a IA não teria como saber o que veio antes do primeiro item.
4. Aplica cada `AiTreatment` via `applyTreatment`, incrementando `ai_processed_count` por lote (a tela mostra progresso real).
5. **Lote que falhar não derruba o processo:** loga, segue pro próximo, e o resultado final vira `partial`. O rascunho nunca fica refém do Gemini.
6. Encerra em `done` / `partial` / `failed` e devolve a campanha pra `status='draft'`.

Novo `kind` na fila: `campaign.ai-process`. O `clone-handler`, ao completar um job `mode='draft'` com qualquer alavanca ligada, marca a campanha como `ai_processing` / `ai_status='queued'` e enfileira.

### 5.5 Assistente manual no editor

Server Action `aiAssist(messageId, action)` com `action in ('rewrite','caption','summarize')`. Ela chama `POST {BOT_SERVER_URL}/api/ai/assist`, mesmo hop que `enqueueClone` já usa.

O motivo de não chamar o Gemini direto do Next: a chave mora **só** no worker. Um lugar pra configurar, um rate-limit pra aplicar, um arquivo de prompt pra manter. O endpoint novo exige header de segredo compartilhado (`config.internalApiSecret`).

> **Observação de segurança, fora do escopo desta entrega:** `/api/mtproto/enqueue` não tem autenticação nenhuma hoje. O endpoint de IA nasce com o header; vale fechar o antigo depois, porque quota de LLM aberta custa dinheiro de um jeito que fila aberta não custa.

## 6. UI: generalizar o `ComposerShell`

Três movimentos, nenhum deles reescreve o miolo visual.

### 6.1 Tipo neutro de linha

`lib/composer/types.ts` passa a exportar `ComposerMessageRow`: os campos que `FeedPreview` e `ChannelFeed` leem, com os **exclusivos da Prova Social marcados como opcionais**.

```ts
export interface ComposerMessageRow {
  // Comuns às duas features — presentes nas duas tabelas.
  id: string;
  kind: string;
  content_text: string | null;
  media: unknown;
  reply_to_id: string | null;

  // Só da Prova Social. A campanha não tem essas colunas: o canal posta como
  // ele mesmo, ninguém finge horário e o bot não consegue reagir.
  sender_kind?: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  reactions?: unknown;
  offset_seconds?: number | null;
  views_count?: number | null;
  display_time?: string | null;
  media_url?: string | null;   // legado da 071, já opcional na prática
  media_type?: string | null;
}
```

**Isto exige mudança real em `feed-preview.tsx`, não só troca de import.** `toFeedMessage` e `draftToFeedMessage` hoje leem esses campos direto; passam a aplicar default: `sender_kind ?? "owner"`, `sender_name ?? ""`, `reactions ?? []`, `offset_seconds ?? 0`, `views_count ?? 0`, `display_time ?? null`. São defaults que já descrevem o comportamento certo no modo campanha — postagem de canal aparece como do dono, sem reação, sem contador falso, com horário derivado do `scheduled_at`.

`SocialProofMessage` satisfaz a interface sem alteração, porque campo opcional aceita campo presente. Os testes de bolha em `tests/lib/social-proof-bubble*.test.tsx` cobrem justamente esse caminho e são o portão dessa mudança.

**A campanha alimenta `offset_seconds` derivado, não persistido:** a página calcula `(scheduled_at − agora)` em segundos antes de passar as linhas ao preview, e é isso que faz o `FeedPreview` desenhar os horários corretos sem saber que está olhando uma campanha.

### 6.2 Actions injetadas

`ComposerShell` para de importar `@/lib/actions/social-proof-actions` e passa a receber:

```ts
export interface ComposerActions {
  saveMessage(input: MessageInput): Promise<ActionResult>;
  deleteMessage(id: string): Promise<ActionResult>;
  duplicateMessage(id: string): Promise<ActionResult>;
  reorderMessages(ids: string[]): Promise<ActionResult>;
  setPinned?(id: string | null): Promise<ActionResult>;
  aiAssist?(id: string, action: AiAssistAction): Promise<ActionResult>;
}
```

O componente muda de casa pra `components/dashboard/composer/composer-shell.tsx`. O `composer.tsx` de 16 linhas vira o adaptador que amarra as actions da Prova Social — **`app/dashboard/bots/[botId]/prova-social/page.tsx` não muda uma linha.**

### 6.3 Slots

`title`, `subtitle`, `headerActions`, `leftColumn`, `editorExtras`, `messageBadge`.

| Coluna | Prova Social | Campanha agendada |
|---|---|---|
| 1 | `ChannelCard` + `OwnerCard` | `DestinationCard` (dialog + estado do bot + "Promover bot") · `ScheduleCard` (início, delay padrão, "última postagem cai em…") · `AiCard` (progresso, "Reprocessar com IA") |
| 2 | `FeedPreview` | **`FeedPreview` idêntico**, cabeçalho vindo do dialog escolhido |
| 3 | `MessageEditor` + extras da Prova Social | `MessageEditor` + `CampaignExtras` |

`MessageEditor` ganha `extras?: ReactNode`; os blocos atuais de *Visualizações / Há quanto tempo / Horário fixo / Reações* saem pra `social-proof-extras.tsx`. `CampaignExtras` traz delay em minutos, silencioso, toggle **Original / IA** com "Reverter", e os três botões de assistente.

Cada bolha ganha chip de status: `pendente` / `enviada` / `falhou` / `descartada pela IA`, com `ai_reason` no hover.

**Intocados:** `MediaPicker`, `QuickCompose`, `FeedPreview`, `channel-feed` e toda a pasta `components/telegram/`.

### 6.4 Rotas e actions

- `app/dashboard/automations/scheduled/page.tsx` — lista, mais um `CardShell` na página de automações ao lado de "Clonagem" e "Campanhas".
- `app/dashboard/automations/scheduled/new/page.tsx` — campanha vazia.
- `app/dashboard/automations/scheduled/[campaignId]/page.tsx` — o composer.
- `app/dashboard/automations/scheduled/actions.ts` — todas as Server Actions.

As actions retornam `ActionResult` e **nunca fazem `throw`**: erro lançado em Server Action é apagado em produção e chega no usuário como texto genérico em inglês. Recusa prevista volta como dado, no formato que `social-proof-actions.ts` já usa.

`clones/[cloneId]/page.tsx` mostra **"Abrir rascunho"** quando `mode='draft'` e `draft_campaign_id` existe.

## 7. Worker de disparo

### 7.1 Poller

Em `queue.ts`, a cada 30s, no molde do de recorrência: mensagens `pending` com `scheduled_at <= now()`, de campanhas `running`, ordenadas por `scheduled_at`, **no máximo uma por campanha por tick**.

Esse último ponto não é detalhe de performance. Com `concurrency: 4` no worker, enfileirar duas mensagens da mesma campanha no mesmo tick permite que a segunda seja publicada antes da primeira.

### 7.2 `handleScheduledSend(messageId)`

1. **Claim CAS:** `set status='sending', claimed_at=now(), attempts=attempts+1 where id=? and status='pending'`. Sem linha de volta, outro worker pegou.
2. Carrega campanha, destino e `automation_bots`; monta `CompanionBot(token, '-100'+dest_channel_id, …)`.
3. Despacha por `kind`: texto → `publishText` com `entities` e `inline_links`; mídia → baixa a URL do Storage pro tmp e `publishMedia`; álbum → N downloads e `publishAlbum`; enquete → `publishPoll`.

   **`PublishOptions` ganha `silent?: boolean`.** Hoje os cinco métodos de `CompanionBot` cravam `disable_notification: true`, o que é certo pra clone (500 posts de uma vez não podem tocar 500 vezes) e errado pra campanha de conteúdo, onde a notificação é justamente o ponto. Sem essa mudança a coluna `silent` da `074` não teria como chegar ao Telegram. Default continua `true`, então o clone não muda de comportamento.
4. Sucesso → `sent`, `dest_msg_id`, `sent_at`; `is_pinned` dispara `bot.pin()`.
5. **`FLOOD_WAIT` → volta pra `pending` com `scheduled_at = now() + wait + 5s`, e empurra todas as seguintes pendentes da campanha pelo mesmo delta.** Sem o empurrão, a fila inteira vence durante o flood e o bot despeja tudo de uma vez quando ele passa — exatamente o comportamento que queima conta.
6. Erro não-flood: 3 tentativas antes de `failed`.
7. Última mensagem enviada → `campaign.status='completed'` e job de limpeza da mídia no Storage.
8. Sweep de claim stale (10 min) devolve `sending` órfã pra `pending`.

Novo `kind` na fila: `postcampaign.send-one`.

### 7.3 Launch

`launchScheduledCampaign(campaignId)`:

1. Valida que existe destino e que ele é `peer_type='channel'`.
2. Confirma o bot como admin lá; se não for, promove via a conta MTProto dona do dialog, reusando `promoteBotToAdmin`.
3. Calcula os `scheduled_at` acumulados a partir de `start_at` somando `delay_seconds` na ordem de `position`, pulando `ai_discarded`.
4. Grava tudo e marca `status='running'`.

O acúmulo do passo 3 vive em `lib/composer/schedule.ts` como função pura (`accumulateSchedule(rows, startAt) => Array<{id, scheduledAt}>`), e não dentro da action. Dois motivos: um módulo `"use server"` só exporta função async, então helper puro não pode morar lá — a mesma razão que já tirou os tipos da Prova Social pra `lib/social-proof/types.ts`; e a **mesma função alimenta a prévia**, que precisa mostrar "última postagem cai em…" antes de qualquer gravação.

## 8. Ordem de implementação

| Fase | Entrega | Depende de |
|---|---|---|
| 1 | Migrations `074`/`075` + tipos em `lib/types/database.ts` | — |
| 2 | `draft-publisher` + ramo draft no `clone-handler` + formulário + `createCloneJob` | 1 |
| 3 | Worker de disparo + poller + limpeza de Storage | 1 |
| 4 | Generalização do composer (regressão da Prova Social é o portão) | — |
| 5 | Rotas, actions e cards da campanha | 1, 4 |
| 6 | IA em lote: `gemini.ts`, `content-treatment.ts`, `campaign-ai-handler.ts` | 1, 2 |
| 7 | Assistente manual no editor | 4, 6 |

Fases 2/3 e 4 são independentes entre si.

## 9. Testes

Seguem a convenção existente: núcleo puro com deps injetadas, sem rede e sem Supabase.

| Arquivo | Cobre |
|---|---|
| `server/tests/services/clone-draft-publisher.test.ts` | id sintético, álbum vira uma linha, reply resolvido e degradado, upsert idempotente |
| `server/tests/services/clone-publish-router.test.ts` (existente) | `chooseStrategy` com `draftMode` retorna `download` antes de qualquer outra guarda |
| `server/tests/services/scheduled-send.test.ts` | claim CAS, `FLOOD_WAIT` empurrando a fila inteira, ordem por campanha, pin, 3 tentativas |
| `server/tests/services/ai-content-treatment.test.ts` | `buildTreatmentPrompt` (janela de contexto), `applyTreatment` (original preservado uma vez só, alavanca desligada degrada `rewrite` pra `clean`, `delaySeconds` truncado) |
| `server/tests/services/ai-gemini.test.ts` | `fetch` fake: schema enviado, erro HTTP não lança pro chamador do lote |
| `tests/lib/composer-schedule.test.ts` | `accumulateSchedule`: acúmulo a partir de `start_at`, descartadas puladas sem consumir delay, lista vazia |
| `tests/lib/composer-row-defaults.test.ts` | linha de campanha (sem `sender_kind`/`reactions`/`views_count`) desenha bolha de dono, sem reações e sem contador |
| `tests/lib/social-proof-*.test.ts` (8 existentes) | **portão de regressão da Fase 4** — precisam passar sem edição |

## 10. Decisões e seus motivos

| Decisão | Motivo |
|---|---|
| Tabelas dedicadas | O poller de `queue.ts:481` jogaria uma campanha de conteúdo no `CampaignRunner` de Mass DM (§3.1) |
| Bot companheiro publica | `CompanionBot` já entrega entities, álbum, botões, reply, enquete e pin. `MtprotoClient` só tem `sendTextToChannel`/`sendMediaToChannel`, sem nada disso e sem devolver o `message_id` |
| Clone em rascunho não cria destino | Sem `ensureDestination` o caminho fica mais curto e não queima cota diária de `CreateChannel` num rascunho que pode ser abandonado |
| Delay relativo, `scheduled_at` derivado | Reordenar recalcula sozinho; o poller consulta uma coluna absoluta indexada |
| IA em lote, fora do runner | Smart Delay precisa ver a sequência inteira. Inline seriam 500 chamadas dentro do `CloneRunner`, misturando falha de IA com retomada de flood |
| `content_text_original` | Reescrita pra evitar plágio pode mexer em CTA de post de venda; sem o original não há como auditar nem reverter |
| Duas alavancas de IA separadas | Limpar `@` é seguro; parafrasear não é. Clone de catálogo com preços fica intacto por padrão |
| Descarte marcado, não apagado | O dono precisa ver o que a IA reprovou e por quê, e desfazer com um clique |
| `fetch` direto, sem SDK | Padrão do repositório pra API externa, e deps injetadas deixam os testes puros |

## 11. Riscos

- **Custo de Storage.** 500 mensagens com vídeo podem chegar à casa dos GB. Mitigado pelo teto de 500/1000 e pelo job de limpeza quando a campanha completa (Fase 3). Se virar problema real, o passo seguinte é rehost só de foto com vídeo por referência à origem — desenho já considerado e recusado pra v1 por perder a prévia real.
- **Qualidade da reescrita.** O modelo pode suavizar um CTA mesmo com as guardas. Mitigado por: alavanca desligada por padrão, `content_text_original` sempre preservado, e revisão humana no composer antes do launch — que é o propósito da feature.
- **Refatoração do composer.** É a fase com maior superfície de regressão. Mitigada por mover em vez de reescrever, manter `SocialProofComposer` como adaptador, e tratar os 8 testes de Prova Social como portão.
- **Quota do Gemini.** Lotes de 20 sobre um teto de 500 dão ~25 chamadas por rascunho. Falha de lote degrada pra `partial` em vez de derrubar.
- **Bot removido do destino entre o launch e o envio.** Cada mensagem falha individualmente com `error_message` legível; a campanha não trava.

## 12. Fora de escopo

- **Grupo legacy (`peer_type='chat'`) como destino.** `promoteBotToAdmin` monta `Api.InputChannel`; só canal e supergrupo funcionam.
- **Tópicos de fórum no rascunho.** O destino é escolhido depois e pode não ser fórum; tudo vai pro General.
- **Reações.** Bot não consegue reagir; o campo existe na tabela mas fica escondido no modo campanha.
- **Recorrência** da sequência inteira. As colunas de status comportam quando quiser.
- **Múltiplos destinos por campanha.** Um destino por campanha; duplicar a campanha resolve o caso de dois canais.
- **Fechar a autenticação de `/api/mtproto/enqueue`** (§5.5).
