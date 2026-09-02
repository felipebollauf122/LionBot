# Composer de Prova Social v2 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir a aba Prova Social do console contra o mockup de 3 colunas, com upload local, remetente "dona do canal" vs "membro", e estender o Mini App para renderizar reações, mensagem fixada, álbum, áudio e resposta.

**Architecture:** Migration incremental sobre a `071` já aplicada em produção. `media_url`/`media_type` dão lugar a uma lista `media` jsonb, o que obriga a derrubar duas CHECK constraints. Os componentes de `components/telegram/` crescem primeiro; o console é reconstruído depois, consumindo esses mesmos componentes na prévia — nunca markup próprio.

**Tech Stack:** Next.js 16.2.2 (App Router), React 19.2.4, Tailwind CSS 4, Supabase, Vitest 4 + Testing Library, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-09-02-social-proof-composer-v2-design.md`

## Global Constraints

- **A migration `071` JÁ ESTÁ APLICADA em produção.** A `073` é incremental e idempotente (`add column if not exists`). A `072` é de outro assunto (traffic filter). Nunca reescreva a `071`.
- **Backfill ANTES de trocar as constraints.** As linhas existentes violariam a regra nova no instante em que ela nascesse.
- **Nenhum `<select>` em nenhuma tela deste plano.** No Windows, `<option>` é desenhado pelo sistema operacional e ignora o CSS da página — é a causa raiz do campo branco ilegível relatado pelo usuário. Use botões segmentados ou lista customizada.
- **Nada em `components/telegram/` referencia token do dashboard** (`--bg-root`, `--text-primary`, `--accent`, `--border-subtle`, `glass`). Só `--tgc-*` e as classes de `theme.css`. Componentes de `components/dashboard/` PODEM usar os tokens do dashboard.
- **Server Action nunca faz `throw` para recusa prevista.** Volta `{ ok: false, error: "mensagem em português" }`. Erro lançado vira mensagem genérica em inglês na produção.
- **Tipos das actions moram em `lib/social-proof/types.ts`**, nunca no módulo `"use server"` — que só pode exportar funções async.
- **Testes são flat em `tests/lib/`.** Sem subpastas.
- **`npx tsc --noEmit` na raiz tem baseline de exatamente 6 erros, TODOS em `tests/lib/types.test.ts`** (fixtures desatualizadas, escopo alheio). NÃO conserte. Erro em outro arquivo é regressão.
- **`npm test` está em 181** no início deste plano.
- **`npm run lint` já sai com código 1** por dívida pré-existente (`server/` legado e um diretório `.next` varrido). Confirme apenas que não há achado novo nos arquivos tocados.
- **Comentários em português**, como o resto do repo.
- Alias `@/` aponta pra raiz do projeto.

---

## Estrutura de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/073_social_proof_v2.sql` | Colunas novas, FKs, backfill, constraints |
| `lib/social-proof/media.ts` | Normalizar mídia (lista ou colunas legadas), duração |
| `lib/social-proof/sender.ts` | Resolver identidade: dona do canal vs membro |
| `lib/social-proof/validate-message.ts` | Coerência entre `kind` e `media` |
| `lib/social-proof/reorder.ts` | Mover item de índice A para B |
| `components/telegram/pinned-bar.tsx` | Barra "Mensagem fixada" |
| `components/telegram/reactions-row.tsx` | Pílulas de emoji com contador |
| `components/telegram/album-grid.tsx` | Grade de 2–4 mídias |
| `components/telegram/audio-bubble.tsx` | Onda estática, play, duração |
| `components/telegram/reply-preview.tsx` | Bloco citado dentro da bolha |
| `components/dashboard/social-proof/media-picker.tsx` | Arrastar-e-soltar, escolher arquivo, URL |
| `components/dashboard/social-proof/channel-card.tsx` | Cartão do canal (coluna esquerda) |
| `components/dashboard/social-proof/owner-card.tsx` | Cartão da identidade da dona |
| `components/dashboard/social-proof/message-list.tsx` | Lista reordenável |
| `components/dashboard/social-proof/message-editor.tsx` | Painel direito |
| `components/dashboard/social-proof/quick-compose.tsx` | Barra de composição rápida |
| `components/dashboard/social-proof/composer-shell.tsx` | As 3 colunas + barra superior |
| `tests/lib/social-proof-media.test.ts` | |
| `tests/lib/social-proof-sender.test.ts` | |
| `tests/lib/social-proof-validate.test.ts` | |
| `tests/lib/social-proof-reorder.test.ts` | |
| `tests/lib/social-proof-bubble-v2.test.tsx` | Bolhas novas |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `lib/social-proof/types.ts` | `MediaItem`, `Reaction`, `SenderKind`, `MessageKind`; campos novos |
| `lib/social-proof/feed.ts` | Ler colunas novas, normalizar mídia, resolver fixada |
| `lib/actions/upload-actions.ts:35` | Aceitar áudio na allowlist |
| `lib/actions/social-proof-actions.ts` | Campos novos, duplicar, fixar, reordenar |
| `components/telegram/theme.css` | Classes das bolhas novas |
| `components/telegram/media-container.tsx` | Duração e play no vídeo |
| `components/telegram/message-bubble.tsx` | Selo da dona, álbum, áudio, resposta, reações |
| `components/telegram/message-group.tsx` | Avatar resolvido por `sender_kind` |
| `components/telegram/channel-header.tsx` | Seta de voltar e badge |
| `components/telegram/channel-feed.tsx` | Passar canal e fixada |
| `app/mini/[botId]/page.tsx` | Renderizar `PinnedBar` |
| `components/dashboard/social-proof/composer.tsx` | Vira casca fina sobre `composer-shell` |
| `components/dashboard/social-proof/feed-preview.tsx` | Consumir o modelo novo |

---

### Task 1: Migration 073 e tipos

**Files:**
- Create: `supabase/migrations/073_social_proof_v2.sql`
- Modify: `lib/social-proof/types.ts`
- Modify: `lib/types/database.ts` (Step 6 — é de lá que o composer lê as linhas cruas)

**Interfaces:**
- Consumes: nada.
- Produces: colunas novas nas duas tabelas; tipos `MediaItem`, `Reaction`, `SenderKind`, `MessageKind` e os campos novos em `FeedChannel`, `FeedMessage`, `ChannelInput`, `MessageInput`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/073_social_proof_v2.sql`:

```sql
-- Prova social v2: identidade da dona, tipos de mensagem, mídia em lista,
-- reações, resposta e mensagem fixada.
--
-- INCREMENTAL de propósito: a 071 já está aplicada em produção.

-- ─── Canal ────────────────────────────────────────────────────────────────
alter table public.social_proof_channels
  add column if not exists owner_name text not null default '',
  add column if not exists owner_avatar_url text,
  add column if not exists owner_username text not null default '',
  add column if not exists pinned_message_id uuid,
  add column if not exists unread_badge integer not null default 0;

-- ─── Mensagem ─────────────────────────────────────────────────────────────
alter table public.social_proof_messages
  add column if not exists sender_kind text not null default 'member',
  add column if not exists kind text not null default 'text',
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists reactions jsonb not null default '[]'::jsonb,
  add column if not exists reply_to_id uuid,
  add column if not exists display_time text;

-- ─── Backfill ─────────────────────────────────────────────────────────────
-- ANTES de trocar as constraints: as linhas existentes (media_url preenchido,
-- media ainda vazia) violariam a regra nova no instante em que ela nascesse.
update public.social_proof_messages
set media = jsonb_build_array(
      jsonb_build_object(
        'url', media_url,
        'type', case when media_type = 'image' then 'photo' else media_type end
      )
    ),
    kind = case when media_type = 'image' then 'photo' else 'video' end
where media_url is not null
  and media = '[]'::jsonb;

-- ─── Constraints ──────────────────────────────────────────────────────────
-- has_content da 071 exigia content_text OU media_url. Uma mensagem de álbum
-- tem a mídia na lista e media_url nulo — o banco recusaria o insert.
alter table public.social_proof_messages
  drop constraint if exists social_proof_messages_has_content,
  drop constraint if exists social_proof_messages_media_type_consistent;

alter table public.social_proof_messages
  add constraint social_proof_messages_has_content_v2
    check (content_text is not null or jsonb_array_length(media) > 0),
  add constraint social_proof_messages_sender_kind
    check (sender_kind in ('owner', 'member')),
  add constraint social_proof_messages_kind
    check (kind in ('text', 'photo', 'video', 'audio', 'album'));

-- ─── Chaves estrangeiras ──────────────────────────────────────────────────
-- on delete set null nos dois: apagar a mensagem fixada desafixa em vez de
-- derrubar o canal, e apagar a respondida deixa a resposta órfã em vez de
-- cascatear e sumir com uma mensagem que o tenant não mandou apagar.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_proof_channels_pinned_fk'
  ) then
    alter table public.social_proof_channels
      add constraint social_proof_channels_pinned_fk
        foreign key (pinned_message_id)
        references public.social_proof_messages(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'social_proof_messages_reply_fk'
  ) then
    alter table public.social_proof_messages
      add constraint social_proof_messages_reply_fk
        foreign key (reply_to_id)
        references public.social_proof_messages(id) on delete set null;
  end if;
end $$;
```

- [ ] **Step 2: Aplicar no Supabase**

Rodar o SQL acima no SQL Editor do projeto, como as anteriores. Conferir no editor que as colunas novas aparecem nas duas tabelas e que `social_proof_messages_has_content_v2` existe.

- [ ] **Step 3: Tipos novos**

Em `lib/social-proof/types.ts`, acrescentar no topo (antes de `FeedChannel`):

```ts
/** Um item de mídia. `album` tem vários; `audio` guarda a duração aqui. */
export interface MediaItem {
  url: string;
  type: "photo" | "video" | "audio";
  durationSeconds?: number;
}

/** Uma reação com contador, como o Telegram mostra sob a bolha. */
export interface Reaction {
  emoji: string;
  count: number;
}

/** Quem aparece enviando: a dona do canal ou um membro qualquer. */
export type SenderKind = "owner" | "member";

/** Os cinco botões de "Tipo de mensagem" do editor. */
export type MessageKind = "text" | "photo" | "video" | "audio" | "album";
```

- [ ] **Step 4: Estender `FeedChannel` e `FeedMessage`**

Substituir as duas interfaces por:

```ts
/** O que o Mini App precisa saber sobre o canal simulado. */
export interface FeedChannel {
  title: string;
  avatarUrl: string | null;
  subscribersLabel: string;
  isVerified: boolean;
  /** Identidade da dona — separada do canal (o canal pode ter outro avatar). */
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerUsername: string;
  /** Contador de não lidas no canto do cabeçalho. 0 esconde o badge. */
  unreadBadge: number;
}

/** Uma mensagem do feed, já sem os campos internos do banco. */
export interface FeedMessage {
  id: string;
  senderKind: SenderKind;
  /** Só usado quando senderKind === "member". */
  senderName: string;
  senderAvatarUrl: string | null;
  kind: MessageKind;
  contentText: string | null;
  media: MediaItem[];
  reactions: Reaction[];
  /** Texto da mensagem respondida, já resolvido pelo servidor. */
  replyToText: string | null;
  replyToSender: string | null;
  /** Há quantos segundos a mensagem "aconteceu", contado do agora do lead. */
  offsetSeconds: number;
  /** "HH:MM" fixo. Quando presente, sobrepõe o horário calculado do offset. */
  displayTime: string | null;
  viewsCount: number;
}
```

- [ ] **Step 5: Estender os tipos de entrada das actions**

Substituir `ChannelInput` e `MessageInput` por:

```ts
export interface ChannelInput {
  title: string;
  avatar_url: string | null;
  subscribers_label: string;
  is_verified: boolean;
  is_active: boolean;
  owner_name: string;
  owner_avatar_url: string | null;
  owner_username: string;
  unread_badge: number;
}

export interface MessageInput {
  id?: string;
  sender_kind: SenderKind;
  sender_name: string;
  sender_avatar_url: string | null;
  kind: MessageKind;
  content_text: string | null;
  media: MediaItem[];
  reactions: Reaction[];
  reply_to_id: string | null;
  display_time: string | null;
  offset_seconds: number;
  views_count: number;
  // `position` NÃO entra aqui: quem calcula é a Server Action (max+1).
}
```

- [ ] **Step 6: Espelhar as colunas novas nos tipos de banco**

`SocialProofChannel` e `SocialProofMessage` vivem em `lib/types/database.ts`, NÃO em `lib/social-proof/types.ts`, e são o que o composer consome (`getSocialProof` devolve essas linhas cruas). Sem este passo, `channel.owner_name` e `message.kind` não compilam nas Tasks 12 e 14.

Em `lib/types/database.ts`, acrescentar aos dois blocos existentes.

Em `SocialProofChannel`, antes de `created_at`:

```ts
  owner_name: string;
  owner_avatar_url: string | null;
  owner_username: string;
  pinned_message_id: string | null;
  unread_badge: number;
```

Em `SocialProofMessage`, antes de `created_at`:

```ts
  sender_kind: "owner" | "member";
  kind: "text" | "photo" | "video" | "audio" | "album";
  /** jsonb: lista de MediaItem. Ver lib/social-proof/media.ts. */
  media: MediaItem[];
  /** jsonb: lista de Reaction. */
  reactions: Reaction[];
  reply_to_id: string | null;
  display_time: string | null;
