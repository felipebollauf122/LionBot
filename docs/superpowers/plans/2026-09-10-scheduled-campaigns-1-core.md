# Campanhas Agendadas — Plano 1: Núcleo de dados e extração do clone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer um clone rodar em "modo rascunho": em vez de publicar no Telegram, ele grava cada mensagem raspada — texto, entities, mídia rehospedada no Supabase Storage, enquete, botões — como linha agendada de uma campanha.

**Architecture:** `CloneRunner` não muda uma linha. A troca acontece na única dependência injetada que fala com o Telegram: `deps.publish`. Um `createDraftPublisher` substitui `createPublisher`, reusa as mesmas peças de leitura (`planForMessage`, `downloadToPath`, `rewriteMessageLinks`, `extractInlineLinks`, `pollData`) e grava em `mtproto_scheduled_messages` com upsert idempotente por `(campaign_id, source_msg_id)`.

**Tech Stack:** TypeScript ESM (imports com sufixo `.js`), Node 20, Supabase (Postgres + Storage), gramjs (`telegram`), BullMQ, Vitest 2 no `server/`, Next 16.2.2 + React 19 no app.

**Spec:** `docs/superpowers/specs/2026-09-10-scheduled-post-campaigns-design.md`

## Global Constraints

- **Migrations são incrementais e idempotentes.** A `073` está em produção. Use `create table if not exists` / `add column if not exists`. Nunca edite uma migration já numerada.
- **Nomes de coluna da seção "espelho" são contrato com a UI.** `kind`, `content_text`, `media`, `reply_to_id`, `position` têm que casar com `social_proof_messages`. Renomear quebra o Plano 2.
- **Imports no `server/` levam sufixo `.js`** mesmo apontando pra arquivo `.ts` (ESM + `"type": "module"`).
- **Server Actions retornam `ActionResult`, nunca `throw`.** Erro lançado em Server Action é apagado em produção e chega ao usuário como texto genérico em inglês.
- **Testes do `server/` não tocam rede nem Supabase.** Toda dependência externa entra injetada, no padrão de `server/tests/services/clone-runner.test.ts`.
- **Comentários e mensagens de UI em português**, seguindo o repositório.
- Rodar testes do server: `cd server && npm test`. Rodar testes do app: `npm test` na raiz.

---

### Task 1: Migration 074 — tabelas da campanha agendada

**Files:**
- Create: `supabase/migrations/074_scheduled_campaigns.sql`

**Interfaces:**
- Consumes: nada.
- Produces: tabelas `public.mtproto_scheduled_campaigns` e `public.mtproto_scheduled_messages`, com o unique parcial `idx_sched_msgs_source (campaign_id, source_msg_id) where source_msg_id is not null` do qual a Task 6 depende pro upsert.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/074_scheduled_campaigns.sql`:

```sql
-- Campanhas de postagem agendada: N mensagens ao longo do tempo pra 1 destino.
-- É a transposta de mtproto_campaigns (1 texto x N alvos), e por isso mora em
-- tabela própria: o poller de queue.ts:481 varre mtproto_campaigns com
-- status='scheduled' e enfileira campaign.run, que cairia no CampaignRunner de
-- Mass DM e tentaria mandar DM pros "alvos" de uma campanha de conteúdo.

create table if not exists public.mtproto_scheduled_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',

  -- Destino: um dialog existente do tenant. null enquanto o rascunho não
  -- escolheu. channel_id/access_hash são snapshot — o dialog pode sumir no
  -- próximo sync, mesmo raciocínio de clone_jobs.source_peer_id (049).
  dest_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  dest_channel_id text,
  dest_access_hash text,
  dest_title text,

  source_clone_job_id uuid,

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
  -- TTL da trava de processamento da IA, mesmo papel de
  -- mtproto_campaigns.processing_started_at (030): sem isso a campanha fica
  -- presa em ai_processing pra sempre se o worker morrer no meio.
  ai_started_at timestamptz,

  total_messages int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mtproto_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null
    references public.mtproto_scheduled_campaigns(id) on delete cascade,

  -- ── Espelho de social_proof_messages. Estes nomes são CONTRATO com
  --    FeedPreview/MessageEditor/MediaPicker: renomear quebra a UI reusada.
  kind text not null default 'text'
    check (kind in ('text','photo','video','audio','album','document','poll')),
  content_text text,
  media jsonb not null default '[]'::jsonb,   -- MediaItem[], mesmo shape da 073
  reply_to_id uuid references public.mtproto_scheduled_messages(id) on delete set null,
  position integer not null default 0,

  -- ── Agendamento. delay_seconds é o que o usuário edita (relativo à
  --    anterior); scheduled_at é derivado, escrito uma vez no launch.
  delay_seconds int not null default 900,
  scheduled_at timestamptz,
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
  --    Telegram e que, num rascunho, precisa sobreviver em repouso.
  source_msg_id bigint,
  entities jsonb,        -- Api.MessageEntity[] cruas: negrito, link, spoiler
  inline_links jsonb,    -- [{label,url}] quando copy_buttons
  poll jsonb,            -- SourcePoll: question, options, isAnonymous, ...
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

-- Idempotência do rascunho. A 050 documenta que publish() NÃO é idempotente:
-- dois runners no mesmo lote duplicam posts no destino. No modo rascunho o
-- publish vira upsert nesta chave, então uma retomada pós-FLOOD_WAIT que
-- reprocesse um lote já gravado sobrescreve em vez de duplicar.
create unique index if not exists idx_sched_msgs_source
  on public.mtproto_scheduled_messages (campaign_id, source_msg_id)
  where source_msg_id is not null;

-- O poller do worker de disparo. Parcial porque só 'pending' é consultado.
create index if not exists idx_sched_msgs_due
  on public.mtproto_scheduled_messages (status, scheduled_at) where status = 'pending';

-- A leitura da tela, com o mesmo desempate por created_at da 071: sem ele,
-- position repetida deixa a ordem do composer divergir da ordem de envio.
create index if not exists idx_sched_msgs_campaign_pos
  on public.mtproto_scheduled_messages (campaign_id, position, created_at);

alter table public.mtproto_scheduled_campaigns enable row level security;
alter table public.mtproto_scheduled_messages enable row level security;

-- is_admin() acompanha o padrão da 007 e da 071: o admin da plataforma
-- gerencia a automação do cliente, e sem isso a tela abriria vazia pra ele.
drop policy if exists "tenant manages own scheduled campaigns"
  on public.mtproto_scheduled_campaigns;
create policy "tenant manages own scheduled campaigns"
  on public.mtproto_scheduled_campaigns for all
  using (tenant_id = auth.uid() or public.is_admin())
  with check (tenant_id = auth.uid() or public.is_admin());

drop policy if exists "tenant manages own scheduled messages"
  on public.mtproto_scheduled_messages;
create policy "tenant manages own scheduled messages"
  on public.mtproto_scheduled_messages for all
  using (campaign_id in (
    select id from public.mtproto_scheduled_campaigns
    where tenant_id = auth.uid() or public.is_admin()
  ))
  with check (campaign_id in (
    select id from public.mtproto_scheduled_campaigns
    where tenant_id = auth.uid() or public.is_admin()
  ));