```

E acrescentar o import no topo do arquivo:

```ts
import type { MediaItem, Reaction } from "@/lib/social-proof/types";
```

As colunas `media_url` e `media_type` PERMANECEM nas duas interfaces: a `073` não as removeu, e `normalizeMedia` as usa como fallback.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: erros nos arquivos que consomem os tipos antigos (`feed.ts`, `message-bubble.tsx`, `message-group.tsx`, `composer.tsx`, `feed-preview.tsx`, `social-proof-actions.ts`). **Isso é esperado nesta task** — as tasks seguintes os corrigem. Anote a lista no relatório.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/073_social_proof_v2.sql lib/social-proof/types.ts lib/types/database.ts
git commit -m "feat(prova-social): schema v2 — dona do canal, tipos, midia em lista"
```

---

### Task 2: Normalização de mídia

**Files:**
- Create: `lib/social-proof/media.ts`
- Test: `tests/lib/social-proof-media.test.ts`

**Interfaces:**
- Consumes: `MediaItem`, `MessageKind` de `@/lib/social-proof/types`.
- Produces:
  - `normalizeMedia(raw: unknown, legacyUrl?: string | null, legacyType?: string | null): MediaItem[]`
  - `kindFromMedia(media: MediaItem[], hasText: boolean): MessageKind`
  - `formatDuration(seconds: number): string`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-media.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeMedia, kindFromMedia, formatDuration } from "@/lib/social-proof/media";

describe("normalizeMedia", () => {
  it("lista vazia quando não há nada", () => {
    expect(normalizeMedia([], null, null)).toEqual([]);
    expect(normalizeMedia(null, null, null)).toEqual([]);
  });

  it("lê a lista jsonb já no formato novo", () => {
    expect(normalizeMedia([{ url: "a.jpg", type: "photo" }])).toEqual([
      { url: "a.jpg", type: "photo" },
    ]);
  });

  it("preserva duração quando existe", () => {
    expect(normalizeMedia([{ url: "a.mp3", type: "audio", durationSeconds: 42 }])).toEqual([
      { url: "a.mp3", type: "audio", durationSeconds: 42 },
    ]);
  });

  it("cai nas colunas legadas quando a lista está vazia", () => {
    // Linhas gravadas antes da 073 e que o backfill não pegou.
    expect(normalizeMedia([], "velho.jpg", "image")).toEqual([
      { url: "velho.jpg", type: "photo" },
    ]);
  });

  it("traduz o 'image' legado para 'photo'", () => {
    expect(normalizeMedia([], "x.png", "image")[0].type).toBe("photo");
  });

  it("mantém 'video' legado como está", () => {
    expect(normalizeMedia([], "x.mp4", "video")[0].type).toBe("video");
  });

  it("a lista nova ganha da coluna legada quando as duas existem", () => {
    const out = normalizeMedia([{ url: "novo.jpg", type: "photo" }], "velho.jpg", "image");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("novo.jpg");
  });

  it("descarta item sem url", () => {
    expect(normalizeMedia([{ type: "photo" }, { url: "ok.jpg", type: "photo" }])).toEqual([
      { url: "ok.jpg", type: "photo" },
    ]);
  });

  it("descarta item com type inválido", () => {
    expect(normalizeMedia([{ url: "x", type: "pdf" }])).toEqual([]);
  });

  it("entrada que não é lista vira lista vazia sem lançar", () => {
    expect(normalizeMedia("isso não é lista")).toEqual([]);
    expect(normalizeMedia(42)).toEqual([]);
  });
});

describe("kindFromMedia", () => {
  it("sem mídia é texto", () => {
    expect(kindFromMedia([], true)).toBe("text");
  });

  it("uma foto é photo", () => {
    expect(kindFromMedia([{ url: "a", type: "photo" }], false)).toBe("photo");
  });

  it("um vídeo é video", () => {
    expect(kindFromMedia([{ url: "a", type: "video" }], false)).toBe("video");
  });

  it("um áudio é audio", () => {
    expect(kindFromMedia([{ url: "a", type: "audio" }], false)).toBe("audio");
  });

  it("duas ou mais mídias é album", () => {
    expect(
      kindFromMedia([{ url: "a", type: "photo" }, { url: "b", type: "photo" }], false),
    ).toBe("album");
  });

  it("álbum misturando foto e vídeo continua album", () => {
    expect(
      kindFromMedia([{ url: "a", type: "photo" }, { url: "b", type: "video" }], false),
    ).toBe("album");
  });
});

describe("formatDuration", () => {
  it("formata segundos como m:ss", () => {
    expect(formatDuration(12)).toBe("0:12");
    expect(formatDuration(72)).toBe("1:12");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("zero e negativo viram 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("passa de uma hora sem quebrar", () => {
    expect(formatDuration(3725)).toBe("62:05");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-media.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/social-proof/media"`.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/media.ts`:

```ts
import type { MediaItem, MessageKind } from "@/lib/social-proof/types";

const TIPOS_VALIDOS = new Set(["photo", "video", "audio"]);

/**
 * Normaliza a mídia de uma mensagem.
 *
 * A coluna `media` (jsonb) é a fonte nova. As colunas `media_url`/`media_type`
 * da 071 continuam na tabela e servem de fallback para qualquer linha que o
 * backfill da 073 não tenha pego — a lista nova sempre ganha quando existe.
 *
 * O 'image' legado vira 'photo': o mockup nomeia o botão "Foto", e manter dois
 * nomes para a mesma coisa espalharia condicionais por toda a UI.
 *
 * Nunca lança: entrada malformada vira lista vazia. Isto lê jsonb, que o
 * Postgres não valida contra o nosso formato.
 */
export function normalizeMedia(
  raw: unknown,
  legacyUrl?: string | null,
  legacyType?: string | null,
): MediaItem[] {
  const lista = Array.isArray(raw) ? raw : [];

  const itens: MediaItem[] = [];
  for (const bruto of lista) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const { url, type, durationSeconds } = bruto as Record<string, unknown>;
    if (typeof url !== "string" || url === "") continue;
    if (typeof type !== "string" || !TIPOS_VALIDOS.has(type)) continue;

    const item: MediaItem = { url, type: type as MediaItem["type"] };
    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
      item.durationSeconds = durationSeconds;
    }
    itens.push(item);
  }

  if (itens.length > 0) return itens;

  // Fallback nas colunas da 071.
  if (typeof legacyUrl === "string" && legacyUrl !== "" && typeof legacyType === "string") {
    const tipo = legacyType === "image" ? "photo" : legacyType;
    if (TIPOS_VALIDOS.has(tipo)) {
      return [{ url: legacyUrl, type: tipo as MediaItem["type"] }];
    }
  }

  return [];
}

/**
 * Deduz o `kind` a partir da mídia. Duas ou mais peças é sempre álbum,
 * independente de misturar foto e vídeo — é como o Telegram agrupa.
 */
export function kindFromMedia(media: MediaItem[], _hasText: boolean): MessageKind {
  if (media.length === 0) return "text";
  if (media.length > 1) return "album";
  return media[0].type;
}

/** Duração no formato do Telegram: m:ss, sem hora separada. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-media.test.ts`
Expected: PASS, 19 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/media.ts tests/lib/social-proof-media.test.ts
git commit -m "feat(prova-social): normalizacao de midia em lista com fallback legado"
```

---

### Task 3: Identidade do remetente

**Files:**
- Create: `lib/social-proof/sender.ts`
- Test: `tests/lib/social-proof-sender.test.ts`

**Interfaces:**
- Consumes: `FeedChannel`, `FeedMessage`, `SenderKind` de `@/lib/social-proof/types`.
- Produces: `resolveSender(message, channel): ResolvedSender` e o tipo `ResolvedSender = { name: string; avatarUrl: string | null; badge: string | null }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-sender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSender } from "@/lib/social-proof/sender";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

const canal: FeedChannel = {
  title: "teste",
  avatarUrl: "lobo.png",
  subscribersLabel: "52 321 inscritos",
  isVerified: true,
  ownerName: "Daniel",
  ownerAvatarUrl: "daniel.png",
  ownerUsername: "daniel_oficial",
  unreadBadge: 243,
};

function msg(over: Partial<FeedMessage> = {}): FeedMessage {
  return {
    id: "m1",
    senderKind: "member",
    senderName: "Ana",
    senderAvatarUrl: null,
    kind: "text",
    contentText: "oi",
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds: 600,
    displayTime: null,
    viewsCount: 0,
    ...over,
  };
}

describe("resolveSender", () => {
  it("membro usa o próprio nome e avatar", () => {
    expect(resolveSender(msg({ senderName: "Ana", senderAvatarUrl: "ana.png" }), canal)).toEqual({
      name: "Ana",
      avatarUrl: "ana.png",
      badge: null,
    });
  });

  it("membro sem avatar fica com null, pra cair na inicial colorida", () => {
    expect(resolveSender(msg({ senderAvatarUrl: null }), canal).avatarUrl).toBeNull();
  });

  it("dona usa a identidade do canal, não a da mensagem", () => {
    const out = resolveSender(msg({ senderKind: "owner", senderName: "ignorado" }), canal);
    expect(out.name).toBe("Daniel");
    expect(out.avatarUrl).toBe("daniel.png");
  });

  it("dona ganha o selo 'Dona do canal'", () => {
    expect(resolveSender(msg({ senderKind: "owner" }), canal).badge).toBe("Dona do canal");
  });

  it("membro nunca ganha selo", () => {
    expect(resolveSender(msg({ senderKind: "member" }), canal).badge).toBeNull();
  });

  it("dona sem nome cadastrado cai no título do canal", () => {
    // Senão a bolha sairia com nome vazio, que é pior que redundante.
    const semDona = { ...canal, ownerName: "" };
    expect(resolveSender(msg({ senderKind: "owner" }), semDona).name).toBe("teste");
  });

  it("membro sem nome cai em 'Membro'", () => {
    expect(resolveSender(msg({ senderName: "   " }), canal).name).toBe("Membro");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-sender.test.ts`
Expected: FAIL — import não resolvido.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/sender.ts`:

```ts
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

export interface ResolvedSender {
  name: string;
  avatarUrl: string | null;
  /** "Dona do canal" quando a mensagem é da dona; null para membro. */
  badge: string | null;
}

const SELO_DONA = "Dona do canal";

/**
 * Decide quem aparece enviando a mensagem.
 *
 * A dona é uma identidade do CANAL, não da mensagem: no mockup o canal é
 * "teste" com avatar de lobo e a dona é "Daniel" com avatar próprio. Por isso
 * mensagens com sender_kind "owner" ignoram sender_name/sender_avatar_url —
 * elas existem só para os membros.
 *
 * Os fallbacks evitam bolha com nome vazio, que chama mais atenção que um nome
 * genérico.
 */
export function resolveSender(message: FeedMessage, channel: FeedChannel): ResolvedSender {
  if (message.senderKind === "owner") {
    const nome = channel.ownerName.trim() || channel.title.trim() || "Canal";
    return { name: nome, avatarUrl: channel.ownerAvatarUrl, badge: SELO_DONA };
  }

  return {
    name: message.senderName.trim() || "Membro",
    avatarUrl: message.senderAvatarUrl,
    badge: null,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-sender.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/sender.ts tests/lib/social-proof-sender.test.ts
git commit -m "feat(prova-social): identidade da dona do canal vs membro"
```

---

### Task 4: Validação de mensagem

**Files:**
- Create: `lib/social-proof/validate-message.ts`
- Test: `tests/lib/social-proof-validate.test.ts`

**Interfaces:**
- Consumes: `MessageInput` de `@/lib/social-proof/types`.
- Produces: `validateMessage(input: MessageInput): { ok: true } | { ok: false; error: string }`.

Mensagens de erro em português, prontas para a UI — esta função é a fonte das mensagens que o composer mostra.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateMessage } from "@/lib/social-proof/validate-message";
import type { MessageInput } from "@/lib/social-proof/types";

function input(over: Partial<MessageInput> = {}): MessageInput {
  return {
    sender_kind: "member",
    sender_name: "Ana",
    sender_avatar_url: null,
    kind: "text",
    content_text: "oi",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 600,
    views_count: 0,
    ...over,
  };
}

describe("validateMessage", () => {
  it("aceita texto simples", () => {
    expect(validateMessage(input())).toEqual({ ok: true });
  });

  it("recusa mensagem sem texto e sem mídia", () => {
    const out = validateMessage(input({ content_text: "  ", media: [] }));
    expect(out).toEqual({ ok: false, error: "A mensagem precisa de texto ou mídia." });
  });

  it("aceita mídia sem texto", () => {
    expect(
      validateMessage(input({ kind: "photo", content_text: null, media: [{ url: "a", type: "photo" }] })),
    ).toEqual({ ok: true });
  });

  it("recusa membro sem nome", () => {
    const out = validateMessage(input({ sender_name: "   " }));
    expect(out).toEqual({ ok: false, error: "O nome do remetente não pode ficar vazio." });
  });

  it("dona não precisa de nome de remetente", () => {
    // A identidade vem do canal, não da mensagem.
    expect(validateMessage(input({ sender_kind: "owner", sender_name: "" }))).toEqual({ ok: true });
  });

  it("recusa offset negativo", () => {
    expect(validateMessage(input({ offset_seconds: -1 }))).toEqual({
      ok: false,
      error: "O tempo atrás não pode ser negativo.",
    });
  });

  it("recusa views negativas", () => {
    expect(validateMessage(input({ views_count: -3 }))).toEqual({
      ok: false,
      error: "As visualizações não podem ser negativas.",
    });
  });

  it("recusa álbum com menos de duas mídias", () => {
    const out = validateMessage(input({ kind: "album", media: [{ url: "a", type: "photo" }] }));
    expect(out).toEqual({ ok: false, error: "Um álbum precisa de pelo menos duas mídias." });
  });

  it("aceita álbum com duas mídias", () => {
    expect(
      validateMessage(
        input({ kind: "album", media: [{ url: "a", type: "photo" }, { url: "b", type: "video" }] }),
      ),
    ).toEqual({ ok: true });
  });

  it("recusa tipo de mídia que não bate com o kind", () => {
    const out = validateMessage(input({ kind: "photo", media: [{ url: "a", type: "video" }] }));
    expect(out).toEqual({ ok: false, error: "A mídia enviada não é do tipo escolhido." });
  });

  it("recusa kind de mídia sem mídia nenhuma", () => {
    const out = validateMessage(input({ kind: "video", media: [] }));
    expect(out).toEqual({ ok: false, error: "Escolha um arquivo ou cole uma URL." });
  });

  it("recusa horário fora do formato HH:MM", () => {
    expect(validateMessage(input({ display_time: "2:5" }))).toEqual({
      ok: false,
      error: "O horário precisa estar no formato HH:MM.",
    });
    expect(validateMessage(input({ display_time: "25:00" })).ok).toBe(false);
    expect(validateMessage(input({ display_time: "12:60" })).ok).toBe(false);
  });

  it("aceita horário válido e horário vazio", () => {
    expect(validateMessage(input({ display_time: "02:44" }))).toEqual({ ok: true });
    expect(validateMessage(input({ display_time: null }))).toEqual({ ok: true });
  });

  it("recusa texto acima de 1024 caracteres", () => {
    const out = validateMessage(input({ content_text: "a".repeat(1025) }));
    expect(out).toEqual({ ok: false, error: "O texto passa de 1024 caracteres." });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-validate.test.ts`
Expected: FAIL — import não resolvido.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/validate-message.ts`:

```ts
import type { MessageInput } from "@/lib/social-proof/types";

export type ValidationResult = { ok: true } | { ok: false; error: string };

const MAX_TEXTO = 1024;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Valida uma mensagem antes de gravar.
 *
 * As mensagens são as que o composer mostra ao tenant, então estão em
 * português e descrevem a correção, não o sintoma. Esta função é a fonte
 * única delas: a Server Action a chama e devolve o texto como está.
 */
export function validateMessage(input: MessageInput): ValidationResult {
  const temTexto = (input.content_text ?? "").trim() !== "";
  const temMidia = input.media.length > 0;

  if (!temTexto && !temMidia) {
    return { ok: false, error: "A mensagem precisa de texto ou mídia." };
  }

  if ((input.content_text ?? "").length > MAX_TEXTO) {
    return { ok: false, error: "O texto passa de 1024 caracteres." };
  }

  // A dona tira a identidade do canal; só membro precisa de nome próprio.
  if (input.sender_kind === "member" && input.sender_name.trim() === "") {
    return { ok: false, error: "O nome do remetente não pode ficar vazio." };
  }

  if (input.offset_seconds < 0) {
    return { ok: false, error: "O tempo atrás não pode ser negativo." };
  }

  if (input.views_count < 0) {
    return { ok: false, error: "As visualizações não podem ser negativas." };
  }

  if (input.kind === "album" && input.media.length < 2) {
    return { ok: false, error: "Um álbum precisa de pelo menos duas mídias." };
  }

  if (input.kind !== "text" && input.kind !== "album") {
    if (!temMidia) {
      return { ok: false, error: "Escolha um arquivo ou cole uma URL." };
    }
    if (input.media[0].type !== input.kind) {
      return { ok: false, error: "A mídia enviada não é do tipo escolhido." };
    }
  }

  if (input.display_time !== null && !HORARIO.test(input.display_time)) {
    return { ok: false, error: "O horário precisa estar no formato HH:MM." };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-validate.test.ts`
Expected: PASS, 14 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/validate-message.ts tests/lib/social-proof-validate.test.ts
git commit -m "feat(prova-social): validacao de mensagem com mensagens em portugues"
```

---

### Task 5: Reordenação

**Files:**
- Create: `lib/social-proof/reorder.ts`
- Test: `tests/lib/social-proof-reorder.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `moveItem<T>(list: T[], from: number, to: number): T[]`.

Pura de propósito: a aritmética de índice erra fácil e o resultado é quase invisível em teste manual.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-reorder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moveItem } from "@/lib/social-proof/reorder";

const base = ["a", "b", "c", "d"];

describe("moveItem", () => {
  it("move para frente", () => {
    expect(moveItem(base, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("move para trás", () => {
    expect(moveItem(base, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("move para o fim", () => {
    expect(moveItem(base, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("move para o começo", () => {
    expect(moveItem(base, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("mover para a própria posição não muda nada", () => {
    expect(moveItem(base, 1, 1)).toEqual(base);
  });

  it("não muta a lista original", () => {
    const copia = [...base];
    moveItem(base, 0, 3);
    expect(base).toEqual(copia);
  });

  it("índice fora do intervalo devolve a lista intacta", () => {
    // Arrastar pra fora da área solta um índice inválido; melhor ignorar que
    // embaralhar a lista do tenant.
    expect(moveItem(base, -1, 2)).toEqual(base);
    expect(moveItem(base, 0, 99)).toEqual(base);
    expect(moveItem(base, 99, 0)).toEqual(base);
  });

  it("lista vazia ou de um item não quebra", () => {
    expect(moveItem([], 0, 0)).toEqual([]);
    expect(moveItem(["a"], 0, 0)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-reorder.test.ts`
Expected: FAIL — import não resolvido.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/reorder.ts`:

```ts
/**
 * Move um item de `from` para `to`, devolvendo uma lista nova.
 *
 * Índice fora do intervalo devolve a lista intacta em vez de lançar: arrastar
 * e soltar fora da área produz índice inválido com facilidade, e embaralhar a
 * ordem do tenant por causa disso seria pior que ignorar o gesto.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const fora =
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length;

  if (fora || from === to) return [...list];

  const copia = [...list];
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-reorder.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/reorder.ts tests/lib/social-proof-reorder.test.ts
git commit -m "feat(prova-social): helper puro de reordenacao"
```

---

### Task 6: Classes CSS das bolhas novas

**Files:**
- Modify: `components/telegram/theme.css`

**Interfaces:**
- Consumes: os tokens `--tgc-*` já definidos no arquivo.
- Produces: as classes `.tg-pinned`, `.tg-owner-badge`, `.tg-reactions`, `.tg-reaction`, `.tg-album`, `.tg-audio`, `.tg-reply`, `.tg-media-duration`.

- [ ] **Step 1: Acrescentar os tokens novos**

Em `components/telegram/theme.css`, dentro do bloco `.tg-app` que define os `--tgc-*` (logo depois de `--tgc-veil`), acrescentar:

```css
  /* Superfícies das bolhas novas. Derivadas, porque o SDK não expõe nenhuma
     delas — mesma limitação já documentada para --tgc-bubble. */
  --tgc-pinned-bg: rgba(0, 0, 0, 0.22);
  --tgc-reaction-bg: rgba(255, 255, 255, 0.10);
  --tgc-reply-bar: var(--tgc-link);
```

- [ ] **Step 2: Acrescentar as classes**

Ao final de `components/telegram/theme.css`:

```css
/* Barra de mensagem fixada, logo abaixo do cabeçalho do canal. */
.tg-pinned {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: var(--tgc-pinned-bg);
  border-left: 3px solid var(--tgc-link);
  font-size: 14px;
  line-height: 1.25;
}

.tg-pinned-title {
  color: var(--tgc-link);
  font-weight: 500;
  font-size: 13px;
}

.tg-pinned-text {
  color: var(--tgc-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Selo "Dona do canal" — alinhado à direita no cabeçalho da bolha. */
.tg-owner-badge {
  margin-left: auto;
  padding-left: 12px;
  color: var(--tgc-hint);
  font-size: 12px;
  white-space: nowrap;
}

/* Linha de reações sob o conteúdo da bolha. */
.tg-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.tg-reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--tgc-reaction-bg);
  font-size: 13px;
  line-height: 1.4;
}

/* Grade de álbum. 2 itens = 2 colunas; 3 ou 4 = 2x2 com o primeiro largo. */
.tg-album {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  border-radius: calc(var(--tgc-bubble-radius) - 3px);
  overflow: hidden;
}

.tg-album-item {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}

.tg-album-item img,
.tg-album-item video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Bolha de áudio: play + onda + duração. */
.tg-audio {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
  padding: 4px 0;
}

.tg-audio-play {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--tgc-button);
  color: var(--tgc-button-text);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
}

.tg-audio-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  flex: 1;
}

.tg-audio-bar {
  width: 2px;
  border-radius: 1px;
  background: var(--tgc-hint);
}

/* Bloco citado dentro da bolha, para respostas. */
.tg-reply {
  border-left: 2px solid var(--tgc-reply-bar);
  padding: 2px 0 2px 8px;
  margin-bottom: 4px;
  font-size: 14px;
  line-height: 1.2;
}

.tg-reply-sender {
  color: var(--tgc-link);
  font-weight: 500;
}

.tg-reply-text {
  color: var(--tgc-hint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Duração sobreposta no canto do vídeo. */
.tg-media-duration {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
}
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: sem mudança em relação ao estado atual (CSS não afeta nenhum dos dois; é só confirmar que nada quebrou).

- [ ] **Step 4: Commit**

```bash
git add components/telegram/theme.css
git commit -m "feat(prova-social): classes das bolhas de album, audio, reacao e fixada"
```

---

### Task 7: Bolhas novas do Mini App

**Files:**
- Create: `components/telegram/reactions-row.tsx`
- Create: `components/telegram/album-grid.tsx`
- Create: `components/telegram/audio-bubble.tsx`
- Create: `components/telegram/reply-preview.tsx`
- Create: `components/telegram/pinned-bar.tsx`
- Test: `tests/lib/social-proof-bubble-v2.test.tsx`

**Interfaces:**
- Consumes: `MediaItem`, `Reaction` de `@/lib/social-proof/types`; `formatDuration` de `@/lib/social-proof/media`; as classes da Task 6.
- Produces:
  - `<ReactionsRow reactions: Reaction[] />`
  - `<AlbumGrid media: MediaItem[] />`
  - `<AudioBubble item: MediaItem; seed: string />`
  - `<ReplyPreview sender: string; text: string />`
  - `<PinnedBar text: string />`

Todos Server Components — sem `"use client"`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-bubble-v2.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactionsRow } from "@/components/telegram/reactions-row";
import { AlbumGrid } from "@/components/telegram/album-grid";
import { AudioBubble } from "@/components/telegram/audio-bubble";
import { ReplyPreview } from "@/components/telegram/reply-preview";
import { PinnedBar } from "@/components/telegram/pinned-bar";

describe("ReactionsRow", () => {
  it("mostra emoji e contador", () => {
    render(<ReactionsRow reactions={[{ emoji: "❤️", count: 24 }]} />);
    expect(screen.getByText("❤️")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("não renderiza nada quando a lista está vazia", () => {
    const { container } = render(<ReactionsRow reactions={[]} />);
    expect(container.querySelector(".tg-reactions")).toBeNull();
  });

  it("omite reação com contador zero", () => {
    // Reação sem ninguém é ruído visual e denuncia que os números são inventados.
    const { container } = render(<ReactionsRow reactions={[{ emoji: "🔥", count: 0 }]} />);
    expect(container.querySelector(".tg-reactions")).toBeNull();
  });
});

describe("AlbumGrid", () => {
  it("renderiza uma imagem por item", () => {
    const { container } = render(
      <AlbumGrid media={[{ url: "a.jpg", type: "photo" }, { url: "b.jpg", type: "photo" }]} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("usa video para item de vídeo", () => {
    const { container } = render(
      <AlbumGrid media={[{ url: "a.jpg", type: "photo" }, { url: "b.mp4", type: "video" }]} />,
    );
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("mostra o excedente como +N a partir do quinto item", () => {
    const media = Array.from({ length: 6 }, (_, i) => ({ url: `${i}.jpg`, type: "photo" as const }));
    render(<AlbumGrid media={media} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("não mostra +N com exatamente quatro itens", () => {
    const media = Array.from({ length: 4 }, (_, i) => ({ url: `${i}.jpg`, type: "photo" as const }));
    const { container } = render(<AlbumGrid media={media} />);
    expect(container.textContent).not.toContain("+");
  });
});

describe("AudioBubble", () => {
  it("mostra a duração formatada", () => {
    render(<AudioBubble item={{ url: "a.mp3", type: "audio", durationSeconds: 72 }} seed="m1" />);
    expect(screen.getByText("1:12")).toBeInTheDocument();
  });

  it("sem duração mostra 0:00", () => {
    render(<AudioBubble item={{ url: "a.mp3", type: "audio" }} seed="m1" />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("a onda é determinística: a mesma seed dá as mesmas barras", () => {
    const a = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="igual" />);
    const alturasA = [...a.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );
    a.unmount();

    const b = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="igual" />);
    const alturasB = [...b.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );

    expect(alturasA).toEqual(alturasB);
    expect(alturasA.length).toBeGreaterThan(0);
  });

  it("seeds diferentes produzem ondas diferentes", () => {
    const a = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="um" />);
    const alturasA = [...a.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );
    a.unmount();

    const b = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="dois" />);
    const alturasB = [...b.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );

    expect(alturasA).not.toEqual(alturasB);
  });
});

describe("ReplyPreview", () => {
  it("mostra remetente e texto citados", () => {
    render(<ReplyPreview sender="Ana" text="mensagem original" />);
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("mensagem original")).toBeInTheDocument();
  });
});

describe("PinnedBar", () => {
  it("mostra o rótulo e o texto fixado", () => {
    render(<PinnedBar text="Bem-vindas ao canal VIP" />);
    expect(screen.getByText("Mensagem fixada")).toBeInTheDocument();
    expect(screen.getByText("Bem-vindas ao canal VIP")).toBeInTheDocument();
  });

  it("não renderiza nada com texto vazio", () => {
    const { container } = render(<PinnedBar text="   " />);
    expect(container.querySelector(".tg-pinned")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-bubble-v2.test.tsx`
Expected: FAIL — imports não resolvidos.

- [ ] **Step 3: Implementar `reactions-row.tsx`**

```tsx
import type { Reaction } from "@/lib/social-proof/types";

/**
 * Pílulas de reação sob o conteúdo da bolha.
 *
 * Reação com contador zero é descartada: no Telegram uma reação só existe
 * enquanto alguém a mantém, e um "🔥 0" denuncia que os números são inventados.
 */
export function ReactionsRow({ reactions }: { reactions: Reaction[] }) {
  const visiveis = reactions.filter((r) => r.count > 0);
  if (visiveis.length === 0) return null;

  return (
    <div className="tg-reactions">
      {visiveis.map((r) => (
        <span key={r.emoji} className="tg-reaction">
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implementar `album-grid.tsx`**

```tsx
import type { MediaItem } from "@/lib/social-proof/types";

const MAX_VISIVEL = 4;

/**
 * Grade de álbum. O Telegram mostra no máximo quatro peças e resume o resto
 * como "+N" sobre a última — mostrar todas transformaria a bolha numa parede.
 */
export function AlbumGrid({ media }: { media: MediaItem[] }) {
  const visiveis = media.slice(0, MAX_VISIVEL);
  const excedente = media.length - visiveis.length;

  return (
    <div className="tg-album">
      {visiveis.map((item, i) => (
        <div className="tg-album-item" key={`${item.url}-${i}`}>
          {item.type === "video" ? (
            <video src={item.url} preload="metadata" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt="" loading="lazy" />
          )}

          {excedente > 0 && i === visiveis.length - 1 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 22,
                fontWeight: 500,
              }}
            >
              +{excedente}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implementar `audio-bubble.tsx`**

```tsx
import type { MediaItem } from "@/lib/social-proof/types";
import { formatDuration } from "@/lib/social-proof/media";

const BARRAS = 28;

/**
 * Onda estática derivada de um hash da seed (o id da mensagem).
 *
 * Não há análise do arquivo: áudio simulado com onda plausível convence, e
 * decodificar o arquivo custaria processamento sem ganho visual proporcional.
 * O que importa é ser DETERMINÍSTICO — onda diferente a cada render entregaria
 * o truque na primeira vez que o lead rolasse a tela de volta.
 */
function alturas(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const out: number[] = [];
  for (let i = 0; i < BARRAS; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    // 6px a 24px — nunca zero, senão a barra some e a onda fica esburacada.
    out.push(6 + (Math.abs(h) % 19));
  }
  return out;
}

export function AudioBubble({ item, seed }: { item: MediaItem; seed: string }) {
  return (
    <div className="tg-audio">
      <span className="tg-audio-play" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>

      <span className="tg-audio-wave" aria-hidden>
        {alturas(seed).map((h, i) => (
          <span key={i} className="tg-audio-bar" style={{ height: h }} />
        ))}
      </span>

      <span style={{ color: "var(--tgc-hint)", fontSize: 12, flexShrink: 0 }}>
        {formatDuration(item.durationSeconds ?? 0)}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Implementar `reply-preview.tsx`**

```tsx
/**
 * Bloco citado dentro da bolha, para a ação "Responder".
 * O texto trunca numa linha — o Telegram nunca deixa a citação crescer.
 */
export function ReplyPreview({ sender, text }: { sender: string; text: string }) {
  return (
    <div className="tg-reply">
      <div className="tg-reply-sender">{sender}</div>
      <div className="tg-reply-text">{text}</div>
    </div>
  );
}
```

- [ ] **Step 7: Implementar `pinned-bar.tsx`**

```tsx
/**
 * Barra "Mensagem fixada", entre o cabeçalho do canal e o feed.
 * Texto vazio não renderiza nada: uma barra vazia é mais estranha que a
 * ausência dela.
 */
export function PinnedBar({ text }: { text: string }) {
  if (text.trim() === "") return null;

  return (
    <div className="tg-pinned">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tg-pinned-title">Mensagem fixada</div>
        <div className="tg-pinned-text">{text}</div>
      </div>
      <span aria-hidden style={{ color: "var(--tgc-hint)", fontSize: 18, lineHeight: 1 }}>
        ×
      </span>
    </div>
  );
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-bubble-v2.test.tsx`
Expected: PASS, 14 testes.

- [ ] **Step 9: Commit**

```bash
git add components/telegram/reactions-row.tsx components/telegram/album-grid.tsx \
        components/telegram/audio-bubble.tsx components/telegram/reply-preview.tsx \
        components/telegram/pinned-bar.tsx tests/lib/social-proof-bubble-v2.test.tsx
git commit -m "feat(prova-social): bolhas de reacao, album, audio, resposta e fixada"
```

---

### Task 8: Bolha e cabeçalho existentes passam a entender o modelo novo

**Files:**
- Modify: `components/telegram/media-container.tsx`
- Modify: `components/telegram/message-bubble.tsx`
- Modify: `components/telegram/message-group.tsx`
- Modify: `components/telegram/channel-feed.tsx`
- Modify: `components/telegram/channel-header.tsx`
- Modify: `tests/lib/social-proof-bubble.test.tsx` (as fixtures da Task 6/7 da v1 precisam dos campos novos)

**Interfaces:**
- Consumes: `resolveSender` (Task 3), `formatDuration` (Task 2), `<ReactionsRow>`, `<AlbumGrid>`, `<AudioBubble>`, `<ReplyPreview>` (Task 7).
- Produces:
  - `<MediaContainer item: MediaItem; hasCaption: boolean />` — assinatura MUDA (era `url`+`type`)
  - `<MessageBubble message: GroupedMessage; channel: FeedChannel />` — ganha `channel`
  - `<MessageGroup message: GroupedMessage; channel: FeedChannel />` — ganha `channel`
  - `<ChannelFeed messages: FeedMessage[]; channel: FeedChannel; now: Date />` — ganha `channel`
  - `<ChannelHeader channel: FeedChannel />` — mesma assinatura, conteúdo novo

> `channel-feed.tsx` está aqui e não na Task 9 de propósito. `MessageGroup` passa a exigir
> `channel`, e quem o renderiza é o `ChannelFeed` — deixar a prop para depois faria esta task não
> compilar, e os testes do Step 2 renderizam `<ChannelFeed channel={...}>`.

- [ ] **Step 1: Atualizar as fixtures do teste existente**

`tests/lib/social-proof-bubble.test.tsx` monta `FeedMessage` com o formato antigo e vai quebrar. Substituir o helper `fm` por:

```tsx
function fm(id: string, senderName: string, offsetSeconds: number, extra: Partial<FeedMessage> = {}): FeedMessage {
  return {
    id,
    senderKind: "member",
    senderName,
    senderAvatarUrl: null,
    kind: "text",
    contentText: `texto ${id}`,
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds,
    displayTime: null,
    viewsCount: 0,
    ...extra,
  };
}
```

E o `canalFake` que os testes de `ChannelFeed` passarão agora:

```tsx
const canalFake: FeedChannel = {
  title: "canal",
  avatarUrl: null,
  subscribersLabel: "10 inscritos",
  isVerified: false,
  ownerName: "Dona",
  ownerAvatarUrl: null,
  ownerUsername: "dona",
  unreadBadge: 0,
};
```

O teste "renderiza mídia quando a mensagem tem" passa a usar `media: [{ url: "https://exemplo.test/f.jpg", type: "photo" }]` no lugar de `mediaUrl`/`mediaType`. Acrescentar `import type { FeedChannel } from "@/lib/social-proof/types";` no topo, e passar `channel={canalFake}` em cada `<ChannelFeed>`.

- [ ] **Step 2: Acrescentar os testes do comportamento novo**

Ao final de `tests/lib/social-proof-bubble.test.tsx`:

```tsx
describe("ChannelFeed — remetente e conteúdo v2", () => {
  it("mensagem da dona usa a identidade do canal e ganha o selo", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "ignorado", 600, { senderKind: "owner" })]}
        channel={{ ...canalFake, ownerName: "Daniel" }}
        now={agora}
      />,
    );
    expect(screen.getByText("Daniel")).toBeInTheDocument();
    expect(screen.getByText("Dona do canal")).toBeInTheDocument();
  });

  it("mensagem de membro não ganha selo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600)]} channel={canalFake} now={agora} />);
    expect(screen.queryByText("Dona do canal")).not.toBeInTheDocument();
  });

  it("renderiza a grade quando há duas ou mais mídias", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            kind: "album",
            media: [
              { url: "1.jpg", type: "photo" },
              { url: "2.jpg", type: "photo" },
            ],
          }),
        ]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-album")).toBeTruthy();
  });

  it("renderiza a bolha de áudio", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            kind: "audio",
            contentText: null,
            media: [{ url: "a.mp3", type: "audio", durationSeconds: 30 }],
          }),
        ]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-audio")).toBeTruthy();
    expect(screen.getByText("0:30")).toBeInTheDocument();
  });

  it("renderiza as reações", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { reactions: [{ emoji: "❤️", count: 24 }] })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("renderiza a citação da resposta", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { replyToSender: "Bia", replyToText: "original" })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("original")).toBeInTheDocument();
  });

  it("displayTime sobrepõe o horário calculado do offset", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { displayTime: "02:44" })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("02:44")).toBeInTheDocument();
    expect(screen.queryByText("14:50")).not.toBeInTheDocument();
  });
});

describe("ChannelHeader", () => {
  it("mostra o badge de não lidas quando maior que zero", () => {
    render(<ChannelHeader channel={{ ...canalFake, unreadBadge: 243 }} />);
    expect(screen.getByText("243")).toBeInTheDocument();
  });

  it("esconde o badge quando é zero", () => {
    render(<ChannelHeader channel={{ ...canalFake, unreadBadge: 0 }} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
```

Acrescentar `import { ChannelHeader } from "@/components/telegram/channel-header";` no topo.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx`
Expected: FAIL — `channel` não é prop conhecida, `media` não existe em `FeedMessage`, selo ausente.

- [ ] **Step 4: `media-container.tsx` — recebe item e mostra duração**

Substituir o componente inteiro por:

```tsx
/**
 * Uma peça de mídia dentro da bolha.
 *
 * Quando a mensagem tem legenda, os cantos de baixo ficam retos: a mídia
 * encosta no texto, e é assim que o Telegram desenha.
 *
 * Vídeo com duração ganha a sobreposição no canto, como no app real. Sem
 * duração conhecida a sobreposição some — melhor nada que "0:00" mentiroso.
 */
import type { CSSProperties } from "react";
import type { MediaItem } from "@/lib/social-proof/types";
import { formatDuration } from "@/lib/social-proof/media";

export function MediaContainer({
  item,
  hasCaption,
}: {
  item: MediaItem;
  hasCaption: boolean;
}) {
  const radius = hasCaption
    ? "calc(var(--tgc-bubble-radius) - 3px) calc(var(--tgc-bubble-radius) - 3px) 0 0"
    : "calc(var(--tgc-bubble-radius) - 3px)";

  const style: CSSProperties = {
    display: "block",
    width: "100%",
    maxHeight: 420,
    objectFit: "cover",
    borderRadius: radius,
    background: "var(--tgc-veil)",
  };

  if (item.type === "video") {
    return (
      <div style={{ position: "relative" }}>
        <video src={item.url} style={style} controls playsInline preload="metadata" />
        {typeof item.durationSeconds === "number" && (
          <span className="tg-media-duration">{formatDuration(item.durationSeconds)}</span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.url} alt="" loading="lazy" style={style} />
  );
}
```

- [ ] **Step 5: `message-bubble.tsx` — selo, álbum, áudio, resposta, reações**

Substituir o componente inteiro por:

```tsx
import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { MediaContainer } from "@/components/telegram/media-container";
import { AlbumGrid } from "@/components/telegram/album-grid";
import { AudioBubble } from "@/components/telegram/audio-bubble";
import { ReplyPreview } from "@/components/telegram/reply-preview";
import { ReactionsRow } from "@/components/telegram/reactions-row";
import { resolveSender } from "@/lib/social-proof/sender";

/**
 * A bolha. Sempre alinhada à esquerda — o Mini App simula um canal de
 * terceiros, então nunca existe mensagem "própria" do lead.
 *
 * O rabinho aparece só na última mensagem do grupo. O selo "Dona do canal"
 * fica à direita do nome, como no mockup.
 */
export function MessageBubble({
  message,
  channel,
}: {
  message: GroupedMessage;
  channel: FeedChannel;
}) {
  const sender = resolveSender(message, channel);
  const temMidia = message.media.length > 0;
  const ehAlbum = message.media.length > 1;
  const ehAudio = !ehAlbum && message.media[0]?.type === "audio";
  const temTexto = message.contentText !== null && message.contentText.trim() !== "";
  const temResposta = message.replyToText !== null;

  const classes = [
    "tg-bubble",
    message.isLastOfGroup ? "tg-bubble--tail" : "",
    temMidia && !ehAudio && temTexto ? "tg-bubble--media" : "",
    temMidia && !ehAudio && !temTexto ? "tg-bubble--media-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {message.isFirstOfGroup && (
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <SenderName name={sender.name} />
          {sender.badge && <span className="tg-owner-badge">{sender.badge}</span>}
        </div>
      )}

      {temResposta && (
        <ReplyPreview sender={message.replyToSender ?? ""} text={message.replyToText ?? ""} />
      )}

      {ehAlbum && <AlbumGrid media={message.media} />}
      {ehAudio && <AudioBubble item={message.media[0]} seed={message.id} />}
      {temMidia && !ehAlbum && !ehAudio && (
        <MediaContainer item={message.media[0]} hasCaption={temTexto} />
      )}

      {temTexto && (
        <div
          className="tg-bubble-text"
          style={{ whiteSpace: "pre-wrap", marginTop: temMidia ? 6 : 0 }}
        >
          {message.contentText}
          <MessageMeta at={message.at} views={message.viewsCount} override={message.displayTime} />
        </div>
      )}

      {!temTexto && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <MessageMeta at={message.at} views={message.viewsCount} override={message.displayTime} />
        </div>
      )}

      <ReactionsRow reactions={message.reactions} />
    </div>
  );
}
```

- [ ] **Step 6: `message-meta.tsx` — aceitar horário fixo**

Em `components/telegram/message-meta.tsx`, mudar a assinatura e a linha do relógio:

```tsx
export function MessageMeta({
  at,
  views,
  override,
}: {
  at: Date;
  views: number;
  /** "HH:MM" fixo pelo tenant. Quando presente, ignora o cálculo do offset. */
  override?: string | null;
}) {
```

e, na `<span>` final, trocar `{formatClock(at)}` por:

```tsx
      <span>{override && override.trim() !== "" ? override : formatClock(at)}</span>
```

- [ ] **Step 7: `message-group.tsx` — avatar resolvido**

Substituir o componente por:

```tsx
import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { TgAvatar } from "@/components/telegram/avatar";
import { MessageBubble } from "@/components/telegram/message-bubble";
import { resolveSender } from "@/lib/social-proof/sender";

/**
 * Uma linha do feed: slot de avatar + bolha.
 *
 * O avatar sai de resolveSender, não da mensagem: mensagem da dona usa o avatar
 * do canal, e usar sender_avatar_url aqui mostraria o avatar errado.
 */
export function MessageGroup({
  message,
  channel,
}: {
  message: GroupedMessage;
  channel: FeedChannel;
}) {
  const sender = resolveSender(message, channel);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        marginBottom: message.isLastOfGroup ? 8 : 2,
      }}
    >
      <TgAvatar name={sender.name} url={sender.avatarUrl} visible={message.isLastOfGroup} />
      <MessageBubble message={message} channel={channel} />
    </div>
  );
}
```

- [ ] **Step 8: `channel-feed.tsx` — repassar o canal**

`MessageGroup` agora exige `channel`, então quem o renderiza precisa recebê-lo. Mudar a assinatura:

```tsx
export function ChannelFeed({
  messages,
  channel,
  now,
}: {
  messages: FeedMessage[];
  channel: FeedChannel;
  now: Date;
}) {
```

e, dentro do `.map`:

```tsx
            <MessageGroup message={m} channel={channel} />
```

Acrescentar `FeedChannel` ao import de tipos que já existe no topo do arquivo.

- [ ] **Step 9: `channel-header.tsx` — seta de voltar e badge**

No `<header>`, antes do avatar do canal, inserir:

```tsx
      <span
        aria-hidden
        style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--tgc-link)" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {channel.unreadBadge > 0 && (
          <span
            style={{
              background: "var(--tgc-button)",
              color: "var(--tgc-button-text)",
              borderRadius: 12,
              padding: "1px 7px",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {channel.unreadBadge}
          </span>
        )}
      </span>
```

- [ ] **Step 10: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx tests/lib/social-proof-bubble-v2.test.tsx`
Expected: PASS. O primeiro arquivo cresce de 18 para 27 testes.

- [ ] **Step 11: Commit**

```bash
git add components/telegram/media-container.tsx components/telegram/message-bubble.tsx \
        components/telegram/message-meta.tsx components/telegram/message-group.tsx \
        components/telegram/channel-feed.tsx components/telegram/channel-header.tsx \
        tests/lib/social-proof-bubble.test.tsx
git commit -m "feat(prova-social): bolha entende dona, album, audio, resposta e reacoes"
```

---

### Task 8b: Agrupamento entende quem é a dona

> Task acrescentada por ruling do controlador durante a execução. O implementador da Task 8
> notou que `groupMessages` compara `senderName` cru, sem olhar `senderKind` — e nenhuma task do
> plano original cobria isso.

**Files:**
- Modify: `lib/social-proof/grouping.ts`
- Modify: `tests/lib/social-proof-grouping.test.ts`

**Interfaces:**
- Consumes: `FeedMessage`, `SenderKind` de `@/lib/social-proof/types` (Task 1).
- Produces: `groupMessages(messages, now)` com a MESMA assinatura — só a regra interna de
  `sameSender` muda. Nenhum consumidor precisa mudar.

**O problema, concretamente**

Mensagens com `senderKind: "owner"` tiram nome e avatar do CANAL, e o `senderName` da mensagem é
ignorado na renderização (`resolveSender`, Task 3). Mas o agrupamento ainda compara esse campo:

- Duas mensagens seguidas da dona, com `senderName` diferentes (ou vazios de formas diferentes),
  **não agrupam** — cada uma repete avatar e nome. É exatamente o defeito que denuncia clone mal
  feito, documentado na spec da v1.
- Uma mensagem da dona com `senderName: "Ana"` e uma de um membro chamado `"Ana"` **agrupam** —
  um avatar só para dois remetentes que a tela mostra como pessoas diferentes.

- [ ] **Step 1: Corrigir as fixtures do arquivo de teste**

`tests/lib/social-proof-grouping.test.ts` monta `FeedMessage` no formato antigo e é a origem do
único erro de `tsc` que sobrou nesse arquivo. Substituir o helper `msg` por:

```ts
function msg(id: string, senderName: string, offsetSeconds: number): FeedMessage {
  return {
    id,
    senderKind: "member",
    senderName,
    senderAvatarUrl: null,
    kind: "text",
    contentText: `texto ${id}`,
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds,
    displayTime: null,
    viewsCount: 0,
  };
}
```

- [ ] **Step 2: Escrever os testes novos que falham**

Acrescentar ao final de `tests/lib/social-proof-grouping.test.ts`:

```ts
describe("groupMessages — identidade da dona", () => {
  function dona(id: string, senderName: string, offsetSeconds: number): FeedMessage {
    return { ...msg(id, senderName, offsetSeconds), senderKind: "owner" };
  }

  it("duas mensagens seguidas da dona agrupam mesmo com senderName diferente", () => {
    // A dona tira identidade do canal; o senderName da mensagem é ignorado na
    // renderização, então não pode separar grupos.
    const out = groupMessages([dona("a", "", 600), dona("b", "sobra antiga", 580)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, false]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([false, true]);
  });

  it("dona e membro com o MESMO nome não agrupam", () => {
    // Senão um avatar só cobriria dois remetentes que a tela mostra diferentes.
    const out = groupMessages([dona("a", "Ana", 600), msg("b", "Ana", 580)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([true, true]);
  });

  it("membro e dona alternando: cada um é seu próprio grupo", () => {
    const out = groupMessages([msg("a", "Ana", 600), dona("b", "", 580), msg("c", "Ana", 560)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true, true]);
  });

  it("a janela de tempo continua valendo para a dona", () => {
    const out = groupMessages([dona("a", "", 3600), dona("b", "", 3600 - 960)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-grouping.test.ts`
Expected: FAIL nos dois primeiros testes novos — hoje a comparação é só por `senderName`.

- [ ] **Step 4: Implementar**

Em `lib/social-proof/grouping.ts`, substituir `sameSender` por:

```ts
function sameSender(a: FeedMessage, b: FeedMessage): boolean {
  // Remetentes de espécies diferentes nunca agrupam, mesmo com nome igual: a
  // tela os mostra como pessoas distintas (a dona ganha selo e o avatar do
  // canal), e um avatar só cobrindo os dois seria mentira visual.
  if (a.senderKind !== b.senderKind) return false;

  // Mensagens da dona tiram identidade do CANAL — o senderName da mensagem é
  // ignorado na renderização, então não pode separar grupos aqui.
  if (a.senderKind === "owner") return true;

  return a.senderName.trim() === b.senderName.trim();
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-grouping.test.ts`
Expected: PASS. O arquivo cresce de 12 para 16 testes.

Run: `npm test`
Expected: 252 → 256.

- [ ] **Step 6: Commit**

```bash
git add lib/social-proof/grouping.ts tests/lib/social-proof-grouping.test.ts
git commit -m "fix(prova-social): agrupamento separa dona de membro com mesmo nome"
```

---

### Task 9: Leitura do feed e página do Mini App

**Files:**
- Modify: `lib/social-proof/feed.ts`
- Modify: `app/mini/[botId]/page.tsx`

**Interfaces:**
- Consumes: `normalizeMedia` (Task 2); `FeedChannel`/`FeedMessage` v2 (Task 1); `<PinnedBar>` (Task 7); `<ChannelFeed messages channel now />` (Task 8 — a prop `channel` já existe quando esta task roda).
- Produces:
  - `loadFeed(botId): Promise<{ channel: FeedChannel; messages: FeedMessage[]; pinnedText: string } | null>` — o retorno GANHA `pinnedText`

- [ ] **Step 1: `feed.ts` — colunas novas, mídia normalizada, resposta e fixada**

Substituir os dois `select` e o `return` por:

```ts
  const { data: canal } = await supabase
    .from("social_proof_channels")
    .select(
      "id,title,avatar_url,subscribers_label,is_verified,owner_name,owner_avatar_url,owner_username,unread_badge,pinned_message_id",
    )
    .eq("bot_id", botId)
    .eq("is_active", true)
    .single();

  if (!canal) return null;

  const { data: linhas } = await supabase
    .from("social_proof_messages")
    .select(
      "id,sender_kind,sender_name,sender_avatar_url,kind,content_text,media,media_url,media_type,reactions,reply_to_id,display_time,offset_seconds,views_count",
    )
    .eq("channel_id", canal.id)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const brutas = linhas ?? [];

  // A citação da resposta é resolvida aqui, no servidor, contra as mensagens já
  // carregadas. Uma consulta por resposta seria N+1, e o alvo quase sempre está
  // no mesmo feed.
  const porId = new Map(brutas.map((r) => [r.id as string, r]));

  const messages: FeedMessage[] = brutas.map((r) => {
    const alvo = r.reply_to_id ? porId.get(r.reply_to_id as string) : undefined;
    return {
      id: r.id,
      senderKind: r.sender_kind === "owner" ? "owner" : "member",
      senderName: r.sender_name,
      senderAvatarUrl: r.sender_avatar_url,
      kind: r.kind,
      contentText: r.content_text,
      media: normalizeMedia(r.media, r.media_url, r.media_type),
      reactions: Array.isArray(r.reactions) ? r.reactions : [],
      replyToText: alvo ? (alvo.content_text as string | null) : null,
      replyToSender: alvo
        ? alvo.sender_kind === "owner"
          ? canal.owner_name || canal.title
          : (alvo.sender_name as string)
        : null,
      offsetSeconds: r.offset_seconds,
      displayTime: r.display_time,
      viewsCount: r.views_count,
    };
  });

  const fixada = canal.pinned_message_id
    ? (porId.get(canal.pinned_message_id as string)?.content_text as string | null) ?? ""
    : "";

  return {
    channel: {
      title: canal.title,
      avatarUrl: canal.avatar_url,
      subscribersLabel: canal.subscribers_label,
      isVerified: canal.is_verified,
      ownerName: canal.owner_name,
      ownerAvatarUrl: canal.owner_avatar_url,
      ownerUsername: canal.owner_username,
      unreadBadge: canal.unread_badge,
    },
    messages,
    pinnedText: fixada,
  };
```

E acrescentar no topo: `import { normalizeMedia } from "@/lib/social-proof/media";`, mais o tipo de retorno atualizado na assinatura:

```ts
export async function loadFeed(
  botId: string,
): Promise<{ channel: FeedChannel; messages: FeedMessage[]; pinnedText: string } | null> {
```

- [ ] **Step 2: `app/mini/[botId]/page.tsx` — renderizar a fixada**

Acrescentar o import e inserir a barra entre o cabeçalho e o feed:

```tsx
import { PinnedBar } from "@/components/telegram/pinned-bar";
```

```tsx
      <ChannelHeader channel={feed.channel} />
      <PinnedBar text={feed.pinnedText} />
      <ChannelFeed messages={feed.messages} channel={feed.channel} now={now} />
      <ChannelFooter />
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck só com os 6 erros de baseline; testes verdes; build passa com `ƒ /mini/[botId]`.

Restarão erros em `composer.tsx` e `feed-preview.tsx`, que as Tasks 12–14 substituem. **Se o build falhar por causa deles**, é esperado nesta task — anote no relatório e siga; a Task 14 fecha.

- [ ] **Step 4: Commit**

```bash
git add lib/social-proof/feed.ts app/mini/\[botId\]/page.tsx
git commit -m "feat(prova-social): feed carrega dona, midia em lista, resposta e fixada"
```

---

### Task 10: Upload de áudio e o seletor de mídia

**Files:**
- Modify: `lib/actions/upload-actions.ts:35`
- Create: `components/dashboard/social-proof/media-picker.tsx`

**Interfaces:**
- Consumes: `uploadMedia(formData)` de `@/lib/actions/upload-actions`; `MediaItem` de `@/lib/social-proof/types`.
- Produces: `<MediaPicker media: MediaItem[]; kind: MessageKind; onChange: (media: MediaItem[]) => void />`.

- [ ] **Step 1: Aceitar áudio na allowlist**

Em `lib/actions/upload-actions.ts`, no array `allowedTypes`, acrescentar:

```ts
    "audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav",
```

Decisão já tomada: estender a função compartilhada em vez de duplicar. O bot já envia áudio pelo Telegram, e duas funções de upload divergiriam com o tempo.

- [ ] **Step 2: Implementar o seletor**

Criar `components/dashboard/social-proof/media-picker.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { uploadMedia } from "@/lib/actions/upload-actions";
import type { MediaItem, MessageKind } from "@/lib/social-proof/types";

/** Deduz o tipo do item a partir do MIME do arquivo escolhido. */
function tipoDoArquivo(file: File): MediaItem["type"] | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Seletor de mídia com os três caminhos do mockup: arrastar-e-soltar, escolher
 * arquivo, e colar URL.
 *
 * `uploadMedia` LANÇA em erro (é a função compartilhada com as configurações do
 * bot, escrita antes da regra de recusa-como-dado). Por isso o try/catch aqui —
 * sem ele, o erro sobe e a tela quebra em vez de mostrar a mensagem.
 */
export function MediaPicker({
  media,
  kind,
  onChange,
}: {
  media: MediaItem[];
  kind: MessageKind;
  onChange: (media: MediaItem[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [url, setUrl] = useState("");

  const multiplo = kind === "album";

  async function receber(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErro(null);
    setEnviando(true);

    try {
      const novos: MediaItem[] = [];
      for (const file of Array.from(files)) {
        const tipo = tipoDoArquivo(file);
        if (!tipo) {
          setErro(`Tipo não suportado: ${file.type || file.name}`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const { url: enviado } = await uploadMedia(fd);
        novos.push({ url: enviado, type: tipo });
      }
      if (novos.length > 0) onChange(multiplo ? [...media, ...novos] : [novos[0]]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function adicionarUrl() {
    const limpa = url.trim();
    if (limpa === "") return;
    const tipo: MediaItem["type"] =
      kind === "audio" ? "audio" : kind === "video" ? "video" : "photo";
    onChange(multiplo ? [...media, { url: limpa, type: tipo }] : [{ url: limpa, type: tipo }]);
    setUrl("");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {media.map((item, i) => (
          <div key={`${item.url}-${i}`} className="relative">
            {item.type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="h-24 w-32 rounded-lg object-cover" />
            ) : (
              <div className="flex h-24 w-32 items-center justify-center rounded-lg bg-(--bg-input) text-xs text-(--text-muted)">
                {item.type === "video" ? "vídeo" : "áudio"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(media.filter((_, j) => j !== i))}
              className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-(--bg-overlay) text-(--text-primary)"
              aria-label="Remover mídia"
            >
              ×
            </button>
          </div>
        ))}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(true);
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSobre(false);
            void receber(e.dataTransfer.files);
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs ${
            sobre ? "border-(--accent) bg-(--accent-deep)" : "border-(--border-default)"
          }`}
        >
          <span className="text-(--text-muted)">
            {enviando ? "Enviando…" : "Arraste foto ou vídeo aqui"}
          </span>
          <span className="text-(--text-ghost)">ou</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="rounded-md border border-(--border-default) px-3 py-1.5 text-(--text-primary) disabled:opacity-50"
          >
            Escolher arquivo
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple={multiplo}
            accept="image/*,video/*,audio/*"
            onChange={(e) => void receber(e.target.files)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-(--text-muted)">ou usar URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionarUrl();
            }
          }}
          placeholder="https://..."
          className="flex-1 rounded-md bg-(--bg-input) border border-(--border-default) px-2 py-1 text-xs text-(--text-primary) outline-none focus:border-(--accent)"
        />
        <button
          type="button"
          onClick={adicionarUrl}
          className="rounded-md border border-(--border-default) px-2 py-1 text-xs text-(--text-primary)"
        >
          Adicionar
        </button>
      </div>

      {erro && <p className="text-xs text-(--red)">{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo no `media-picker.tsx` nem em `upload-actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/upload-actions.ts components/dashboard/social-proof/media-picker.tsx
git commit -m "feat(prova-social): upload local de midia com arrastar-e-soltar e audio"
```

---

### Task 11: Server Actions v2

**Files:**
- Modify: `lib/actions/social-proof-actions.ts`

**Interfaces:**
- Consumes: `validateMessage` (Task 4); `ChannelInput`/`MessageInput` v2 (Task 1); `nextPosition` (já existe).
- Produces, além das quatro atuais:
  - `duplicateMessage(messageId: string, botId: string): Promise<ActionResult>`
  - `setPinnedMessage(botId: string, messageId: string | null): Promise<ActionResult>`
  - `reorderMessages(botId: string, orderedIds: string[]): Promise<ActionResult>`

- [ ] **Step 1: `saveChannel` grava os campos da dona**

No objeto do `upsert`, os campos novos já entram via spread de `input` porque `ChannelInput` cresceu. Acrescentar apenas a validação, logo depois da checagem de título:

```ts
  if (input.unread_badge < 0) {
    return { ok: false, error: "O contador de não lidas não pode ser negativo." };
  }
```

- [ ] **Step 2: `saveMessage` usa a validação central e os campos novos**

Substituir o bloco de validações inline pela chamada única, e o `row` pelos campos novos:

```ts
  const valido = validateMessage(input);
  if (!valido.ok) return valido;

  const tenantId = await tenantDoBot(botId);
  if (!tenantId) return { ok: false, error: "Bot não encontrado." };

  const supabase = await createClient();
  const { data: channel } = await supabase
    .from("social_proof_channels")
    .select("id")
    .eq("bot_id", botId)
    .maybeSingle();

  if (!channel) return { ok: false, error: "Salve os dados do canal antes de criar mensagens." };

  const row = {
    tenant_id: tenantId,
    bot_id: botId,
    channel_id: (channel as { id: string }).id,
    sender_kind: input.sender_kind,
    sender_name: input.sender_name,
    sender_avatar_url: input.sender_avatar_url,
    kind: input.kind,
    content_text: (input.content_text ?? "").trim() === "" ? null : input.content_text,
    media: input.media,
    reactions: input.reactions,
    reply_to_id: input.reply_to_id,
    display_time: input.display_time,
    offset_seconds: input.offset_seconds,
    views_count: input.views_count,
    is_active: true,
  };
```

Acrescentar no topo: `import { validateMessage } from "@/lib/social-proof/validate-message";`

O restante da função (insert com `nextPosition`, update com `.eq("bot_id", botId).select("id")` e a checagem de linhas afetadas) fica como está.

- [ ] **Step 3: `duplicateMessage`**

Acrescentar ao final do arquivo:

```ts
/**
 * Copia uma mensagem para o fim do feed.
 *
 * Lê a linha com o client sob RLS — se o tenant não puder ver, não pode
 * duplicar, e a checagem sai de graça. A cópia nasce com position nova e SEM
 * herdar reply_to_id: uma resposta duplicada apontaria para a mesma citação em
 * dois lugares do feed, o que não acontece num canal real.
 */
export async function duplicateMessage(messageId: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: origem } = await supabase
    .from("social_proof_messages")
    .select(
      "tenant_id,bot_id,channel_id,sender_kind,sender_name,sender_avatar_url,kind,content_text,media,reactions,display_time,offset_seconds,views_count",
    )
    .eq("id", messageId)
    .eq("bot_id", botId)
    .maybeSingle();

  if (!origem) {
    return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão)." };
  }

  const { error } = await supabase.from("social_proof_messages").insert({
    ...origem,
    reply_to_id: null,
    is_active: true,
    position: await proximaPosicao(origem.channel_id as string),
  });

  if (error) return { ok: false, error: `Não deu pra duplicar: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
```

- [ ] **Step 4: `setPinnedMessage`**

```ts
/**
 * Fixa uma mensagem no topo do canal, ou desafixa com `null`.
 *
 * O `.eq("bot_id", botId)` na leitura impede fixar mensagem de outro bot mesmo
 * que o id vaze — a RLS cobriria, mas Server Action é invocável direto e a
 * defesa em profundidade custa uma linha.
 */
export async function setPinnedMessage(
  botId: string,
  messageId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();

  if (messageId !== null) {
    const { data: alvo } = await supabase
      .from("social_proof_messages")
      .select("id")
      .eq("id", messageId)
      .eq("bot_id", botId)
      .maybeSingle();

    if (!alvo) {
      return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão)." };
    }
  }

  const { data, error } = await supabase
    .from("social_proof_channels")
    .update({ pinned_message_id: messageId })
    .eq("bot_id", botId)
    .select("id");

  if (error) return { ok: false, error: `Não deu pra fixar: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, error: "Canal não encontrado (ou sem permissão)." };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
```

- [ ] **Step 5: `reorderMessages`**

```ts
/**
 * Grava a ordem nova depois de arrastar-e-soltar.
 *
 * As posições são reescritas como 1..N em vez de trocar duas: depois de vários
 * arrastes as posições ficam com buracos, e renumerar mantém a lista estável e
 * previsível. Cada update leva `.eq("bot_id", botId)` — a lista de ids vem do
 * cliente e não pode ser confiada sozinha.
 */
export async function reorderMessages(
  botId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const supabase = await createClient();

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("social_proof_messages")
      .update({ position: i + 1 })
      .eq("id", orderedIds[i])
      .eq("bot_id", botId);

    if (error) return { ok: false, error: `Não deu pra reordenar: ${error.message}` };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: sem erro novo em `social-proof-actions.ts`; testes verdes.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/social-proof-actions.ts
git commit -m "feat(prova-social): actions de duplicar, fixar e reordenar"
```

---

### Task 12: Coluna esquerda

**Files:**
- Create: `components/dashboard/social-proof/channel-card.tsx`
- Create: `components/dashboard/social-proof/owner-card.tsx`
- Create: `components/dashboard/social-proof/message-list.tsx`

**Interfaces:**
- Consumes: `ChannelInput`, `SocialProofMessage`, `moveItem` (Task 5), `MediaPicker` (Task 10).
- Produces:
  - `<ChannelCard value: ChannelInput; onChange: (v: ChannelInput) => void />`
  - `<OwnerCard value: ChannelInput; onChange: (v: ChannelInput) => void />`
  - `<MessageList messages; selectedId; pinnedId; onSelect; onReorder; onDuplicate; onPin; onDelete; onNew />`

Todos `"use client"`. Usam os tokens do dashboard — são tela de console, não Mini App.

- [ ] **Step 1: `channel-card.tsx`**

```tsx
"use client";

import type { ChannelInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/** Interruptor. Substitui checkbox pra bater com o mockup e ficar legível no escuro. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-(--text-secondary)">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-(--accent)" : "bg-(--bg-hover)"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function ChannelCard({
  value,
  onChange,
}: {
  value: ChannelInput;
  onChange: (v: ChannelInput) => void;
}) {
  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Canal</h2>

      <div className="flex items-center gap-3">
        {value.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--accent-muted) text-lg text-(--text-primary)">
            {value.title.trim().charAt(0).toUpperCase() || "#"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-(--text-primary)">
            {value.title || "Nome do canal"}
          </p>
          <p className="truncate text-sm text-(--text-muted)">
            {value.subscribers_label || "0 inscritos"}
          </p>
        </div>
      </div>

      <input
        className={CAMPO}
        placeholder="Nome do canal"
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
      <input
        className={CAMPO}
        placeholder="URL do avatar do canal"
        value={value.avatar_url ?? ""}
        onChange={(e) => onChange({ ...value, avatar_url: e.target.value || null })}
      />
      <input
        className={CAMPO}
        placeholder="Linha de inscritos (ex.: 52 321 inscritos)"
        value={value.subscribers_label}
        onChange={(e) => onChange({ ...value, subscribers_label: e.target.value })}
      />
      <input
        className={CAMPO}
        type="number"
        min={0}
        placeholder="Badge de não lidas"
        value={value.unread_badge}
        onChange={(e) =>
          onChange({ ...value, unread_badge: Math.max(0, Number(e.target.value) || 0) })
        }
      />

      <Toggle
        label="Selo de verificação"
        checked={value.is_verified}
        onChange={(v) => onChange({ ...value, is_verified: v })}
      />
      <Toggle
        label="Ativo no Mini App"
        checked={value.is_active}
        onChange={(v) => onChange({ ...value, is_active: v })}
      />

      {!value.is_active && (
        <p className="rounded-md bg-(--amber-muted) px-3 py-2 text-xs text-(--amber)">
          Enquanto isto estiver desligado, o lead que abrir o Mini App verá uma
          página de erro.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: `owner-card.tsx`**

```tsx
"use client";

import type { ChannelInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/**
 * Identidade da dona — separada do canal de propósito: no mockup o canal tem
 * avatar de lobo e a dona tem o próprio. Mensagens marcadas como "Dona do
 * canal" usam estes campos, não os da mensagem.
 */
export function OwnerCard({
  value,
  onChange,
}: {
  value: ChannelInput;
  onChange: (v: ChannelInput) => void;
}) {
  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
        Identidade da dona
      </h2>

      <div className="flex items-center gap-3">
        {value.owner_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.owner_avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--purple-muted) text-lg text-(--text-primary)">
            {value.owner_name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-(--text-primary)">
            {value.owner_name || "Nome da dona"}
          </p>
          <p className="truncate text-sm text-(--text-muted)">
            @{value.owner_username || "usuario"}
          </p>
        </div>
      </div>

      <input
        className={CAMPO}
        placeholder="Nome da dona"
        value={value.owner_name}
        onChange={(e) => onChange({ ...value, owner_name: e.target.value })}
      />
      <input
        className={CAMPO}
        placeholder="@usuario"
        value={value.owner_username}
        onChange={(e) => onChange({ ...value, owner_username: e.target.value.replace(/^@/, "") })}
      />
      <input
        className={CAMPO}
        placeholder="URL do avatar da dona"
        value={value.owner_avatar_url ?? ""}
        onChange={(e) => onChange({ ...value, owner_avatar_url: e.target.value || null })}
      />
    </section>
  );
}
```

- [ ] **Step 3: `message-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { SocialProofMessage } from "@/lib/types/database";
import { moveItem } from "@/lib/social-proof/reorder";

const ROTULO_TIPO: Record<string, string> = {
  text: "Texto",
  photo: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  album: "Álbum",
};

/**
 * Lista reordenável do feed.
 *
 * Arrastar usa eventos nativos de HTML5, sem dependência nova: a lista é curta
 * e o gesto é simples o bastante pra não justificar uma biblioteca.
 */
export function MessageList({
  messages,
  selectedId,
  pinnedId,
  onSelect,
  onReorder,
  onDuplicate,
  onPin,
  onDelete,
  onNew,
}: {
  messages: SocialProofMessage[];
  selectedId: string | null;
  pinnedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDuplicate: (id: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  function soltar(destino: number) {
    if (arrastando === null) return;
    const nova = moveItem(messages, arrastando, destino);
    setArrastando(null);
    onReorder(nova.map((m) => m.id));
  }

  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
          Mensagens
        </h2>
        <span className="text-xs text-(--text-ghost)">Arraste para reordenar</span>
      </div>

      {messages.length === 0 && (
        <p className="py-4 text-center text-sm text-(--text-muted)">Nenhuma mensagem ainda.</p>
      )}

      {messages.map((m, i) => (
        <div
          key={m.id}
          draggable
          onDragStart={() => setArrastando(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => soltar(i)}
          onClick={() => onSelect(m.id)}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${
            selectedId === m.id
              ? "border-(--accent) bg-(--accent-deep)"
              : "border-(--border-subtle) hover:bg-(--bg-hover)"
          }`}
        >
          <span className="w-4 text-center text-xs text-(--text-ghost)">{i + 1}</span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-(--text-primary)">
              {m.sender_kind === "owner" ? "Dona" : m.sender_name || "Membro"}
              <span className="text-(--text-muted)"> · {ROTULO_TIPO[m.kind] ?? m.kind}</span>
              {pinnedId === m.id && <span className="ml-2 text-xs text-(--amber)">fixada</span>}
            </p>
            <p className="text-xs text-(--text-muted)">
              há {Math.round(m.offset_seconds / 60)} min
            </p>
          </div>

          <span className="text-xs text-(--text-muted)">{m.views_count}</span>

          {/* Menu da linha. As mesmas ações existem no editor, mas agir direto
              na linha — sem precisar selecionar antes — é o caminho rápido, e
              é o que o mockup mostra. */}
          <div className="relative">
            <button
              type="button"
              aria-label="Ações da mensagem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuAberto(menuAberto === m.id ? null : m.id);
              }}
              className="px-1 text-(--text-muted) hover:text-(--text-primary)"
            >
              ⋮
            </button>

            {menuAberto === m.id && (
              <div
                className="absolute right-0 top-6 z-10 w-36 overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-overlay)"
                onClick={(e) => e.stopPropagation()}
              >
                {(
                  [
                    { rotulo: "Duplicar", acao: () => onDuplicate(m.id), perigo: false },
                    {
                      rotulo: pinnedId === m.id ? "Desafixar" : "Fixar",
                      acao: () => onPin(m.id),
                      perigo: false,
                    },
                    { rotulo: "Excluir", acao: () => onDelete(m.id), perigo: true },
                  ] as const
                ).map((op) => (
                  <button
                    key={op.rotulo}
                    type="button"
                    onClick={() => {
                      setMenuAberto(null);
                      op.acao();
                    }}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-(--bg-hover) ${
                      op.perigo ? "text-(--red)" : "text-(--text-secondary)"
                    }`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={onNew}
        className="w-full rounded-lg border border-dashed border-(--border-default) py-2 text-sm text-(--text-secondary) hover:border-(--accent) hover:text-(--text-primary)"
      >
        + Nova mensagem
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erro novo nos três arquivos.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/social-proof/channel-card.tsx \
        components/dashboard/social-proof/owner-card.tsx \
        components/dashboard/social-proof/message-list.tsx
git commit -m "feat(prova-social): coluna esquerda — canal, dona e lista reordenavel"
```

---

### Task 13: Editor da mensagem (coluna direita)

**Files:**
- Create: `components/dashboard/social-proof/message-editor.tsx`

**Interfaces:**
- Consumes: `MessageInput`, `MessageKind`, `SenderKind`, `Reaction` (Task 1); `<MediaPicker>` (Task 10).
- Produces: `<MessageEditor value; index; onChange; onSave; onDuplicate; onReply; onPin; onDelete; saving; error />`

- [ ] **Step 1: Implementar**

Criar `components/dashboard/social-proof/message-editor.tsx`:

```tsx
"use client";

import type { MessageInput, MessageKind, Reaction, SenderKind } from "@/lib/social-proof/types";
import { MediaPicker } from "@/components/dashboard/social-proof/media-picker";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

const TIPOS: { kind: MessageKind; label: string }[] = [
  { kind: "text", label: "Texto" },
  { kind: "photo", label: "Foto" },
  { kind: "video", label: "Vídeo" },
  { kind: "audio", label: "Áudio" },
  { kind: "album", label: "Álbum" },
];

/** Paleta fixa. Um seletor completo de emoji é uma dependência inteira pra um
 *  caso em que sete opções cobrem quase tudo. */
const EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "🙏", "💎"];

const MAX_TEXTO = 1024;

export function MessageEditor({
  value,
  index,
  onChange,
  onSave,
  onDuplicate,
  onReply,
  onPin,
  onDelete,
  saving,
  error,
}: {
  value: MessageInput;
  index: number;
  onChange: (v: MessageInput) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onReply: () => void;
  onPin: () => void;
  onDelete: () => void;
  saving: boolean;
  error: string | null;
}) {
  function setReacao(emoji: string, delta: number) {
    const atual = value.reactions.find((r) => r.emoji === emoji);
    let novas: Reaction[];
    if (atual) {
      const count = Math.max(0, atual.count + delta);
      novas =
        count === 0
          ? value.reactions.filter((r) => r.emoji !== emoji)
          : value.reactions.map((r) => (r.emoji === emoji ? { ...r, count } : r));
    } else {
      novas = [...value.reactions, { emoji, count: 1 }];
    }
    onChange({ ...value, reactions: novas });
  }

  return (
    <aside className="flex flex-col gap-5 rounded-xl border border-(--border-subtle) p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--text-primary)">
          Editando mensagem #{index + 1}
        </h2>
        <button type="button" onClick={onDelete} className="text-(--red)" aria-label="Excluir">
          🗑
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {error}
        </p>
      )}

      {/* Enviar como — dois cartões, nunca um select */}
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Enviar como</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { kind: "owner" as SenderKind, titulo: "Dona do canal", sub: "Aparece como a dona" },
            { kind: "member" as SenderKind, titulo: "Membro", sub: "Aparece como membro" },
          ]).map((op) => (
            <button
              key={op.kind}
              type="button"
              onClick={() => onChange({ ...value, sender_kind: op.kind })}
              className={`rounded-lg border p-3 text-left ${
                value.sender_kind === op.kind
                  ? "border-(--accent) bg-(--accent-deep)"
                  : "border-(--border-default) hover:bg-(--bg-hover)"
              }`}
            >
              <p className="text-sm font-medium text-(--text-primary)">{op.titulo}</p>
              <p className="text-xs text-(--text-muted)">{op.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {value.sender_kind === "member" && (
        <div className="space-y-2">
          <input
            className={CAMPO}
            placeholder="Nome do remetente"
            value={value.sender_name}
            onChange={(e) => onChange({ ...value, sender_name: e.target.value })}
          />
          <input
            className={CAMPO}
            placeholder="URL do avatar do remetente"
            value={value.sender_avatar_url ?? ""}
            onChange={(e) => onChange({ ...value, sender_avatar_url: e.target.value || null })}
          />
        </div>
      )}

      {/* Tipo — botões segmentados, nunca um select */}
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Tipo de mensagem</p>
        <div className="grid grid-cols-5 gap-1 rounded-lg border border-(--border-default) p-1">
          {TIPOS.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => onChange({ ...value, kind: t.kind })}
              className={`rounded-md py-1.5 text-xs ${
                value.kind === t.kind
                  ? "bg-(--accent) text-(--on-accent)"
                  : "text-(--text-secondary) hover:bg-(--bg-hover)"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-(--text-muted)">Conteúdo</p>
        <textarea
          className={CAMPO}
          rows={4}
          maxLength={MAX_TEXTO}
          value={value.content_text ?? ""}
          onChange={(e) => onChange({ ...value, content_text: e.target.value })}
        />
        <p className="text-right text-xs text-(--text-ghost)">
          {(value.content_text ?? "").length}/{MAX_TEXTO}
        </p>
      </div>

      {value.kind !== "text" && (
        <div className="space-y-2">
          <p className="text-xs text-(--text-muted)">Mídia</p>
          <MediaPicker
            media={value.media}
            kind={value.kind}
            onChange={(media) => onChange({ ...value, media })}
          />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Metadados</p>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-(--text-ghost)">
            Visualizações
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={value.views_count}
              onChange={(e) =>
                onChange({ ...value, views_count: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="text-xs text-(--text-ghost)">
            Há quantos minutos
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={Math.round(value.offset_seconds / 60)}
              onChange={(e) =>
                onChange({
                  ...value,
                  offset_seconds: Math.max(0, Number(e.target.value) || 0) * 60,
                })
              }
            />
          </label>
          <label className="text-xs text-(--text-ghost)">
            Horário (opcional)
            <input
              className={CAMPO}
              placeholder="02:44"
              value={value.display_time ?? ""}
              onChange={(e) => onChange({ ...value, display_time: e.target.value || null })}
            />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Reações (opcional)</p>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((emoji) => {
            const atual = value.reactions.find((r) => r.emoji === emoji);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => setReacao(emoji, 1)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setReacao(emoji, -1);
                }}
                title="Clique para somar, botão direito para subtrair"
                className={`rounded-full border px-3 py-1 text-sm ${
                  atual
                    ? "border-(--accent) bg-(--accent-deep) text-(--text-primary)"
                    : "border-(--border-default) text-(--text-secondary)"
                }`}
              >
                {emoji} {atual?.count ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-(--border-subtle) pt-4">
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Duplicar
        </button>
        <button
          type="button"
          onClick={onReply}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Responder
        </button>
        <button
          type="button"
          onClick={onPin}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Fixar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-(--red) py-2 text-sm text-(--red)"
        >
          Excluir
        </button>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-(--accent) py-2.5 text-sm font-medium text-(--on-accent) disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar mensagem"}
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erro novo.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/social-proof/message-editor.tsx
git commit -m "feat(prova-social): editor de mensagem com botoes segmentados e reacoes"
```

---

### Task 14: As três colunas

**Files:**
- Create: `components/dashboard/social-proof/composer-shell.tsx`
- Create: `components/dashboard/social-proof/quick-compose.tsx`
- Modify: `components/dashboard/social-proof/feed-preview.tsx`
- Modify: `components/dashboard/social-proof/composer.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 10–13; `<ChannelFeed>`, `<ChannelHeader>`, `<ChannelFooter>`, `<ChatBackdrop>`, `<PinnedBar>`.
- Produces: `<SocialProofComposer botId channel messages />` — mesma assinatura de hoje, para a página da aba não mudar.

- [ ] **Step 1: `quick-compose.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { SenderKind } from "@/lib/social-proof/types";

/**
 * Barra de composição rápida sob a prévia: cria mensagem de texto sem abrir o
 * editor. É o caminho de quem só quer despejar várias falas em sequência.
 */
export function QuickCompose({
  senderKind,
  onSenderKindChange,
  onSend,
  disabled,
}: {
  senderKind: SenderKind;
  onSenderKindChange: (k: SenderKind) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [texto, setTexto] = useState("");

  function enviar() {
    const limpo = texto.trim();
    if (limpo === "") return;
    onSend(limpo);
    setTexto("");
  }

  return (
    <div className="mt-3 rounded-xl border border-(--border-subtle) p-3">
      <div className="flex items-center gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder="Digite sua mensagem..."
          className="flex-1 rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)"
        />

        {/* Segmentado, nunca select */}
        <div className="flex rounded-lg border border-(--border-default) p-0.5">
          {(["owner", "member"] as SenderKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSenderKindChange(k)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                senderKind === k
                  ? "bg-(--accent) text-(--on-accent)"
                  : "text-(--text-secondary)"
              }`}
            >
              {k === "owner" ? "Dona" : "Membro"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={enviar}
          disabled={disabled}
          className="rounded-lg bg-(--accent) px-3 py-2 text-sm text-(--on-accent) disabled:opacity-50"
          aria-label="Enviar"
        >
          ➤
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-(--text-ghost)">
        Dica: selecione ou crie uma mensagem para editar seus detalhes.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: `feed-preview.tsx` — modelo v2**

Substituir `toFeedMessage`, `draftToFeedMessage` e o corpo para o modelo novo:

```tsx
function toFeedMessage(m: SocialProofMessage): FeedMessage {
  return {
    id: m.id,
    senderKind: m.sender_kind === "owner" ? "owner" : "member",
    senderName: m.sender_name,
    senderAvatarUrl: m.sender_avatar_url,
    kind: m.kind as FeedMessage["kind"],
    contentText: m.content_text,
    media: normalizeMedia(m.media, m.media_url, m.media_type),
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds: m.offset_seconds,
    displayTime: m.display_time,
    viewsCount: m.views_count,
  };
}

function draftToFeedMessage(d: MessageInput): FeedMessage | null {
  const temTexto = (d.content_text ?? "").trim() !== "";
  const temMidia = d.media.length > 0;
  if (!temTexto && !temMidia) return null;

  return {
    id: "__rascunho__",
    senderKind: d.sender_kind,
    senderName: d.sender_name || "Sem nome",
    senderAvatarUrl: d.sender_avatar_url,
    kind: d.kind,
    contentText: temTexto ? d.content_text : null,
    media: d.media,
    reactions: d.reactions,
    replyToText: null,
    replyToSender: null,
    offsetSeconds: d.offset_seconds,
    displayTime: d.display_time,
    viewsCount: d.views_count,
  };
}
```

E o corpo do componente passa a receber e repassar o canal completo:

```tsx
export function FeedPreview({
  channel,
  messages,
  draft,
  pinnedText,
}: {
  channel: ChannelInput;
  messages: SocialProofMessage[];
  draft: MessageInput | null;
  pinnedText: string;
}) {
  const rascunho = draft ? draftToFeedMessage(draft) : null;
  const lista = [...messages.map(toFeedMessage), ...(rascunho ? [rascunho] : [])];

  const feedChannel: FeedChannel = {
    title: channel.title || "Nome do canal",
    avatarUrl: channel.avatar_url,
    subscribersLabel: channel.subscribers_label || "0 inscritos",
    isVerified: channel.is_verified,
    ownerName: channel.owner_name,
    ownerAvatarUrl: channel.owner_avatar_url,
    ownerUsername: channel.owner_username,
    unreadBadge: channel.unread_badge,
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-(--text-secondary)">
        {channel.is_active
          ? "Prévia — é exatamente isto que o lead vê"
          : "Prévia — o canal está INATIVO; o lead verá uma página de erro"}
      </h2>

      <div
        className="tg-app overflow-hidden rounded-[28px] border-4 border-(--border-default)"
        style={{ height: 620, maxWidth: 380, position: "relative" }}
      >
        <ChatBackdrop />
        <ChannelHeader channel={feedChannel} />
        <PinnedBar text={pinnedText} />
        <ChannelFeed messages={lista} channel={feedChannel} now={new Date()} />
        <ChannelFooter />
      </div>
    </section>
  );
}
```

Imports novos: `normalizeMedia` de `@/lib/social-proof/media`, `PinnedBar` de `@/components/telegram/pinned-bar`, e `FeedChannel` no import de tipos.

- [ ] **Step 3: `composer-shell.tsx` — as três colunas e o estado**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput, SenderKind } from "@/lib/social-proof/types";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
  duplicateMessage,
  setPinnedMessage,
  reorderMessages,
} from "@/lib/actions/social-proof-actions";
import { ChannelCard } from "@/components/dashboard/social-proof/channel-card";
import { OwnerCard } from "@/components/dashboard/social-proof/owner-card";
import { MessageList } from "@/components/dashboard/social-proof/message-list";
import { MessageEditor } from "@/components/dashboard/social-proof/message-editor";
import { QuickCompose } from "@/components/dashboard/social-proof/quick-compose";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";

function mensagemVazia(kind: SenderKind = "member"): MessageInput {
  return {
    sender_kind: kind,
    sender_name: "",
    sender_avatar_url: null,
    kind: "text",
    content_text: "",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 600,
    views_count: 0,
  };
}

function paraInput(m: SocialProofMessage): MessageInput {
  return {
    id: m.id,
    sender_kind: m.sender_kind === "owner" ? "owner" : "member",
    sender_name: m.sender_name,
    sender_avatar_url: m.sender_avatar_url,
    kind: m.kind as MessageInput["kind"],
    content_text: m.content_text,
    media: Array.isArray(m.media) ? m.media : [],
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    reply_to_id: m.reply_to_id,
    display_time: m.display_time,
    offset_seconds: m.offset_seconds,
    views_count: m.views_count,
  };
}

export function ComposerShell({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  const [pending, start] = useTransition();
  // Dois estados de erro em vez de um: falha ao salvar o canal aparece no
  // banner do topo, falha ao salvar a mensagem aparece no editor — perto do
  // botão que a causou. Um banner só empurraria o erro pra longe da ação.
  const [erroCanal, setErroCanal] = useState<string | null>(null);
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<MessageInput | null>(null);
  const [senderRapido, setSenderRapido] = useState<SenderKind>("owner");

  const [canal, setCanal] = useState<ChannelInput>({
    title: channel?.title ?? "",
    avatar_url: channel?.avatar_url ?? null,
    subscribers_label: channel?.subscribers_label ?? "",
    is_verified: channel?.is_verified ?? false,
    is_active: channel?.is_active ?? false,
    owner_name: channel?.owner_name ?? "",
    owner_avatar_url: channel?.owner_avatar_url ?? null,
    owner_username: channel?.owner_username ?? "",
    unread_badge: channel?.unread_badge ?? 0,
  });

  const pinnedId = channel?.pinned_message_id ?? null;
  const pinnedText = messages.find((m) => m.id === pinnedId)?.content_text ?? "";
  const indice = selecionada ? messages.findIndex((m) => m.id === selecionada) : -1;

  /**
   * Roda uma action e mostra o erro dela sem lançar.
   * `onde` escolhe qual superfície recebe a mensagem.
   */
  function correr(
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onde: "canal" | "mensagem",
  ) {
    const setar = onde === "canal" ? setErroCanal : setErroMensagem;
    setar(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setar(r.error);
    });
  }

  function selecionar(id: string) {
    const alvo = messages.find((m) => m.id === id);
    if (!alvo) return;
    setSelecionada(id);
    setRascunho(paraInput(alvo));
  }

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-(--text-primary)">Prova Social</h1>
          <p className="text-sm text-(--text-muted)">
            Monte a prévia do canal que aparecerá no seu Mini App.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/mini/${botId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-(--border-default) px-3 py-2 text-sm text-(--text-secondary)"
          >
            Visualizar Mini App
          </a>
          <button
            type="button"
            onClick={() => correr(() => saveChannel(botId, canal), "canal")}
            disabled={pending}
            className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </header>

      {erroCanal && (
        <p className="mb-4 rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {erroCanal}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <ChannelCard value={canal} onChange={setCanal} />
          <OwnerCard value={canal} onChange={setCanal} />
          <MessageList
            messages={messages}
            selectedId={selecionada}
            pinnedId={pinnedId}
            onSelect={selecionar}
            onReorder={(ids) => correr(() => reorderMessages(botId, ids), "mensagem")}
            onDuplicate={(id) => correr(() => duplicateMessage(id, botId), "mensagem")}
            // Fixar a que já está fixada desafixa — é o par natural do rótulo
            // "Desafixar" que a lista mostra nesse caso.
            onPin={(id) =>
              correr(() => setPinnedMessage(botId, pinnedId === id ? null : id), "mensagem")
            }
            onDelete={(id) => {
              correr(() => deleteMessage(id, botId), "mensagem");
              if (selecionada === id) {
                setSelecionada(null);
                setRascunho(null);
              }
            }}
            onNew={() => {
              setSelecionada(null);
              setErroMensagem(null);
              setRascunho(mensagemVazia());
            }}
          />
        </div>

        <div className="flex flex-col items-center">
          <FeedPreview
            channel={canal}
            messages={messages}
            draft={rascunho}
            pinnedText={pinnedText}
          />
          <QuickCompose
            senderKind={senderRapido}
            onSenderKindChange={setSenderRapido}
            disabled={pending}
            onSend={(text) =>
              correr(
                () => saveMessage(botId, { ...mensagemVazia(senderRapido), content_text: text }),
                "mensagem",
              )
            }
          />
        </div>

        {rascunho ? (
          <MessageEditor
            value={rascunho}
            index={indice >= 0 ? indice : messages.length}
            onChange={setRascunho}
            saving={pending}
            error={erroMensagem}
            onSave={() => correr(() => saveMessage(botId, rascunho), "mensagem")}
            onDuplicate={() => {
              if (selecionada) correr(() => duplicateMessage(selecionada, botId), "mensagem");
            }}
            onReply={() => setRascunho({ ...mensagemVazia(), reply_to_id: selecionada })}
            onPin={() => {
              if (selecionada) {
                correr(
                  () => setPinnedMessage(botId, pinnedId === selecionada ? null : selecionada),
                  "mensagem",
                );
              }
            }}
            onDelete={() => {
              if (!selecionada) {
                setRascunho(null);
                return;
              }
              correr(() => deleteMessage(selecionada, botId), "mensagem");
              setSelecionada(null);
              setRascunho(null);
            }}
          />
        ) : (
          <aside className="flex items-center justify-center rounded-xl border border-dashed border-(--border-subtle) p-8 text-center text-sm text-(--text-muted)">
            Selecione ou crie uma mensagem para editar seus detalhes.
          </aside>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `composer.tsx` vira casca fina**

Substituir o arquivo inteiro por:

```tsx
"use client";

import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import { ComposerShell } from "@/components/dashboard/social-proof/composer-shell";

/**
 * Mantido como ponto de entrada para a página da aba não precisar mudar.
 * Toda a lógica vive em ComposerShell.
 */
export function SocialProofComposer(props: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  return <ComposerShell {...props} />;
}
```

- [ ] **Step 5: Verificar tudo**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck com exatamente os 6 erros de baseline; testes verdes; build passa.

Run: `cd server && npx tsc --noEmit && cd ..`
Expected: 0 erros.

- [ ] **Step 6: Verificar no navegador**

Run: `npm run dev`, abrir `/dashboard/bots/<BOT_ID>/prova-social`

Conferir:
1. Três colunas, com a prévia no centro.
2. **Nenhum campo branco ilegível** — não existe `<select>` na tela.
3. Alternar "Dona do canal" e "Membro" muda o remetente na prévia na hora, e a mensagem da dona ganha o selo.
4. Arrastar um arquivo do computador para a área de mídia faz o upload e mostra a miniatura.
5. Arrastar uma mensagem na lista reordena, e a prévia acompanha.
6. Desligar "Ativo no Mini App" muda o título da prévia para o aviso de canal inativo.
7. "Visualizar Mini App" abre `/mini/<ID>` numa aba nova, com o mesmo visual da prévia.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/social-proof/composer-shell.tsx \
        components/dashboard/social-proof/quick-compose.tsx \
        components/dashboard/social-proof/feed-preview.tsx \
        components/dashboard/social-proof/composer.tsx
git commit -m "feat(prova-social): composer de 3 colunas com previa ao vivo"
```

---

## Verificação final

- [ ] `npm test` — suíte verde
- [ ] `npx tsc --noEmit` na raiz (só os 6 de baseline) e em `server/` (zero)
- [ ] `npm run build`
- [ ] Migration `073` aplicada no Supabase
- [ ] Checagem visual do Step 6 da Task 14
- [ ] `/mini/<ID>` renderiza reações, álbum, áudio, resposta e mensagem fixada