```

`source_clone_job_id` fica sem FK **de propósito** nesta migration: `clone_jobs` ganha a referência inversa na `075`, e declarar as duas FKs cruzadas na mesma direção obrigaria a ordenar as tabelas. A `075` fecha o laço.

- [ ] **Step 2: Verificar a sintaxe SQL**

Não há banco local neste projeto — as migrations são aplicadas no Supabase pelo painel. Confira manualmente:
- todo `create` tem `if not exists`;
- toda `policy` tem `drop policy if exists` antes;
- os nomes do bloco "espelho" batem exatamente com `supabase/migrations/071_social_proof.sql` e `073_social_proof_v2.sql`.

Run: `grep -c "if not exists" supabase/migrations/074_scheduled_campaigns.sql`
Expected: `7`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/074_scheduled_campaigns.sql
git commit -m "feat(db): tabelas de campanha de postagem agendada (074)"
```

---

### Task 2: Migration 075 e tipos TypeScript

**Files:**
- Create: `supabase/migrations/075_clone_draft_mode.sql`
- Modify: `lib/types/database.ts` (adicionar ao fim do arquivo)

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces: colunas `clone_jobs.mode`, `clone_jobs.draft_campaign_id`, `clone_jobs.ai_clean|ai_rewrite|ai_smart_delay`; tipos `ScheduledCampaign`, `ScheduledMessage`, `ScheduledMessageKind`, `ScheduledMessageStatus` exportados de `@/lib/types/database`.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/075_clone_draft_mode.sql`:

```sql
-- Modo rascunho do clone: em vez de publicar no destino, o job grava o
-- conteúdo raspado como mensagens agendadas de uma campanha (074).
--
-- default 'live' mantém todo job existente com o comportamento de hoje.
-- dest_kind e dest_title continuam NOT NULL: no modo rascunho, dest_title
-- recebe o nome da campanha e dest_kind é derivado do dialog de origem como
-- sempre — inofensivo, porque nada no caminho draft os lê.

alter table public.clone_jobs
  add column if not exists mode text not null default 'live'
    check (mode in ('live','draft')),
  add column if not exists draft_campaign_id uuid
    references public.mtproto_scheduled_campaigns(id) on delete set null,
  add column if not exists ai_clean boolean not null default false,
  add column if not exists ai_rewrite boolean not null default false,
  add column if not exists ai_smart_delay boolean not null default false;

-- Fecha o laço deixado aberto na 074 (as duas tabelas já existem agora).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sched_campaigns_clone_job_fk'
  ) then
    alter table public.mtproto_scheduled_campaigns
      add constraint sched_campaigns_clone_job_fk
        foreign key (source_clone_job_id)
        references public.clone_jobs(id) on delete set null;
  end if;
end $$;

-- "Abrir rascunho" na tela do clone busca por esta coluna.
create index if not exists idx_clone_jobs_draft_campaign
  on public.clone_jobs(draft_campaign_id) where draft_campaign_id is not null;
```

- [ ] **Step 2: Adicionar os tipos**

Acrescente ao fim de `lib/types/database.ts`:

```ts
// ─── Campanhas de postagem agendada (074/075) ────────────────────────────

export type ScheduledCampaignStatus =
  | "draft"
  | "ai_processing"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type ScheduledCampaignAiStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "partial"
  | "failed";

export interface ScheduledCampaign {
  id: string;
  tenant_id: string;
  name: string;
  dest_dialog_id: string | null;
  dest_channel_id: string | null;
  dest_access_hash: string | null;
  dest_title: string | null;
  source_clone_job_id: string | null;
  status: ScheduledCampaignStatus;
  start_at: string | null;
  default_delay_seconds: number;
  ai_clean: boolean;
  ai_rewrite: boolean;
  ai_smart_delay: boolean;
  ai_status: ScheduledCampaignAiStatus;
  ai_processed_count: number;
  ai_error: string | null;
  ai_started_at: string | null;
  total_messages: number;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * `document` e `poll` existem aqui e não em social_proof_messages porque o
 * clone os produz e o bot sabe publicá-los. O MessageEditor continua
 * oferecendo só os cinco tipos editáveis — ver Plano 2.
 */
export type ScheduledMessageKind =
  | "text"
  | "photo"
  | "video"
  | "audio"
  | "album"
  | "document"
  | "poll";

export type ScheduledMessageStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type ScheduledMessageAiAction = "none" | "cleaned" | "rewritten" | "discarded";

export interface ScheduledMessage {
  id: string;
  tenant_id: string;
  campaign_id: string;
  kind: ScheduledMessageKind;
  content_text: string | null;
  /** jsonb: lista de MediaItem. Mesmo shape de social_proof_messages.media. */
  media: MediaItem[];
  reply_to_id: string | null;
  position: number;
  delay_seconds: number;
  scheduled_at: string | null;
  silent: boolean;
  status: ScheduledMessageStatus;
  dest_msg_id: number | null;
  sent_at: string | null;
  error_message: string | null;
  attempts: number;
  claimed_at: string | null;
  source_msg_id: number | null;
  /** jsonb: Api.MessageEntity[] cruas do gramjs. Opaco fora do worker. */
  entities: unknown[] | null;
  inline_links: Array<{ label: string; url: string }> | null;
  poll: {
    question: string;
    options: string[];
    isAnonymous: boolean;
    allowsMultipleAnswers: boolean;
  } | null;
  file_name: string | null;
  is_pinned: boolean;
  content_text_original: string | null;
  ai_action: ScheduledMessageAiAction | null;
  ai_reason: string | null;
  ai_discarded: boolean;
  created_at: string;
}
```

`MediaItem` já é importado/definido nesse arquivo pela Prova Social — confirme com `grep -n "MediaItem" lib/types/database.ts` antes de escrever, e se ele vier de `lib/social-proof/types.ts`, use o mesmo caminho de import que `SocialProofMessage` usa.

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erro novo. (Se o projeto já tiver erros pré-existentes, compare a contagem antes e depois.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_clone_draft_mode.sql lib/types/database.ts
git commit -m "feat(db): modo rascunho no clone e tipos das campanhas agendadas (075)"
```

---

### Task 3: `chooseStrategy` aprende o modo rascunho

**Files:**
- Modify: `server/src/services/mtproto/clone/publish-router.ts:15-52`
- Test: `server/tests/services/clone-publish-router.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `chooseStrategy` aceita `draftMode?: boolean` e devolve `"download"` quando ele é `true`, antes de qualquer outra guarda.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `server/tests/services/clone-publish-router.test.ts`, dentro do `describe` de `chooseStrategy`:

```ts
it("draftMode força download antes de qualquer outra guarda", () => {
  // Todas as condições que normalmente levariam a "batch" estão ligadas:
  // requested batch, origem permite forward, nenhuma feature que force
  // download. Ainda assim o rascunho precisa de "download", porque o
  // ForwardMessages copia server-side e o app nunca vê o conteúdo.
  expect(
    chooseStrategy({
      requested: "batch",
      sourceHasNoForwards: false,
      copyButtons: false,
      copyReplies: false,
      crossAccount: false,
      linkReplaceConfigured: false,
      draftMode: true,
    }),
  ).toBe("download");
});

it("sem draftMode o comportamento de sempre continua", () => {
  expect(
    chooseStrategy({
      requested: "batch",
      sourceHasNoForwards: false,
      copyButtons: false,
      copyReplies: false,
      crossAccount: false,
      linkReplaceConfigured: false,
    }),
  ).toBe("batch");
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-publish-router.test.ts`
Expected: FAIL — o primeiro teste devolve `"batch"` em vez de `"download"` (`draftMode` é ignorado porque nem existe no tipo, então o TS pode acusar antes: "Object literal may only specify known properties").

- [ ] **Step 3: Implementar**

Em `server/src/services/mtproto/clone/publish-router.ts`, adicione o campo ao input de `chooseStrategy` (junto dos outros opcionais documentados) e a guarda como **primeira** condição do corpo:

```ts
  /**
   * Modo rascunho: em vez de publicar, o job grava o conteúdo como mensagens
   * agendadas. O ForwardMessages copia server-side — o app nunca vê
   * raw.message/raw.entities/mídia nessa rota, então montar um rascunho a
   * partir dela é impossível. Mesma razão de copyButtons/linkReplace abaixo,
   * só que absoluta: aqui não existe destino pra encaminhar.
   */
  draftMode?: boolean;
```

E no corpo, antes de `if (input.crossAccount)`:

```ts
  // Rascunho não tem destino nem publica nada: precisa do conteúdo em mãos.
  if (input.draftMode) return "download";
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd server && npx vitest run tests/services/clone-publish-router.test.ts`
Expected: PASS, incluindo todos os testes que já existiam no arquivo.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/publish-router.ts server/tests/services/clone-publish-router.test.ts
git commit -m "feat(clone): chooseStrategy força download no modo rascunho"
```

---

### Task 4: `media-rehost` aceita prefixo de chave

**Files:**
- Modify: `server/src/services/mtproto/bot-clone/media-rehost.ts`
- Test: `server/tests/services/botclone-media-rehost.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `DownloadAndRehostInput` ganha `keyPrefix?: string` (default `"botclone"`). A chave no Storage passa a ser `${tenantId}/${keyPrefix}/${jobId}/${nodeIdHint}_${fileName}`.

O motivo: a Task 5 reusa `downloadAndRehostMedia` inteiro (ele já faz download + upload + limpeza do temporário), mas a chave hoje é `.../botclone/...` fixa, e mídia de campanha não vem de clone de bot.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `server/tests/services/botclone-media-rehost.test.ts`:

```ts
it("keyPrefix muda a pasta no Storage e default continua botclone", async () => {
  const uploads: string[] = [];
  const supabase = fakeSupabase(uploads); // helper já existente no arquivo
  const raw = fakeRawClient(10);          // helper já existente no arquivo

  await downloadAndRehostMedia(
    { raw, supabase },
    {
      media: {},
      tenantId: "t1",
      jobId: "j1",
      nodeIdHint: "n1",
      fileName: "a.jpg",
      tmpDir: tmpdir(),
      maxBytes: 1000,
      keyPrefix: "campaign",
    },
  );
  expect(uploads[0]).toBe("t1/campaign/j1/n1_a.jpg");

  await downloadAndRehostMedia(
    { raw, supabase },
    {
      media: {},
      tenantId: "t1",
      jobId: "j1",
      nodeIdHint: "n2",
      fileName: "b.jpg",
      tmpDir: tmpdir(),
      maxBytes: 1000,
    },
  );
  expect(uploads[1]).toBe("t1/botclone/j1/n2_b.jpg");
});
```

Abra `server/tests/services/botclone-media-rehost.test.ts` antes de escrever e **use os helpers que já existem lá** (os nomes acima são ilustrativos). Se o arquivo monta o fake do supabase inline em cada teste, faça igual em vez de extrair helper — o objetivo é não reformar um teste que já passa.

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npx vitest run tests/services/botclone-media-rehost.test.ts`
Expected: FAIL — a primeira asserção recebe `t1/botclone/j1/n1_a.jpg`.

- [ ] **Step 3: Implementar**

Em `server/src/services/mtproto/bot-clone/media-rehost.ts`, adicione ao `DownloadAndRehostInput`:

```ts
  /**
   * Pasta lógica dentro do bucket. Default "botclone" pra não mexer nas
   * chaves já gravadas por jobs de clone de bot; as campanhas agendadas
   * passam "campaign".
   */
  keyPrefix?: string;
```

E troque a linha da chave:

```ts
    const key = `${input.tenantId}/${input.keyPrefix ?? "botclone"}/${input.jobId}/${input.nodeIdHint}_${input.fileName}`;
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd server && npx vitest run tests/services/botclone-media-rehost.test.ts`
Expected: PASS, incluindo os testes anteriores do arquivo (o default preserva o comportamento).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/bot-clone/media-rehost.ts server/tests/services/botclone-media-rehost.test.ts
git commit -m "feat(media): keyPrefix opcional no rehost, default botclone"
```

---

### Task 5: `draft-publisher` — o núcleo

**Files:**
- Create: `server/src/services/mtproto/clone/draft-publisher.ts`
- Test: `server/tests/services/clone-draft-publisher.test.ts`

**Interfaces:**
- Consumes: `SourceMessage`, `CloneOutcome` de `./types.js`; `planForMessage`, `PlanInput`, `CloneMediaKind` de `./media-plan.js`; `InlineLink`, `SourcePoll` de `./bot-client.js`.
- Produces:
  - `export interface StagedMedia` e `export interface StagedRow` — o shape gravado.
  - `export interface DraftPublisherDeps` — `rehost`, `upsert`, `planInput`, `extractInlineLinks`, `pollData`, `originalFileName`, `copyPolls`, `copyButtons`, `rewrite`.
  - `export function createDraftPublisher(deps: DraftPublisherDeps): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]>`

  A Task 6 injeta as deps reais e passa o retorno como `CloneRunnerDeps.publish`.

**Decisões que o implementador precisa entender antes de escrever:**

1. **O `destMsgId` devolvido é o próprio `source_msg_id`.** Não invente numeração. Com isso o `idMap` do `CloneRunner` vira a identidade, `highestCopiedSource()` continua produzindo o cursor certo na retomada, e `resolveReply()` devolve o *source id* da mensagem respondida — que a Task 6 resolve pra uuid.
2. **Álbum vira UMA linha.** Um grupo com `groupedId` produz um `StagedRow` com `kind: "album"` e N itens em `media`, usando o `source_msg_id` do primeiro. Mas o contrato do `CloneRunner` exige **um `CloneOutcome` por mensagem do grupo** — devolva `copied` pra todas.
3. **`position` sai como `0`.** A renumeração determinística acontece uma vez no fim do job (Task 6), ordenada por `source_msg_id`. Calcular `max+1` aqui daria buraco e colisão numa retomada.

- [ ] **Step 1: Escrever os testes que falham**

Crie `server/tests/services/clone-draft-publisher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  createDraftPublisher,
  type DraftPublisherDeps,
  type StagedRow,
} from "../../src/services/mtproto/clone/draft-publisher.js";
import type { SourceMessage } from "../../src/services/mtproto/clone/types.js";

/** Mensagem de origem com um `raw` mínimo do que o publisher lê. */
function m(
  id: number,
  raw: Record<string, unknown> = {},
  over: Partial<SourceMessage> = {},
): SourceMessage {
  return {
    id,
    groupedId: null,
    replyToMsgId: null,
    topicId: null,
    raw: { id, message: "", entities: undefined, media: null, ...raw },
    ...over,
  };
}

function deps(over: Partial<DraftPublisherDeps> = {}): DraftPublisherDeps & {
  saved: StagedRow[];
} {
  const saved: StagedRow[] = [];
  const base: DraftPublisherDeps = {
    rehost: vi.fn(async (_raw, hint) => `https://cdn.test/${hint}`),
    upsert: vi.fn(async (rows: StagedRow[]) => {
      saved.push(...rows);
    }),
    // Substitui SourceReader.mediaPlanInput sem instanceof: lê o mesmo shape
    // que os fakes de `m()` produzem.
    planInput: (raw, copyPolls) => {
      const media = (raw as unknown as { media: { className: string } | null }).media;
      const msg = (raw as unknown as { message?: string }).message ?? "";
      return {
        mediaClassName: media ? media.className : null,
        documentAttributeClassNames: [],
        hasText: msg.trim() !== "",
        copyPolls,
      };
    },
    extractInlineLinks: vi.fn(() => undefined),
    pollData: vi.fn(() => null),
    originalFileName: vi.fn(() => null),
    copyPolls: false,
    copyButtons: false,
    rewrite: null,
  };
  return { ...base, ...over, saved };
}

describe("createDraftPublisher", () => {
  it("mensagem de texto vira uma linha e devolve o source id como destMsgId", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish([m(42, { message: "olá" })], null);

    expect(out).toEqual([{ status: "copied", destMsgId: 42 }]);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({
      sourceMsgId: 42,
      kind: "text",
      contentText: "olá",
      media: [],
      position: 0,
      replyToSourceMsgId: null,
    });
  });

  it("mensagem vazia sem mídia é pulada, sem gravar linha", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish([m(1, { message: "" })], null);

    expect(out).toEqual([{ status: "skipped", reason: "empty_message" }]);
    expect(d.saved).toHaveLength(0);
  });

  it("foto rehospeda e grava a URL em media", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish(
      [m(7, { message: "legenda", media: { className: "MessageMediaPhoto" } })],
      null,
    );

    expect(out).toEqual([{ status: "copied", destMsgId: 7 }]);
    expect(d.saved[0]).toMatchObject({
      kind: "photo",
      contentText: "legenda",
      media: [{ url: "https://cdn.test/msg_7", type: "photo" }],
    });
  });

  it("mídia grande demais (rehost devolve null) vira skipped file_too_large", async () => {
    const d = deps({ rehost: vi.fn(async () => null) });
    const publish = createDraftPublisher(d);

    const out = await publish(
      [m(8, { media: { className: "MessageMediaPhoto" } })],
      null,
    );

    expect(out).toEqual([{ status: "skipped", reason: "file_too_large" }]);
    expect(d.saved).toHaveLength(0);
  });

  it("álbum vira UMA linha com N mídias, mas devolve um outcome por mensagem", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);
    const grupo = [
      m(10, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(11, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(12, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 10 },
      { status: "copied", destMsgId: 11 },
      { status: "copied", destMsgId: 12 },
    ]);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({ kind: "album", sourceMsgId: 10, contentText: "capa" });
    expect(d.saved[0].media).toHaveLength(3);
  });

  it("replyToDestId chega na linha como replyToSourceMsgId", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    await publish([m(20, { message: "resposta" })], 15);

    expect(d.saved[0].replyToSourceMsgId).toBe(15);
  });

  it("enquete só vira linha com copyPolls ligado", async () => {
    const poll = {
      question: "gostou?",
      options: ["sim", "não"],
      isAnonymous: true,
      allowsMultipleAnswers: false,
    };
    const desligado = deps({ pollData: vi.fn(() => poll) });
    const publishOff = createDraftPublisher(desligado);
    expect(await publishOff([m(30, { media: { className: "MessageMediaPoll" } })], null)).toEqual([
      { status: "skipped", reason: "poll_disabled" },
    ]);
    expect(desligado.saved).toHaveLength(0);

    const ligado = deps({ pollData: vi.fn(() => poll), copyPolls: true });
    const publishOn = createDraftPublisher(ligado);
    expect(await publishOn([m(30, { media: { className: "MessageMediaPoll" } })], null)).toEqual([
      { status: "copied", destMsgId: 30 },
    ]);
    expect(ligado.saved[0]).toMatchObject({ kind: "poll", poll });
  });

  it("botões inline só são gravados com copyButtons ligado", async () => {
    const links = [{ label: "comprar", url: "https://x.test" }];
    const d = deps({ extractInlineLinks: vi.fn(() => links), copyButtons: true });
    const publish = createDraftPublisher(d);

    await publish([m(40, { message: "oferta" })], null);

    expect(d.saved[0].inlineLinks).toEqual(links);
  });

  it("rewrite substitui texto, entities e links antes de gravar", async () => {
    const d = deps({
      rewrite: vi.fn(async () => ({
        text: "texto limpo",
        entities: [{ className: "MessageEntityBold" }],
        inlineLinks: undefined,
      })),
    });
    const publish = createDraftPublisher(d);

    await publish([m(50, { message: "texto com @concorrente" })], null);

    expect(d.saved[0].contentText).toBe("texto limpo");
    expect(d.saved[0].entities).toEqual([{ className: "MessageEntityBold" }]);
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-draft-publisher.test.ts`
Expected: FAIL — "Cannot find module '../../src/services/mtproto/clone/draft-publisher.js'".

- [ ] **Step 3: Implementar**

Crie `server/src/services/mtproto/clone/draft-publisher.ts`:

```ts
import type { Api } from "telegram";
import { planForMessage } from "./media-plan.js";
import type { CloneMediaKind } from "./media-plan.js";
import type { CloneOutcome, SourceMessage } from "./types.js";
import type { InlineLink, SourcePoll } from "./bot-client.js";

/** Item de mídia no shape que a UI já lê (MediaItem de lib/social-proof/types). */
export interface StagedMedia {
  url: string;
  type: "photo" | "video" | "audio";
}

/** Uma linha de mtproto_scheduled_messages, antes de virar SQL. */
export interface StagedRow {
  sourceMsgId: number;
  kind: "text" | "photo" | "video" | "audio" | "album" | "document" | "poll";
  contentText: string | null;
  media: StagedMedia[];
  entities: unknown[] | null;
  inlineLinks: InlineLink[] | null;
  poll: SourcePoll | null;
  fileName: string | null;
  /** Sempre 0 aqui: a renumeração determinística acontece no fim do job. */
  position: number;
  /** Id NA ORIGEM da mensagem respondida. Vira uuid no caller. */
  replyToSourceMsgId: number | null;
}

export interface DraftPublisherDeps {
  /**
   * Baixa a mídia da mensagem e devolve a URL pública, ou null se ela passar
   * do teto de tamanho. `hint` é o nome lógico do arquivo no Storage.
   */
  rehost(raw: Api.Message, hint: string): Promise<string | null>;
  /** Upsert por (campaign_id, source_msg_id). Nunca recebe lista vazia. */
  upsert(rows: StagedRow[]): Promise<void>;
  /**
   * As quatro leituras da mensagem entram injetadas, e não importadas de
   * SourceReader, porque todas usam `instanceof Api.X` — com import direto,
   * testar este arquivo exigiria construir Api.Message de verdade do gramjs.
   * O caller (clone-handler) passa os estáticos do SourceReader.
   */
  planInput(raw: Api.Message, copyPolls: boolean): PlanInput;
  extractInlineLinks(raw: Api.Message): InlineLink[] | undefined;
  pollData(raw: Api.Message): SourcePoll | null;
  originalFileName(raw: Api.Message): string | null;
  copyPolls: boolean;
  copyButtons: boolean;
  /**
   * Troca de @mentions/links por categoria, quando o job configurou. null =
   * grava o texto como veio.
   */
  rewrite:
    | ((input: {
        message: string | undefined;
        entities: Api.TypeMessageEntity[] | undefined;
        inlineLinks: InlineLink[] | undefined;
      }) => Promise<{
        text: string;
        entities: Api.TypeMessageEntity[] | undefined;
        inlineLinks: InlineLink[] | undefined;
      }>)
    | null;
}

/** Só foto e vídeo entram num álbum do Telegram — mesma regra do publish-router. */
const ALBUMABLE = new Set<CloneMediaKind>(["photo", "video"]);

/** CloneMediaKind -> o `type` que a UI entende. Áudio é o único caso separado. */
function toStagedMediaType(kind: CloneMediaKind): StagedMedia["type"] {
  if (kind === "video" || kind === "animation") return "video";
  if (kind === "audio") return "audio";
  return "photo";
}

/** CloneMediaKind -> o `kind` da linha, que também é o que o worker despacha. */
function toRowKind(kind: CloneMediaKind): StagedRow["kind"] {
  if (kind === "photo") return "photo";
  if (kind === "video" || kind === "animation") return "video";
  if (kind === "audio") return "audio";
  return "document";
}

/**
 * Devolve a função `publish` que o CloneRunner injeta no modo rascunho.
 *
 * Contrato herdado do runner e que NÃO pode ser quebrado: um CloneOutcome por
 * mensagem do grupo, na mesma ordem. O destMsgId devolvido é o próprio
 * source id — assim o idMap do runner vira a identidade e a retomada pelo
 * cursor continua funcionando sem numeração inventada.
 */
export function createDraftPublisher(
  deps: DraftPublisherDeps,
): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]> {
  return async (group, replyToDestId) => {
    const raws = group.map((g) => g.raw as Api.Message);
    const plans = raws.map((raw) => planForMessage(deps.planInput(raw, deps.copyPolls)));

    // Um grupo é sempre de um tipo só na prática (álbum é foto/vídeo), mas o
    // primeiro item é quem define kind, texto e reply da linha resultante.
    const first = plans[0];

    if (first.kind === "skip") {
      return plans.map((p) => ({
        status: "skipped" as const,
        reason: p.kind === "skip" ? p.reason : "skip",
      }));
    }

    // ── Texto, entities e botões, já com a troca de link aplicada.
    const inlineLinks = deps.copyButtons ? deps.extractInlineLinks(raws[0]) : undefined;
    let text = raws[0].message ?? "";
    let entities = raws[0].entities;
    let links = inlineLinks;
    if (deps.rewrite && first.kind !== "poll") {
      const r = await deps.rewrite({
        message: raws[0].message,
        entities: raws[0].entities,
        inlineLinks,
      });
      text = r.text;
      entities = r.entities;
      links = r.inlineLinks;
    }

    const base = {
      sourceMsgId: group[0].id,
      contentText: text === "" ? null : text,
      entities: entities ? (entities as unknown[]) : null,
      inlineLinks: links && links.length > 0 ? links : null,
      position: 0,
      replyToSourceMsgId: replyToDestId,
    };

    // ── Enquete
    if (first.kind === "poll") {
      const poll = deps.pollData(raws[0]);
      if (!poll) {
        return plans.map(() => ({ status: "skipped" as const, reason: "poll_sem_dados" }));
      }
      await deps.upsert([
        { ...base, kind: "poll", media: [], poll, fileName: null },
      ]);
      return group.map((g) => ({ status: "copied" as const, destMsgId: g.id }));
    }

    // ── Texto puro
    if (first.kind === "text") {
      await deps.upsert([
        { ...base, kind: "text", media: [], poll: null, fileName: null },
      ]);
      return group.map((g) => ({ status: "copied" as const, destMsgId: g.id }));
    }

    // ── Mídia: rehospeda cada item que couber no teto.
    const media: StagedMedia[] = [];
    for (let i = 0; i < raws.length; i++) {
      const plan = plans[i];
      if (plan.kind !== "media") continue;
      const url = await deps.rehost(raws[i], `msg_${group[i].id}`);
      if (url === null) continue; // grande demais: some do álbum, não derruba os irmãos
      media.push({ url, type: toStagedMediaType(plan.mediaKind) });
    }

    if (media.length === 0) {
      return plans.map(() => ({ status: "skipped" as const, reason: "file_too_large" }));
    }

    // Álbum de verdade só quando sobrou mais de um item albumável. Um item
    // sozinho é envio simples, e preservar o mediaKind real importa pro worker.
    const ehAlbum =
      media.length > 1 &&
      plans.every((p) => p.kind === "media" && ALBUMABLE.has(p.mediaKind));

    await deps.upsert([
      {
        ...base,
        kind: ehAlbum ? "album" : toRowKind(first.mediaKind),
        media,
        poll: null,
        fileName: deps.originalFileName(raws[0]),
      },
    ]);

    return group.map((g) => ({ status: "copied" as const, destMsgId: g.id }));
  };
}
```

O import de `PlanInput` vem de `./media-plan.js`, junto de `planForMessage` e `CloneMediaKind`.

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd server && npx vitest run tests/services/clone-draft-publisher.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Rodar a suíte inteira do server**

Run: `cd server && npm test`
Expected: PASS. Nenhum teste existente pode quebrar — nada foi modificado fora do arquivo novo.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mtproto/clone/draft-publisher.ts server/tests/services/clone-draft-publisher.test.ts
git commit -m "feat(clone): draft-publisher grava mensagens agendadas em vez de publicar"
```

---

### Task 6: Ramo rascunho no `clone-handler`

**Files:**
- Modify: `server/src/workers/clone-handler.ts`

**Interfaces:**
- Consumes: `createDraftPublisher`, `StagedRow`, `DraftPublisherDeps` da Task 5; `downloadAndRehostMedia` com `keyPrefix` da Task 4; `chooseStrategy` com `draftMode` da Task 3.
- Produces: `handleCloneRun` passa a tratar `job.mode === "draft"`. Nenhuma assinatura exportada muda.

Este é o único ponto onde as decisões viram fiação. Nada de `CloneRunner` muda.

- [ ] **Step 1: Adicionar os helpers do modo rascunho**

No topo de `server/src/workers/clone-handler.ts`, junto dos outros imports:

```ts
import { createDraftPublisher } from "../services/mtproto/clone/draft-publisher.js";
import type { StagedRow } from "../services/mtproto/clone/draft-publisher.js";
import { downloadAndRehostMedia } from "../services/mtproto/bot-clone/media-rehost.js";
```

E depois de `scheduleCloneResume`, acrescente:

```ts
/**
 * Grava um lote de linhas de rascunho. Upsert em (campaign_id, source_msg_id)
 * — ver 074: é o que torna a retomada pós-FLOOD_WAIT idempotente, coisa que o
 * clone live não tem (050).
 *
 * `reply_to_id` é resolvido aqui e não no publisher: o publisher só conhece o
 * id NA ORIGEM da mensagem respondida (é o que resolveReply devolve, porque o
 * destMsgId sintético é o próprio source id), e o uuid só existe no banco.
 */
async function upsertStagedRows(
  campaignId: string,
  tenantId: string,
  rows: StagedRow[],
): Promise<void> {
  const payload = [];
  for (const r of rows) {
    let replyToId: string | null = null;
    if (r.replyToSourceMsgId !== null) {
      const { data } = await supabase
        .from("mtproto_scheduled_messages")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("source_msg_id", r.replyToSourceMsgId)
        .maybeSingle();
      // Alvo fora do messageLimit não foi gravado: degrada pra envio sem
      // resposta, exatamente como o clone live faz quando o idMap não tem o id.
      replyToId = (data?.id as string | undefined) ?? null;
    }
    payload.push({
      campaign_id: campaignId,
      tenant_id: tenantId,
      kind: r.kind,
      content_text: r.contentText,
      media: r.media,
      entities: r.entities,
      inline_links: r.inlineLinks,
      poll: r.poll,
      file_name: r.fileName,
      position: r.position,
      source_msg_id: r.sourceMsgId,
      reply_to_id: replyToId,
    });
  }
  const { error } = await supabase
    .from("mtproto_scheduled_messages")
    .upsert(payload, { onConflict: "campaign_id,source_msg_id" });
  if (error) {
    // Sobe pro runner: uma linha perdida em silêncio vira post faltando no
    // rascunho, e o usuário não teria como saber qual.
    throw new Error(`falha ao gravar rascunho: ${error.message}`);
  }
}

/**
 * Renumera `position` como 1..N na ordem de `source_msg_id`, uma vez, no fim
 * do job. O publisher grava position=0 de propósito: calcular max+1 durante a
 * publicação abriria buraco e colisão numa retomada, que reprocessa lotes já
 * gravados.
 */
async function renumberDraftPositions(campaignId: string): Promise<number> {
  const { data } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("source_msg_id", { ascending: true });
  const rows = data ?? [];
  for (let i = 0; i < rows.length; i++) {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ position: i + 1 })
      .eq("id", rows[i].id);
  }
  return rows.length;
}
```

- [ ] **Step 2: Tornar o bot companheiro condicional**

Localize o bloco que carrega `automation_bots` e falha o job sem ele (por volta de `clone-handler.ts:185`). Envolva a exigência em `mode !== "draft"`:

```ts
    // Bot companheiro: pré-requisito só do modo live, que publica de verdade.
    // No rascunho ninguém publica nada — o bot só entra quando a campanha for
    // lançada (Plano 2), e exigi-lo aqui bloquearia um clone que não precisa
    // dele.
    const ehRascunho = job.mode === "draft";
    const { data: botRow } = await supabase
      .from("automation_bots")
      .select("id, token, username, session_string, status")
      .eq("tenant_id", job.tenant_id)
      .single();
    if (!ehRascunho && (!botRow || botRow.status !== "active")) {
      await fail(cloneJobId, "bot companheiro não cadastrado — cadastre o token antes de clonar");
      return;
    }
```

- [ ] **Step 3: Pular destino, tópicos e escolher o publisher**

Dentro do `try` interno, substitua o trecho que vai de `// 0) Fórum` até a criação de `publish` por uma bifurcação. O caminho `live` fica **exatamente** como está hoje; o novo caminho é:

```ts
      // ── Modo rascunho: sem destino, sem tópicos, sem bot. O job só lê a
      //    origem e grava. Tudo que depende de um canal de destino
      //    (ensureDestination, syncTopics, promoção do bot, invite) não roda.
      let publish: (
        group: SourceMessage[],
        replyToDestId: number | null,
      ) => Promise<CloneOutcome[]>;
      let topicSync: Awaited<ReturnType<typeof syncTopics>> | null = null;
      let wantsForum = false;
      let dest: { channelId: string; accessHash: string } | null = null;

      if (ehRascunho) {
        const campaignId = job.draft_campaign_id as string | null;
        if (!campaignId) {
          await fail(cloneJobId, "job em modo rascunho sem campanha vinculada");
          return;
        }
        await supabase
          .from("clone_jobs")
          .update({ effective_strategy: "download" })
          .eq("id", cloneJobId);

        const linkReplaceConfiguradoDraft = Boolean(
          job.link_replace_bot || job.link_replace_group || job.link_replace_channel,
        );
        publish = createDraftPublisher({
          rehost: async (raw, hint) =>
            downloadAndRehostMedia(
              { raw: client.raw, supabase },
              {
                media: raw.media,
                tenantId: job.tenant_id,
                jobId: cloneJobId,
                nodeIdHint: hint,
                fileName: hint,
                tmpDir,
                maxBytes: MAX_FILE_BYTES,
                keyPrefix: "campaign",
              },
            ),
          upsert: (rows) => upsertStagedRows(campaignId, job.tenant_id, rows),
          planInput: (raw, copyPolls) => SourceReader.mediaPlanInput(raw, copyPolls),
          extractInlineLinks: (raw) => SourceReader.extractInlineLinks(raw),
          pollData: (raw) => SourceReader.pollData(raw),
          originalFileName: (raw) => SourceReader.originalFileName(raw),
          copyPolls: job.copy_polls,
          copyButtons: job.copy_buttons,
          rewrite: linkReplaceConfiguradoDraft
            ? (input) =>
                rewriteMessageLinks(
                  input,
                  {
                    classify: (identifier: string) => {
                      const parsed = parseLinkIdentifier(identifier);
                      return parsed
                        ? client.classifyLink(parsed)
                        : Promise.resolve("unknown" as PeerKind);
                    },
                  },
                  {
                    botUsername: job.link_replace_bot ?? undefined,
                    groupLink: job.link_replace_group ?? undefined,
                    channelLink: job.link_replace_channel ?? undefined,
                  },
                )
            : null,
        });
      } else {
        // ... todo o caminho live de hoje, sem alteração, atribuindo
        //     `publish`, `topicSync`, `wantsForum` e `dest`.
      }
```

Você precisará importar no topo: `MAX_FILE_BYTES` (já exportado de `publish-router.js`), `rewriteMessageLinks` de `../services/mtproto/clone/link-replace.js`, e os tipos `SourceMessage` / `CloneOutcome` de `../services/mtproto/clone/types.js`. `client.raw` é o `TelegramClient` cru que `downloadAndRehostMedia` espera — confirme o nome do getter em `services/mtproto/client.ts` (`grep -n "get raw\|raw()" server/src/services/mtproto/client.ts`) e ajuste se for diferente.

- [ ] **Step 4: Ajustar `chooseStrategy` e `pinInDest`**

Na chamada de `chooseStrategy` (caminho live), nada muda. No `CloneRunnerDeps`, troque `pinInDest`:

```ts
          pinInDest: async (ids) => {
            if (ehRascunho) {
              // Sem destino pra fixar: marca a linha, e o worker de disparo
              // chama bot.pin() depois de publicar de verdade.
              const campaignId = job.draft_campaign_id as string;
              await supabase
                .from("mtproto_scheduled_messages")
                .update({ is_pinned: true })
                .eq("campaign_id", campaignId)
                .in("source_msg_id", ids);
              return;
            }
            for (const id of ids) {
              await bot!.pin(id).catch((err) => console.warn("[clone] pin falhou:", err));
            }
          },
```

O `.in("source_msg_id", ids)` funciona porque no rascunho o `destMsgId` é o próprio source id — os ids que chegam aqui já são de origem.

- [ ] **Step 5: Finalizar o rascunho depois do `runner.run()`**

Logo após `await runner.run();`, antes do bloco de `finalizeTopics`:

```ts
      // Rascunho: renumera as posições e leva a campanha pro estado certo.
      // Releitura fresca do status pelo mesmo motivo do finalizeTopics abaixo:
      // run() também retorna em pausa, flood e falha.
      if (ehRascunho) {
        const { data: finalRow } = await supabase
          .from("clone_jobs")
          .select("status")
          .eq("id", cloneJobId)
          .maybeSingle();
        if (finalRow?.status === "completed") {
          const campaignId = job.draft_campaign_id as string;
          const total = await renumberDraftPositions(campaignId);
          const querIa = job.ai_clean || job.ai_rewrite || job.ai_smart_delay;
          await supabase
            .from("mtproto_scheduled_campaigns")
            .update({
              total_messages: total,
              // A fase de IA (Plano 3) consome 'queued'. Sem alavanca ligada,
              // o rascunho já nasce pronto pra revisão humana.
              status: querIa ? "ai_processing" : "draft",
              ai_status: querIa ? "queued" : "idle",
            })
            .eq("id", campaignId);
        }
      }
```

Deixe o `enqueueMtproto({ kind: "campaign.ai-process", ... })` **fora** deste plano: o `kind` só existe no Plano 3. Marcar `ai_status='queued'` já deixa o trabalho registrado, e o Plano 3 acrescenta o enfileiramento aqui.

- [ ] **Step 6: Verificar que compila e que nada quebrou**

Run: `cd server && npx tsc --noEmit`
Expected: sem erro.

Run: `cd server && npm test`
Expected: PASS — 43 testes existentes mais os 9 da Task 5.

- [ ] **Step 7: Commit**

```bash
git add server/src/workers/clone-handler.ts
git commit -m "feat(clone): ramo de modo rascunho no handler, sem destino nem bot"
```

---

### Task 7: `createCloneJob` cria a campanha e aplica o teto

**Files:**
- Modify: `app/dashboard/automations/clones/actions.ts:91-190`

**Interfaces:**
- Consumes: tabelas das Tasks 1-2.
- Produces: `createCloneJob` aceita `mode: "live" | "draft"`, `aiClean`, `aiRewrite`, `aiSmartDelay`, e devolve `{ ok: true; cloneJobId: string; draftCampaignId?: string }`.

- [ ] **Step 1: Estender o tipo de entrada e de retorno**

Em `app/dashboard/automations/clones/actions.ts`, adicione ao objeto de input de `createCloneJob`:

```ts
  /** 'draft' manda o conteúdo pro rascunho de uma campanha em vez de publicar. */
  mode: "live" | "draft";
  aiClean: boolean;
  aiRewrite: boolean;
  aiSmartDelay: boolean;
```

E ao tipo `CreateCloneResult`, no ramo de sucesso, `draftCampaignId?: string`.

- [ ] **Step 2: Aplicar o teto e criar a campanha antes do job**

Dentro do `try`, depois da validação de `messageLimit` que já existe, acrescente:

```ts
    // Teto do modo rascunho: um clone de 20 mil posts com vídeo viraria
    // dezenas de GB no Storage e horas só pra montar o rascunho, e nenhuma
    // campanha de conteúdo real tem esse tamanho. 500 é o default; 1000 o
    // máximo aceito.
    const ehRascunho = input.mode === "draft";
    const messageLimit = ehRascunho
      ? Math.min(input.messageLimit ?? 500, 1000)
      : input.messageLimit;
```

E logo antes do `insert` em `clone_jobs`:

```ts
    let draftCampaignId: string | null = null;
    if (ehRascunho) {
      const { data: campaign, error: campErr } = await supabase
        .from("mtproto_scheduled_campaigns")
        .insert({
          tenant_id: tenantId,
          name: input.destTitle.trim() || `${dialog.title ?? "Clone"} (campanha)`,
          status: "draft",
          ai_clean: input.aiClean,
          ai_rewrite: input.aiRewrite,
          ai_smart_delay: input.aiSmartDelay,
        })
        .select("id")
        .single();
      if (campErr) return { ok: false, error: campErr.message };
      draftCampaignId = campaign.id;
    }
```

Depois, no `insert` de `clone_jobs`, troque `message_limit: input.messageLimit` por `message_limit: messageLimit` e acrescente:

```ts
        mode: input.mode,
        draft_campaign_id: draftCampaignId,
        ai_clean: input.aiClean,
        ai_rewrite: input.aiRewrite,
        ai_smart_delay: input.aiSmartDelay,
```

Se o insert do job falhar depois da campanha ter sido criada, apague a campanha órfã antes de retornar:

```ts
    if (error) {
      if (draftCampaignId) {
        await supabase.from("mtproto_scheduled_campaigns").delete().eq("id", draftCampaignId);
      }
      return { ok: false, error: error.message };
    }
```

E no retorno de sucesso:

```ts
    return { ok: true, cloneJobId: job.id, draftCampaignId: draftCampaignId ?? undefined };
```

Depois de inserir o job com sucesso, ligue a ponta inversa:

```ts
    if (draftCampaignId) {
      await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ source_clone_job_id: job.id })
        .eq("id", draftCampaignId);
    }
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: erro **esperado** em `components/dashboard/clone-form.tsx` — ele chama `createCloneJob` sem os campos novos. A Task 8 resolve. Confirme que é só esse arquivo.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/automations/clones/actions.ts
git commit -m "feat(clones): createCloneJob cria a campanha de rascunho e aplica o teto"
```

---

### Task 8: Formulário do clone escolhe o destino do conteúdo

**Files:**
- Modify: `components/dashboard/clone-form.tsx`

**Interfaces:**
- Consumes: `createCloneJob` da Task 7.
- Produces: nada consumido adiante neste plano.

- [ ] **Step 1: Adicionar o estado**

Junto dos outros `useState` de `components/dashboard/clone-form.tsx`:

```tsx
  const [mode, setMode] = useState<"live" | "draft">("live");
  const [ia, setIa] = useState({ clean: true, rewrite: false, smartDelay: true });
```

`clean` e `smartDelay` nascem ligados e `rewrite` desligado: limpar `@` é seguro, parafrasear pode mexer no CTA de um post de venda.

- [ ] **Step 2: Renderizar o seletor**

Logo abaixo do campo "Nome do destino", antes do checkbox de identidade:

```tsx
      <div className="space-y-2">
        <p className="input-label">O que fazer com o conteúdo</p>
        {(
          [
            {
              value: "live" as const,
              titulo: "Publicar direto no destino",
              hint: "Cria o canal e posta tudo agora, como sempre.",
            },
            {
              value: "draft" as const,
              titulo: "Mandar pro rascunho de uma campanha",
              hint: "Nada vai pro Telegram. Você revisa, edita e agenda antes de publicar.",
            },
          ]
        ).map((op) => (
          <label
            key={op.value}
            className="row-hover flex items-start gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) cursor-pointer"
          >
            <input
              type="radio"
              name="clone-mode"
              className="mt-1"
              checked={mode === op.value}
              onChange={() => setMode(op.value)}
            />
            <span>
              <span className="block text-foreground text-sm">{op.titulo}</span>
              <span className="block text-(--text-muted) text-xs">{op.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === "draft" && (
        <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
          <p className="input-label">Tratamento automático por IA</p>
          {(
            [
              {
                key: "clean" as const,
                label: "Limpar menções e links",
                hint: "Remove @ e links do concorrente. Não mexe no resto do texto.",
              },
              {
                key: "rewrite" as const,
                label: "Reescrever textos",
                hint: "Parafraseia pra evitar plágio e ajusta o tom. Preço, prazo e cupom ficam intactos, e o original fica salvo pra reverter.",
              },
              {
                key: "smartDelay" as const,
                label: "Definir a cadência",
                hint: "A IA decide o intervalo entre os posts pra parecer natural.",
              },
            ]
          ).map((t) => (
            <label
              key={t.key}
              className="row-hover flex items-start gap-3 px-3 py-2 rounded-lg cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={ia[t.key]}
                onChange={(e) => setIa({ ...ia, [t.key]: e.target.checked })}
              />
              <span>
                <span className="block text-foreground text-sm">{t.label}</span>
                <span className="block text-(--text-muted) text-xs">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
```

- [ ] **Step 3: Esconder o seletor de conta de destino no rascunho**

Localize o `<label>` de "Criar o destino na conta" e envolva em `{mode === "live" && ( ... )}`. No rascunho não existe destino a criar, e mostrar o campo prometeria algo que não acontece.

- [ ] **Step 4: Passar os campos novos na submissão**

Na chamada de `createCloneJob`, acrescente:

```tsx
        mode,
        aiClean: mode === "draft" && ia.clean,
        aiRewrite: mode === "draft" && ia.rewrite,
        aiSmartDelay: mode === "draft" && ia.smartDelay,
```

O `mode === "draft" &&` importa: sem ele, alternar pra rascunho, marcar as alavancas e voltar pra "publicar direto" gravaria flags de IA num job live, que nunca as lê — estado morto no banco esperando pra confundir alguém.

- [ ] **Step 5: Redirecionar pro rascunho**

Onde o formulário trata o retorno de sucesso, mande o usuário pro lugar certo:

```tsx
      if (r.ok) {
        // A tela da campanha só existe a partir do Plano 2. Até lá, o rascunho
        // criado é inspecionável pela tela do clone.
        router.push(`/dashboard/automations/clones/${r.cloneJobId}`);
      }
```

- [ ] **Step 6: Verificar que compila e o lint passa**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erro (o da Task 7 se resolve aqui).

Run: `npm run lint`
Expected: sem erro novo.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/clone-form.tsx
git commit -m "feat(clones): formulário escolhe entre publicar direto e mandar pro rascunho"
```

---

### Task 9: Verificação de ponta a ponta

**Files:** nenhum.

- [ ] **Step 1: Rodar as duas suítes**

Run: `cd server && npm test`
Expected: PASS.

Run: `npm test`
Expected: PASS — os 25 arquivos de `tests/lib/` continuam verdes (nada deste plano tocou a Prova Social).

- [ ] **Step 2: Aplicar as migrations**

Aplique `074` e `075` no Supabase pelo painel, na ordem. Confirme com uma query:

```sql
select column_name from information_schema.columns
where table_name = 'clone_jobs' and column_name in ('mode','draft_campaign_id');
```
Expected: duas linhas.

- [ ] **Step 3: Teste manual do fluxo**

1. Em `/dashboard/automations`, crie um clone escolhendo **"Mandar pro rascunho de uma campanha"**, com limite 20 e sem alavancas de IA.
2. Dispare o clone e acompanhe até `completed`.
3. Confirme no Supabase:

```sql
select position, kind, left(content_text, 40) as texto,
       jsonb_array_length(media) as midias, source_msg_id, is_pinned
from mtproto_scheduled_messages
where campaign_id = '<id>' order by position;
```

Espere: `position` de 1 a N sem buraco, `kind` coerente com o post de origem, `media[].url` apontando pro bucket `media` sob `.../campaign/...`, e **nenhuma mensagem publicada no Telegram**.

4. Confirme que a campanha ficou em `status='draft'` e `ai_status='idle'`.

- [ ] **Step 4: Commit final (se houve ajuste)**

```bash
git add -A
git commit -m "test: verificação ponta a ponta do clone em modo rascunho"
```

---

## Sequência de dependências

```
Task 1 (074) ─┬─ Task 2 (075 + tipos) ─┬─ Task 6 (clone-handler) ── Task 9
              │                        │        ▲
              │                        └─ Task 7 (action) ── Task 8 (form)
              │
Task 3 (chooseStrategy) ───────────────┘
Task 4 (keyPrefix) ── Task 5 (draft-publisher) ─┘
```

Tasks 3, 4 e 5 não dependem das migrations e podem ser feitas em paralelo com 1 e 2.
