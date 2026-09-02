# Mini App de Prova Social — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma tela que o lead abre dentro do Telegram, a partir de um botão no fluxo do bot, visualmente indistinguível da view de um canal do Telegram, com o conteúdo montado pelo tenant numa aba nova do console do bot.

**Architecture:** Duas superfícies no Next.js que já existe. A rota pública `/mini/[botId]` é renderizada no servidor (`force-dynamic`), lê o feed com service-role e devolve o HTML já montado — o lead nunca vê tela branca. Um client component fino inicializa o `@twa-dev/sdk`. Os componentes visuais em `components/telegram/` são autocontidos e não tocam em nenhum token do dashboard. O composer é uma aba nova do console usando Server Actions.

**Tech Stack:** Next.js 16.2.2 (App Router), React 19.2.4, Tailwind CSS 4, Supabase (`@supabase/ssr` + `@supabase/supabase-js`), `@twa-dev/sdk`, Vitest 4 + Testing Library, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-09-01-telegram-social-proof-miniapp-design.md`

## Global Constraints

- **Ler os docs antes de escrever rota.** `AGENTS.md`: esta versão do Next.js tem breaking changes vs. conhecimento pré-treinado. Guias em `node_modules/next/dist/docs/01-app/`.
- **`cacheComponents` está desligado** (`next.config.ts` não o declara). Logo `export const dynamic = "force-dynamic"` é válido. Se alguém ligar `cacheComponents`, o Next 16 remove `dynamic`, `dynamicParams`, `revalidate` e `fetchCache` — ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md`.
- **Params são `Promise`.** `export default async function Page({ params }: { params: Promise<{ botId: string }> })` e `const { botId } = await params`.
- **Server Action nunca faz `throw` pra recusa prevista.** Erro lançado é substituído por mensagem genérica em inglês na produção. Recusa esperada volta como dado: `{ ok: false, error: "..." }`. `throw` só pra bug de programação.
- **Testes são flat:** `tests/lib/<nome>.test.ts`. Não criar subpastas — `vitest.config.mts` inclui `tests/**/*.test.ts` mas a convenção do repo é plana.
- **Service-role é criado inline por arquivo**, como em `app/go/route.ts:23`. Não existe helper compartilhado e este plano não cria um.
- **Alias `@/`** aponta pra raiz do projeto (`tsconfig.json` e `vitest.config.mts`).
- **Nada em `components/telegram/` importa do dashboard.** Sem `--bg-root`, `--text-primary`, `glass`, `--accent`. Só `--tg-theme-*` e os tokens `--tgc-*` definidos na Task 5.
- **Comentários em português**, como o resto do repo.
- Rodar toda a suíte com `npm test`; um arquivo com `npx vitest run tests/lib/<arquivo>.test.ts`.

---

## Estrutura de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/071_social_proof.sql` | Tabelas, RLS, índice |
| `lib/social-proof/types.ts` | `FeedChannel`, `FeedMessage`, `GroupedMessage` |
| `lib/social-proof/format.ts` | Hora, separador de dia, contagem de views |
| `lib/social-proof/grouping.ts` | Agrupamento de mensagens consecutivas |
| `lib/social-proof/init-data.ts` | Verificação HMAC do `initData` |
| `lib/social-proof/feed.ts` | Leitura pública com service-role |
| `lib/actions/social-proof-actions.ts` | CRUD do composer (Server Actions) |
| `components/telegram/theme.css` | Tokens `--tgc-*` e classes da bolha |
| `components/telegram/chat-backdrop.tsx` | Fundo do chat |
| `components/telegram/avatar.tsx` | Círculo do remetente |
| `components/telegram/sender-name.tsx` | Nome colorido |
| `components/telegram/message-meta.tsx` | Hora + views |
| `components/telegram/media-container.tsx` | Imagem/vídeo |
| `components/telegram/message-bubble.tsx` | A bolha |
| `components/telegram/date-separator.tsx` | Pill "Hoje" |
| `components/telegram/message-group.tsx` | Um grupo de mensagens |
| `components/telegram/channel-header.tsx` | Topo do canal |
| `components/telegram/channel-footer.tsx` | Barra inferior decorativa |
| `components/telegram/channel-feed.tsx` | Monta a lista inteira |
| `app/mini/[botId]/page.tsx` | Rota pública SSR |
| `app/mini/[botId]/telegram-init.tsx` | Client component do SDK |
| `app/api/mini/session/route.ts` | Verificação do `initData` |
| `app/dashboard/bots/[botId]/prova-social/page.tsx` | Aba do console |
| `components/dashboard/social-proof/composer.tsx` | Editor do feed |
| `components/dashboard/social-proof/feed-preview.tsx` | Preview ao vivo, idêntico ao Mini App |
| `tests/lib/social-proof-format.test.ts` | |
| `tests/lib/social-proof-grouping.test.ts` | |
| `tests/lib/social-proof-init-data.test.ts` | |
| `tests/lib/social-proof-bubble.test.tsx` | |

> Desvio da spec §12: ela previa `message-form.tsx` separado do `composer.tsx`.
> O formulário tem um único consumidor e vive inteiramente do estado do
> composer — separar produziria dois arquivos acoplados em vez de uma
> fronteira. `feed-preview.tsx` continua separado porque é o único ponto que
> importa os componentes de `components/telegram/` no console.

**Modificar**

| Arquivo | Mudança |
|---|---|
| `lib/types/database.ts` | Tipos das tabelas novas |
| `lib/supabase/middleware.ts:33` | `/mini/` e `/api/mini/` em `isPublicRoute` |
| `components/dashboard/bot-sidebar.tsx:17` | Item "Prova Social" em `botNavItems` |
| `server/src/telegram/api.ts:42` | `web_app` em `InlineKeyboardButton` |
| `components/dashboard/flow-builder/config-forms/button-config.tsx` | `action: "miniapp"` |
| `server/src/engine/nodes/button.ts` | Montar o botão `web_app` |
| `package.json` | `@twa-dev/sdk` |

---

### Task 1: Migration e tipos

**Files:**
- Create: `supabase/migrations/071_social_proof.sql`
- Create: `lib/social-proof/types.ts`
- Modify: `lib/types/database.ts` (acrescentar ao final, antes de exports de tipo agregados se houver)

**Interfaces:**
- Consumes: nada.
- Produces: tabelas `social_proof_channels` e `social_proof_messages`; tipos `SocialProofChannel` e `SocialProofMessage` em `@/lib/types/database`; tipos `FeedChannel`, `FeedMessage`, `GroupedMessage`, `ActionResult`, `ChannelInput` e `MessageInput` em `@/lib/social-proof/types`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/071_social_proof.sql`:

```sql
-- Prova social: feed simulado de canal do Telegram, exibido no Mini App.
-- Canal simulado: um por bot.
create table public.social_proof_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  title text not null default '',
  avatar_url text,
  subscribers_label text not null default '',
  is_verified boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bot_id)
);
alter table public.social_proof_channels enable row level security;
-- is_admin() acompanha o padrão da migration 007: o admin da plataforma
-- gerencia o bot do cliente, e sem isso a aba abriria vazia pra ele.
create policy "Tenants can manage own social proof channels"
  on public.social_proof_channels for all
  using (tenant_id = auth.uid() or public.is_admin());

create table public.social_proof_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel_id uuid not null references public.social_proof_channels(id) on delete cascade,
  sender_name text not null default '',
  sender_avatar_url text,
  content_text text,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  -- Há quantos segundos a mensagem "aconteceu", contado do agora do lead.
  -- Guardar distância e não data absoluta é o que mantém o feed sempre fresco.
  offset_seconds integer not null default 0,
  views_count integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint social_proof_messages_has_content
    check (content_text is not null or media_url is not null),
  constraint social_proof_messages_media_type_consistent
    check ((media_url is null) = (media_type is null))
);
alter table public.social_proof_messages enable row level security;
create policy "Tenants can manage own social proof messages"
  on public.social_proof_messages for all
  using (tenant_id = auth.uid() or public.is_admin());

create index idx_social_proof_messages_feed
  on public.social_proof_messages (bot_id, is_active, position);
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Rodar o SQL acima no SQL Editor do projeto Supabase (mesmo caminho das migrations anteriores — o repo versiona o arquivo, a aplicação é manual).

Verificar no editor que as duas tabelas aparecem com RLS habilitado.

- [ ] **Step 3: Tipos do banco**

Acrescentar ao final de `lib/types/database.ts`:

```ts
export interface SocialProofChannel {
  id: string;
  tenant_id: string;
  bot_id: string;
  title: string;
  avatar_url: string | null;
  subscribers_label: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
}

export interface SocialProofMessage {
  id: string;
  tenant_id: string;
  bot_id: string;
  channel_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  content_text: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  offset_seconds: number;
  views_count: number;
  position: number;
  is_active: boolean;
  created_at: string;
}
```

- [ ] **Step 4: Tipos do feed**

Criar `lib/social-proof/types.ts`. São os tipos que atravessam a fronteira servidor→componente: só o que a UI precisa, nada de `tenant_id`.

```ts
/** O que o Mini App precisa saber sobre o canal simulado. */
export interface FeedChannel {
  title: string;
  avatarUrl: string | null;
  subscribersLabel: string;
  isVerified: boolean;
}

/** Uma mensagem do feed, já sem os campos internos do banco. */
export interface FeedMessage {
  id: string;
  senderName: string;
  senderAvatarUrl: string | null;
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  /** Há quantos segundos a mensagem "aconteceu", contado do agora do lead. */
  offsetSeconds: number;
  viewsCount: number;
}

/** FeedMessage com as flags de posição no grupo, produzidas por groupMessages(). */
export interface GroupedMessage extends FeedMessage {
  isFirstOfGroup: boolean;
  isLastOfGroup: boolean;
  /** Data absoluta já resolvida a partir do offset. */
  at: Date;
}

/*
 * Tipos de entrada e retorno das Server Actions do composer.
 *
 * Moram aqui e não no arquivo de actions porque um módulo "use server" só pode
 * exportar funções async — tipo exportado de lá é aposta em o transform apagar
 * a declaração antes da checagem. Aqui não há aposta nenhuma.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface ChannelInput {
  title: string;
  avatar_url: string | null;
  subscribers_label: string;
  is_verified: boolean;
  is_active: boolean;
}

export interface MessageInput {
  id?: string;
  sender_name: string;
  sender_avatar_url: string | null;
  content_text: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  offset_seconds: number;
  views_count: number;
  position: number;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/071_social_proof.sql lib/social-proof/types.ts lib/types/database.ts
git commit -m "feat(prova-social): tabelas e tipos do feed de prova social"
```

---

### Task 2: Formatação (hora, dia, views)

**Files:**
- Create: `lib/social-proof/format.ts`
- Test: `tests/lib/social-proof-format.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `offsetToDate(offsetSeconds: number, now: Date): Date`
  - `formatClock(date: Date): string`
  - `formatDaySeparator(date: Date, now: Date): string`
  - `formatViews(n: number): string`
  - `isSameDay(a: Date, b: Date): boolean`

Todas puras e com `now` injetável — é o que torna o feed relativo testável.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  offsetToDate,
  formatClock,
  formatDaySeparator,
  formatViews,
  isSameDay,
} from "@/lib/social-proof/format";

const now = new Date("2026-09-01T15:00:00-03:00");

describe("offsetToDate", () => {
  it("subtrai o offset do agora", () => {
    expect(offsetToDate(900, now).toISOString()).toBe(
      new Date("2026-09-01T14:45:00-03:00").toISOString(),
    );
  });

  it("offset zero é o próprio agora", () => {
    expect(offsetToDate(0, now).getTime()).toBe(now.getTime());
  });

  it("offset negativo não joga a mensagem pro futuro", () => {
    // Tenant digitou errado: tratamos como "agora", nunca como futuro,
    // porque mensagem com hora futura denuncia a simulação na hora.
    expect(offsetToDate(-500, now).getTime()).toBe(now.getTime());
  });
});

describe("formatClock", () => {
  it("usa 24h com zero à esquerda, no fuso de Brasília", () => {
    expect(formatClock(new Date("2026-09-01T09:05:00-03:00"))).toBe("09:05");
  });

  it("formata hora da tarde sem AM/PM", () => {
    expect(formatClock(new Date("2026-09-01T21:47:00-03:00"))).toBe("21:47");
  });
});

describe("isSameDay", () => {
  it("mesma data no fuso de Brasília", () => {
    expect(
      isSameDay(new Date("2026-09-01T01:00:00-03:00"), new Date("2026-09-01T23:00:00-03:00")),
    ).toBe(true);
  });

  it("dias diferentes", () => {
    expect(
      isSameDay(new Date("2026-08-31T23:00:00-03:00"), new Date("2026-09-01T01:00:00-03:00")),
    ).toBe(false);
  });
});

describe("formatDaySeparator", () => {
  it("hoje", () => {
    expect(formatDaySeparator(new Date("2026-09-01T08:00:00-03:00"), now)).toBe("Hoje");
  });

  it("ontem", () => {
    expect(formatDaySeparator(new Date("2026-08-31T08:00:00-03:00"), now)).toBe("Ontem");
  });

  it("mais antigo vira data por extenso", () => {
    expect(formatDaySeparator(new Date("2026-08-12T08:00:00-03:00"), now)).toBe("12 de agosto");
  });
});

describe("formatViews", () => {
  it("abaixo de mil é exato", () => {
    expect(formatViews(0)).toBe("0");
    expect(formatViews(987)).toBe("987");
  });

  it("milhares usam K com uma casa e vírgula", () => {
    expect(formatViews(1200)).toBe("1,2K");
    expect(formatViews(15300)).toBe("15,3K");
  });

  it("descarta a casa decimal quando é zero", () => {
    expect(formatViews(1000)).toBe("1K");
    expect(formatViews(42000)).toBe("42K");
  });

  it("trunca em vez de arredondar pra cima", () => {
    // 1999 não pode virar "2K": o número exibido nunca deve passar do real.
    expect(formatViews(1999)).toBe("1,9K");
  });

  it("milhões usam M", () => {
    expect(formatViews(1200000)).toBe("1,2M");
  });

  it("negativo é tratado como zero", () => {
    expect(formatViews(-5)).toBe("0");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-format.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/social-proof/format"`.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/format.ts`:

```ts
/**
 * Formatação do feed de prova social.
 *
 * Tudo aqui é puro e recebe `now` por parâmetro: o feed é relativo ao momento
 * em que o lead abre o Mini App, então "agora" é entrada, não ambiente.
 *
 * O fuso é fixo em São Paulo. O Mini App renderiza no servidor, e sem fuso fixo
 * a hora exibida seria a do servidor — que pode estar em UTC.
 */

const TZ = "America/Sao_Paulo";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Converte offset em segundos para data absoluta. Nunca retorna futuro. */
export function offsetToDate(offsetSeconds: number, now: Date): Date {
  const safe = Math.max(0, offsetSeconds);
  return new Date(now.getTime() - safe * 1000);
}

/** Partes de data/hora no fuso de Brasília, independente do fuso do servidor. */
function parts(date: Date): { year: number; month: number; day: number; hour: string; minute: string } {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // hourCycle h23 evita "24" à meia-noite em alguns runtimes.
    hour: out.hour === "24" ? "00" : out.hour,
    minute: out.minute,
  };
}

/** Hora no formato do Telegram: 24h, dois dígitos. */
export function formatClock(date: Date): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  const pa = parts(a);
  const pb = parts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** "Hoje", "Ontem" ou "12 de agosto". */
export function formatDaySeparator(date: Date, now: Date): string {
  if (isSameDay(date, now)) return "Hoje";

  const ontem = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isSameDay(date, ontem)) return "Ontem";

  const p = parts(date);
  return `${p.day} de ${MESES[p.month - 1]}`;
}

/**
 * Contagem de views no formato do Telegram: 1,2K / 15,3K / 1,2M.
 *
 * Trunca em vez de arredondar — o número mostrado nunca deve ser maior que o
 * real. Vírgula decimal porque o público é pt-BR.
 *
 * Calibração: confirmar contra um canal real no aparelho antes de considerar
 * fechado (spec §6).
 */
export function formatViews(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);

  const unit = v < 1_000_000 ? 1000 : 1_000_000;
  const suffix = unit === 1000 ? "K" : "M";
  const scaled = Math.floor((v / unit) * 10) / 10;
  const whole = Math.floor(scaled);
  const decimal = Math.round((scaled - whole) * 10);

  return decimal === 0 ? `${whole}${suffix}` : `${whole},${decimal}${suffix}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-format.test.ts`
Expected: PASS, 16 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/format.ts tests/lib/social-proof-format.test.ts
git commit -m "feat(prova-social): formatacao de hora, separador de dia e views"
```

---

### Task 3: Agrupamento de mensagens

É a regra que decide se o clone convence. Mensagens consecutivas do mesmo remetente formam um grupo; nome só na primeira, avatar e rabinho só na última.

**Files:**
- Create: `lib/social-proof/grouping.ts`
- Test: `tests/lib/social-proof-grouping.test.ts`

**Interfaces:**
- Consumes: `FeedMessage`, `GroupedMessage` de `@/lib/social-proof/types`; `offsetToDate` de `@/lib/social-proof/format`.
- Produces: `groupMessages(messages: FeedMessage[], now: Date): GroupedMessage[]` e a constante `GROUP_GAP_SECONDS`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-grouping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupMessages, GROUP_GAP_SECONDS } from "@/lib/social-proof/grouping";
import type { FeedMessage } from "@/lib/social-proof/types";

const now = new Date("2026-09-01T15:00:00-03:00");

function msg(id: string, senderName: string, offsetSeconds: number): FeedMessage {
  return {
    id,
    senderName,
    senderAvatarUrl: null,
    contentText: `texto ${id}`,
    mediaUrl: null,
    mediaType: null,
    offsetSeconds,
    viewsCount: 0,
  };
}

/** Atalho de leitura: "FL" = primeira e última, "F." = só primeira, etc. */
function shape(messages: FeedMessage[]): string[] {
  return groupMessages(messages, now).map(
    (m) => `${m.isFirstOfGroup ? "F" : "."}${m.isLastOfGroup ? "L" : "."}`,
  );
}

describe("groupMessages", () => {
  it("lista vazia devolve lista vazia", () => {
    expect(groupMessages([], now)).toEqual([]);
  });

  it("mensagem única é primeira e última do próprio grupo", () => {
    expect(shape([msg("a", "Ana", 600)])).toEqual(["FL"]);
  });

  it("duas do mesmo remetente formam um grupo só", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Ana", 580)])).toEqual(["F.", ".L"]);
  });

  it("três do mesmo remetente: só a do meio não é nem primeira nem última", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Ana", 580), msg("c", "Ana", 560)])).toEqual([
      "F.",
      "..",
      ".L",
    ]);
  });

  it("remetentes alternados: cada mensagem é seu próprio grupo", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Bia", 580), msg("c", "Ana", 560)])).toEqual([
      "FL",
      "FL",
      "FL",
    ]);
  });

  it("mesmo remetente não-adjacente não junta com o grupo anterior", () => {
    const out = groupMessages(
      [msg("a", "Ana", 600), msg("b", "Bia", 580), msg("c", "Ana", 560), msg("d", "Ana", 540)],
      now,
    );
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true, true, false]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([true, true, false, true]);
  });

  it("quebra o grupo quando o intervalo passa do limite", () => {
    // Mesmo remetente, mas com uma hora de distância: o Telegram separa.
    const distante = GROUP_GAP_SECONDS + 60;
    expect(shape([msg("a", "Ana", 3600), msg("b", "Ana", 3600 - distante)])).toEqual(["FL", "FL"]);
  });

  it("não quebra quando o intervalo está dentro do limite", () => {
    const perto = GROUP_GAP_SECONDS - 60;
    expect(shape([msg("a", "Ana", 3600), msg("b", "Ana", 3600 - perto)])).toEqual(["F.", ".L"]);
  });

  it("offsets fora de ordem não fundem grupos por acidente", () => {
    // O tenant pode reordenar por `position` e deixar offsets inconsistentes.
    // Distância é medida em módulo, então isso quebra o grupo em vez de
    // produzir um agrupamento silenciosamente errado.
    expect(shape([msg("a", "Ana", 100), msg("b", "Ana", 9000)])).toEqual(["FL", "FL"]);
  });

  it("resolve a data absoluta de cada mensagem", () => {
    const [m] = groupMessages([msg("a", "Ana", 900)], now);
    expect(m.at.toISOString()).toBe(new Date("2026-09-01T14:45:00-03:00").toISOString());
  });

  it("preserva a ordem e o conteúdo original", () => {
    const input = [msg("a", "Ana", 600), msg("b", "Bia", 580)];
    const out = groupMessages(input, now);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[0].contentText).toBe("texto a");
  });

  it("nomes que diferem só por espaço em volta contam como o mesmo remetente", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", " Ana ", 580)])).toEqual(["F.", ".L"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-grouping.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/social-proof/grouping"`.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/grouping.ts`:

```ts
import type { FeedMessage, GroupedMessage } from "@/lib/social-proof/types";
import { offsetToDate } from "@/lib/social-proof/format";

/**
 * Distância máxima entre duas mensagens do mesmo remetente pra continuarem no
 * mesmo grupo. Acima disso o Telegram separa, com nome e avatar repetidos.
 */
export const GROUP_GAP_SECONDS = 900;

function sameSender(a: FeedMessage, b: FeedMessage): boolean {
  return a.senderName.trim() === b.senderName.trim();
}

function closeEnough(a: FeedMessage, b: FeedMessage): boolean {
  return Math.abs(a.offsetSeconds - b.offsetSeconds) <= GROUP_GAP_SECONDS;
}

/**
 * Marca cada mensagem com sua posição no grupo.
 *
 * No Telegram, mensagens consecutivas do mesmo remetente viram um bloco:
 * o nome aparece só na primeira, o avatar e o rabinho da bolha só na última.
 * Clone que repete avatar em toda mensagem é o erro que mais denuncia.
 *
 * A entrada já vem ordenada por `position` (mais antiga primeiro).
 */
export function groupMessages(messages: FeedMessage[], now: Date): GroupedMessage[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];

    const continuaAnterior = prev !== undefined && sameSender(prev, m) && closeEnough(prev, m);
    const continuaProxima = next !== undefined && sameSender(m, next) && closeEnough(m, next);

    return {
      ...m,
      isFirstOfGroup: !continuaAnterior,
      isLastOfGroup: !continuaProxima,
      at: offsetToDate(m.offsetSeconds, now),
    };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-grouping.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/grouping.ts tests/lib/social-proof-grouping.test.ts
git commit -m "feat(prova-social): agrupamento de mensagens consecutivas"
```

---

### Task 4: Verificação do `initData`

Sem isso a URL do Mini App abre pra qualquer um, fora do Telegram.

**Files:**
- Create: `lib/social-proof/init-data.ts`
- Test: `tests/lib/social-proof-init-data.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `verifyInitData(initData: string, botToken: string, opts?: { maxAgeSeconds?: number; now?: Date }): InitDataResult` e o tipo `InitDataResult`.

`InitDataResult` é `{ ok: true; telegramUserId: number | null; authDate: Date }` ou `{ ok: false; reason: "missing_hash" | "bad_hash" | "expired" | "malformed" }`. Nunca lança — falha esperada volta como dado.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-init-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData } from "@/lib/social-proof/init-data";

const BOT_TOKEN = "123456:FAKE-TOKEN-PARA-TESTE";

/** Monta um initData assinado do mesmo jeito que o Telegram assina. */
function signed(fields: Record<string, string>): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const now = new Date("2026-09-01T15:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);

describe("verifyInitData", () => {
  it("aceita initData assinado corretamente", () => {
    const data = signed({
      auth_date: authDate,
      query_id: "AAF",
      user: JSON.stringify({ id: 777, first_name: "Ana" }),
    });

    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBe(777);
  });

  it("rejeita hash adulterado", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    const adulterado = data.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));

    const out = verifyInitData(adulterado, BOT_TOKEN, { now });
    expect(out).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejeita quando um campo foi trocado depois de assinado", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    const trocado = data.replace("777", "888");

    expect(verifyInitData(trocado, BOT_TOKEN, { now }).ok).toBe(false);
  });

  it("rejeita quando não há hash", () => {
    const out = verifyInitData("auth_date=123&user=%7B%7D", BOT_TOKEN, { now });
    expect(out).toEqual({ ok: false, reason: "missing_hash" });
  });

  it("rejeita string vazia", () => {
    expect(verifyInitData("", BOT_TOKEN, { now })).toEqual({ ok: false, reason: "missing_hash" });
  });

  it("rejeita initData velho demais", () => {
    const velho = String(Math.floor(now.getTime() / 1000) - 60 * 60 * 25);
    const data = signed({ auth_date: velho, user: JSON.stringify({ id: 777 }) });

    const out = verifyInitData(data, BOT_TOKEN, { now, maxAgeSeconds: 86400 });
    expect(out).toEqual({ ok: false, reason: "expired" });
  });

  it("rejeita auth_date ausente", () => {
    const data = signed({ user: JSON.stringify({ id: 777 }) });
    expect(verifyInitData(data, BOT_TOKEN, { now })).toEqual({ ok: false, reason: "malformed" });
  });

  it("aceita sem user e devolve id nulo", () => {
    const data = signed({ auth_date: authDate, query_id: "AAF" });
    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBeNull();
  });

  it("user com JSON quebrado não derruba a verificação", () => {
    const data = signed({ auth_date: authDate, user: "{isso nao e json" });
    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBeNull();
  });

  it("rejeita quando o token do bot é outro", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    expect(verifyInitData(data, "999:OUTRO-TOKEN", { now }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-init-data.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/social-proof/init-data"`.

- [ ] **Step 3: Implementar**

Criar `lib/social-proof/init-data.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type InitDataResult =
  | { ok: true; telegramUserId: number | null; authDate: Date }
  | { ok: false; reason: "missing_hash" | "bad_hash" | "expired" | "malformed" };

const DEFAULT_MAX_AGE_SECONDS = 86400;

/**
 * Verifica o initData que o Telegram entrega ao Mini App.
 *
 * Algoritmo da Bot API: a chave secreta é o HMAC-SHA256 do token do bot usando
 * a string "WebAppData" como chave; a assinatura é o HMAC dessa chave sobre os
 * pares "k=v" ordenados por chave e unidos por \n, com o próprio `hash` de fora.
 *
 * Sem isso, a URL do Mini App é só uma página pública que qualquer um abre.
 *
 * Nunca lança: falha prevista volta como dado, porque erro lançado em Server
 * Action/route vira mensagem genérica em produção.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: Date } = {},
): InitDataResult {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");

  // Comparação em tempo constante: o hash é um segredo verificável, e comparar
  // com === vaza o prefixo correto por tempo de resposta.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = params.get("auth_date");
  const authSeconds = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authSeconds)) {
    return { ok: false, reason: "malformed" };
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - authSeconds;
  if (ageSeconds > maxAge) return { ok: false, reason: "expired" };

  return {
    ok: true,
    telegramUserId: parseUserId(params.get("user")),
    authDate: new Date(authSeconds * 1000),
  };
}

/** O campo `user` é JSON. Vir quebrado não invalida a assinatura. */
function parseUserId(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-init-data.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/social-proof/init-data.ts tests/lib/social-proof-init-data.test.ts
git commit -m "feat(prova-social): verificacao HMAC do initData do Telegram"
```

---

### Task 5: Tokens visuais e fundo do chat

**Files:**
- Create: `components/telegram/theme.css`
- Create: `components/telegram/chat-backdrop.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: a classe `.tg-app` com os tokens `--tgc-*`, o modificador `.tg-app--fullscreen`, e as classes `.tg-feed` / `.tg-bubble`; componente `<ChatBackdrop />` sem props.

Todo componente das tasks seguintes assume estar dentro de um elemento com a classe `.tg-app`.

- [ ] **Step 1: Escrever os tokens**

Criar `components/telegram/theme.css`. Cada `--tgc-*` lê o `--tg-theme-*` correspondente com fallback nos valores oficiais do tema escuro do Telegram — o SDK só define as variáveis depois de carregar, e sem fallback o primeiro paint sai sem cor.

```css
/*
 * Tokens do clone de canal do Telegram.
 *
 * TUDO aqui está sob .tg-app, nada em :root. O Next não descarta a folha de
 * estilo ao navegar entre rotas (ver 01-app/01-getting-started/11-css.md), e o
 * escopo é o que garante que essas regras não alcancem nenhuma outra tela mesmo
 * quando a folha continua carregada.
 *
 * Escopo em .tg-app: o layout raiz do app é synthwave (app/globals.css) e nada
 * dele pode vazar pra cá. Nenhum token do dashboard é referenciado neste arquivo.
 *
 * A cor da bolha NÃO é exposta pelo SDK — só bg, text, hint, link, button e
 * secondary_bg. --tgc-bubble é derivada de secondary_bg com fallback nos valores
 * do tema oficial. Num tema customizado exótico pode desviar (spec §6).
 */

.tg-app {
  --tgc-bg: var(--tg-theme-bg-color, #17212b);
  --tgc-text: var(--tg-theme-text-color, #ffffff);
  --tgc-hint: var(--tg-theme-hint-color, #708499);
  --tgc-link: var(--tg-theme-link-color, #6ab3f3);
  --tgc-button: var(--tg-theme-button-color, #5288c1);
  --tgc-button-text: var(--tg-theme-button-text-color, #ffffff);
  --tgc-secondary-bg: var(--tg-theme-secondary-bg-color, #232e3c);
  --tgc-header-bg: var(--tg-theme-header-bg-color, #17212b);

  --tgc-bubble: var(--tg-theme-secondary-bg-color, #182533);
  --tgc-bubble-radius: 12px;
  --tgc-bubble-tail-radius: 6px;

  /* Véu escuro sobre o fundo do chat, onde ficam pills e metadados. */
  --tgc-veil: rgba(0, 0, 0, 0.28);

  color: var(--tgc-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/*
 * Layout comum ao Mini App e ao preview do composer.
 * Os tokens acima e este bloco valem nos dois; só o modificador --fullscreen
 * difere, porque o preview do console NÃO pode cobrir a tela.
 */
.tg-app {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--tgc-bg);
}

/*
 * Só o Mini App de verdade. Separado de .tg-app de propósito: se o
 * position:fixed estivesse no bloco base, o preview dentro do console cobriria
 * o dashboard inteiro.
 *
 * Altura por --tg-viewport-stable-height, nunca 100vh. No iOS dentro do
 * Telegram, 100vh conta uma barra de navegador que não existe ali e o rodapé do
 * feed fica cortado. A variante "stable" não oscila quando o teclado abre.
 */
.tg-app--fullscreen {
  position: fixed;
  inset: 0;
  height: var(--tg-viewport-stable-height, 100dvh);
}

.tg-feed {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
}

/* A bolha. O rabinho só existe na última mensagem do grupo. */
.tg-bubble {
  position: relative;
  max-width: min(80%, 480px);
  width: fit-content;
  padding: 6px 9px 7px;
  border-radius: var(--tgc-bubble-radius);
  background: var(--tgc-bubble);
  font-size: 16px;
  line-height: 1.3125;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

.tg-bubble--tail {
  border-bottom-left-radius: var(--tgc-bubble-tail-radius);
}

/* Mídia encostada nas bordas da bolha, como no Telegram. */
.tg-bubble--media {
  padding: 3px 3px 7px;
}

.tg-bubble--media-only {
  padding: 3px;
}
```

- [ ] **Step 2: Escrever o fundo do chat**

Criar `components/telegram/chat-backdrop.tsx`. O padrão de fundo não é exposto pelo SDK; é uma aproximação em SVG, tingida pelo tema e em opacidade baixa.

```tsx
/**
 * Fundo do chat.
 *
 * O Telegram não expõe o wallpaper do usuário via SDK, então isto é uma
 * aproximação: base na cor do tema + um padrão sutil por cima. Em opacidade
 * baixa de propósito — padrão forte demais chama atenção e denuncia mais do
 * que fundo liso.
 */
export function ChatBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: "var(--tgc-bg)",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.035' stroke-width='1.5'%3E%3Ccircle cx='30' cy='30' r='11'/%3E%3Ccircle cx='90' cy='90' r='11'/%3E%3Cpath d='M60 8c6 8 6 16 0 24-6 8-6 16 0 24'/%3E%3Cpath d='M12 72c8 6 16 6 24 0'/%3E%3Cpath d='M84 36c8 6 16 6 24 0'/%3E%3C/g%3E%3C/svg%3E")`,
        backgroundSize: "120px 120px",
      }}
    />
  );
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add components/telegram/theme.css components/telegram/chat-backdrop.tsx
git commit -m "feat(prova-social): tokens visuais e fundo do chat do Telegram"
```

---

### Task 6: Peças da bolha

**Files:**
- Create: `components/telegram/avatar.tsx`
- Create: `components/telegram/sender-name.tsx`
- Create: `components/telegram/message-meta.tsx`
- Create: `components/telegram/media-container.tsx`
- Test: `tests/lib/social-proof-bubble.test.tsx` (parcial; completado na Task 7)

**Interfaces:**
- Consumes: `formatClock`, `formatViews` de `@/lib/social-proof/format`.
- Produces:
  - `<TgAvatar name: string; url: string | null; visible: boolean />`
  - `<SenderName name: string />` e `peerColorIndex(name: string): number`
  - `<MessageMeta at: Date; views: number />`
  - `<MediaContainer url: string; type: "image" | "video"; hasCaption: boolean />`

Todos são Server Components (sem `"use client"`): renderizam no HTML inicial, que é o ponto da decisão de SSR.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib/social-proof-bubble.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { peerColorIndex, SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { TgAvatar } from "@/components/telegram/avatar";

describe("peerColorIndex", () => {
  it("é determinístico: o mesmo nome sempre dá a mesma cor", () => {
    expect(peerColorIndex("Ana Paula")).toBe(peerColorIndex("Ana Paula"));
  });

  it("fica dentro das 7 cores de peer do Telegram", () => {
    for (const nome of ["Ana", "Bia", "Carlos", "Dedé", "Ellen", "Fábio", "Gu", "H", ""]) {
      const i = peerColorIndex(nome);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });

  it("ignora espaço em volta, igual ao agrupamento", () => {
    expect(peerColorIndex(" Ana ")).toBe(peerColorIndex("Ana"));
  });

  it("nomes diferentes não caem todos na mesma cor", () => {
    const cores = new Set(
      ["Ana", "Bia", "Carlos", "Daniel", "Elis", "Fernanda", "Gustavo", "Helena"].map(peerColorIndex),
    );
    expect(cores.size).toBeGreaterThan(1);
  });
});

describe("SenderName", () => {
  it("mostra o nome", () => {
    render(<SenderName name="Ana Paula" />);
    expect(screen.getByText("Ana Paula")).toBeInTheDocument();
  });
});

describe("MessageMeta", () => {
  it("mostra hora e views formatadas", () => {
    render(<MessageMeta at={new Date("2026-09-01T14:45:00-03:00")} views={15300} />);
    expect(screen.getByText("14:45")).toBeInTheDocument();
    expect(screen.getByText("15,3K")).toBeInTheDocument();
  });

  it("omite o contador quando não há views", () => {
    render(<MessageMeta at={new Date("2026-09-01T14:45:00-03:00")} views={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("TgAvatar", () => {
  it("usa a imagem quando há url", () => {
    render(<TgAvatar name="Ana" url="https://exemplo.test/a.jpg" visible />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://exemplo.test/a.jpg");
  });

  it("cai na inicial quando não há url", () => {
    render(<TgAvatar name="ana paula" url={null} visible />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("ocupa o espaço mesmo invisível, pra não desalinhar o grupo", () => {
    const { container } = render(<TgAvatar name="Ana" url={null} visible={false} />);
    // O slot continua no DOM: sem ele, as mensagens do meio do grupo
    // encostariam na borda e o bloco ficaria torto.
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx`
Expected: FAIL — imports não resolvidos.

- [ ] **Step 3: Implementar `sender-name.tsx`**

```tsx
/**
 * Nome do remetente no topo da primeira bolha do grupo.
 *
 * A cor sai de um hash do nome, como no Telegram: o mesmo nome recebe sempre a
 * mesma cor, em qualquer sessão. Cor aleatória por render entregaria o truque
 * na primeira vez que o lead reabrisse o Mini App.
 */

/** As 7 cores de peer do Telegram, na ordem do app. */
const PEER_COLORS = [
  "#e17076", // vermelho
  "#eda86c", // laranja
  "#a695e7", // roxo
  "#7bc862", // verde
  "#6ec9cb", // ciano
  "#65aadd", // azul
  "#ee7aae", // rosa
];

/** Hash djb2 do nome → índice de cor. Determinístico e estável. */
export function peerColorIndex(name: string): number {
  const s = name.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PEER_COLORS.length;
}

export function SenderName({ name }: { name: string }) {
  return (
    <div
      style={{
        color: PEER_COLORS[peerColorIndex(name)],
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.2,
        marginBottom: 2,
      }}
    >
      {name}
    </div>
  );
}
```

- [ ] **Step 4: Implementar `avatar.tsx`**

```tsx
/**
 * Avatar do remetente, ao lado da ÚLTIMA mensagem do grupo.
 *
 * Quando invisível, o elemento continua ocupando espaço: é ele que mantém as
 * outras mensagens do grupo alinhadas com a que tem avatar.
 *
 * <img> puro e não next/image de propósito — estes componentes são
 * autocontidos (spec §6) e o otimizador acrescenta um salto de rede num
 * primeiro paint que precisa ser instantâneo dentro do webview.
 */

import type { CSSProperties } from "react";

const SIZE = 34;

export function TgAvatar({
  name,
  url,
  visible,
}: {
  name: string;
  url: string | null;
  visible: boolean;
}) {
  const base: CSSProperties = {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    borderRadius: "50%",
    alignSelf: "flex-end",
  };

  if (!visible) return <div style={base} aria-hidden />;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={SIZE}
        height={SIZE}
        loading="lazy"
        style={{ ...base, objectFit: "cover" }}
      />
    );
  }

  const inicial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        ...base,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--tgc-button)",
        color: "var(--tgc-button-text)",
        fontSize: 15,
        fontWeight: 500,
      }}
    >
      {inicial}
    </div>
  );
}
```

- [ ] **Step 5: Implementar `message-meta.tsx`**

```tsx
import { formatClock, formatViews } from "@/lib/social-proof/format";

/**
 * Rodapé da bolha: hora e, quando há, o olhinho com a contagem de views.
 * Alinhado à direita e na mesma linha do fim do texto, como no Telegram.
 */
export function MessageMeta({ at, views }: { at: Date; views: number }) {
  const temViews = views > 0;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        float: "right",
        marginLeft: 8,
        marginTop: 4,
        color: "var(--tgc-hint)",
        fontSize: 12,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {temViews && (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <span>{formatViews(views)}</span>
        </>
      )}
      <span>{formatClock(at)}</span>
    </span>
  );
}
```

- [ ] **Step 6: Implementar `media-container.tsx`**

```tsx
/**
 * Imagem ou vídeo dentro da bolha.
 *
 * Quando a mensagem tem legenda, os cantos de baixo ficam retos: a mídia
 * encosta no texto, e é assim que o Telegram desenha. Sem legenda, a mídia
 * herda o raio da bolha inteira.
 *
 * loading="lazy" porque o feed pode ser longo e o lead costuma estar em 4G.
 */
import type { CSSProperties } from "react";

export function MediaContainer({
  url,
  type,
  hasCaption,
}: {
  url: string;
  type: "image" | "video";
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

  if (type === "video") {
    return <video src={url} style={style} controls playsInline preload="metadata" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" style={style} />
  );
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx`
Expected: PASS, 10 testes.

- [ ] **Step 8: Commit**

```bash
git add components/telegram/avatar.tsx components/telegram/sender-name.tsx \
        components/telegram/message-meta.tsx components/telegram/media-container.tsx \
        tests/lib/social-proof-bubble.test.tsx
git commit -m "feat(prova-social): avatar, nome colorido, metadados e midia da bolha"
```

---

### Task 7: Bolha, grupo, separador e feed

**Files:**
- Create: `components/telegram/message-bubble.tsx`
- Create: `components/telegram/date-separator.tsx`
- Create: `components/telegram/message-group.tsx`
- Create: `components/telegram/channel-feed.tsx`
- Modify: `tests/lib/social-proof-bubble.test.tsx` (acrescentar o bloco do feed)

**Interfaces:**
- Consumes: `GroupedMessage`, `FeedMessage` de `@/lib/social-proof/types`; `groupMessages`; `formatDaySeparator`, `isSameDay`; os componentes da Task 6.
- Produces:
  - `<MessageBubble message: GroupedMessage />`
  - `<DateSeparator label: string />`
  - `<MessageGroup message: GroupedMessage />` (uma linha: slot de avatar + bolha)
  - `<ChannelFeed messages: FeedMessage[]; now: Date />`

- [ ] **Step 1: Acrescentar os testes que falham**

Adicionar ao final de `tests/lib/social-proof-bubble.test.tsx`:

```tsx
import { ChannelFeed } from "@/components/telegram/channel-feed";
import type { FeedMessage } from "@/lib/social-proof/types";

const agora = new Date("2026-09-01T15:00:00-03:00");

function fm(id: string, senderName: string, offsetSeconds: number, extra: Partial<FeedMessage> = {}): FeedMessage {
  return {
    id,
    senderName,
    senderAvatarUrl: null,
    contentText: `texto ${id}`,
    mediaUrl: null,
    mediaType: null,
    offsetSeconds,
    viewsCount: 0,
    ...extra,
  };
}

describe("ChannelFeed", () => {
  it("renderiza todas as mensagens na ordem recebida", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Bia", 500)]} now={agora} />);
    expect(screen.getByText("texto a")).toBeInTheDocument();
    expect(screen.getByText("texto b")).toBeInTheDocument();
  });

  it("mostra o nome do remetente uma vez só por grupo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Ana", 580)]} now={agora} />);
    expect(screen.getAllByText("Ana")).toHaveLength(1);
  });

  it("repete o nome quando o remetente muda", () => {
    render(
      <ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Bia", 580), fm("c", "Ana", 560)]} now={agora} />,
    );
    expect(screen.getAllByText("Ana")).toHaveLength(2);
  });

  it("insere um separador de dia no topo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600)]} now={agora} />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("insere separador novo quando o dia vira", () => {
    // 26h atrás cai em "Ontem"; 10min atrás cai em "Hoje".
    render(<ChannelFeed messages={[fm("a", "Ana", 26 * 3600), fm("b", "Ana", 600)]} now={agora} />);
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("renderiza mídia quando a mensagem tem", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { mediaUrl: "https://exemplo.test/f.jpg", mediaType: "image" })]}
        now={agora}
      />,
    );
    expect(document.querySelector('img[src="https://exemplo.test/f.jpg"]')).toBeTruthy();
  });

  it("mensagem só de mídia não renderiza parágrafo de texto vazio", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            contentText: null,
            mediaUrl: "https://exemplo.test/f.jpg",
            mediaType: "image",
          }),
        ]}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-bubble-text")).toBeNull();
  });

  it("feed vazio não quebra", () => {
    const { container } = render(<ChannelFeed messages={[]} now={agora} />);
    expect(container.querySelectorAll(".tg-bubble")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/telegram/channel-feed"`.

- [ ] **Step 3: Implementar `message-bubble.tsx`**

```tsx
import type { GroupedMessage } from "@/lib/social-proof/types";
import { SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { MediaContainer } from "@/components/telegram/media-container";

/**
 * A bolha. Sempre alinhada à esquerda — o Mini App simula um canal de
 * terceiros, então nunca existe mensagem "própria" do lead.
 *
 * O rabinho (canto inferior esquerdo reto) aparece só na última mensagem do
 * grupo, como no Telegram.
 */
export function MessageBubble({ message }: { message: GroupedMessage }) {
  const temMidia = message.mediaUrl !== null && message.mediaType !== null;
  const temTexto = message.contentText !== null && message.contentText.trim() !== "";

  const classes = [
    "tg-bubble",
    message.isLastOfGroup ? "tg-bubble--tail" : "",
    temMidia && temTexto ? "tg-bubble--media" : "",
    temMidia && !temTexto ? "tg-bubble--media-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {message.isFirstOfGroup && <SenderName name={message.senderName} />}

      {temMidia && (
        <MediaContainer
          url={message.mediaUrl!}
          type={message.mediaType!}
          hasCaption={temTexto}
        />
      )}

      {temTexto && (
        <div className="tg-bubble-text" style={{ whiteSpace: "pre-wrap", marginTop: temMidia ? 6 : 0 }}>
          {message.contentText}
          <MessageMeta at={message.at} views={message.viewsCount} />
        </div>
      )}

      {!temTexto && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <MessageMeta at={message.at} views={message.viewsCount} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implementar `date-separator.tsx`**

```tsx
/**
 * Pill centralizado que separa os dias. Fundo escuro translúcido sobre o
 * wallpaper, como no Telegram.
 */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
      <span
        style={{
          background: "var(--tgc-veil)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 500,
          padding: "3px 10px",
          borderRadius: 14,
          backdropFilter: "blur(6px)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Implementar `message-group.tsx`**

```tsx
import type { GroupedMessage } from "@/lib/social-proof/types";
import { TgAvatar } from "@/components/telegram/avatar";
import { MessageBubble } from "@/components/telegram/message-bubble";

/**
 * Uma linha do feed: slot de avatar + bolha.
 *
 * O avatar só é visível na última mensagem do grupo, mas o slot existe sempre —
 * é ele que mantém o bloco alinhado. Espaçamento menor dentro do grupo (2px)
 * que entre grupos (8px), como no Telegram.
 */
export function MessageGroup({ message }: { message: GroupedMessage }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        marginBottom: message.isLastOfGroup ? 8 : 2,
      }}
    >
      <TgAvatar
        name={message.senderName}
        url={message.senderAvatarUrl}
        visible={message.isLastOfGroup}
      />
      <MessageBubble message={message} />
    </div>
  );
}
```

- [ ] **Step 6: Implementar `channel-feed.tsx`**

```tsx
import type { FeedMessage } from "@/lib/social-proof/types";
import { groupMessages } from "@/lib/social-proof/grouping";
import { formatDaySeparator, isSameDay } from "@/lib/social-proof/format";
import { MessageGroup } from "@/components/telegram/message-group";
import { DateSeparator } from "@/components/telegram/date-separator";

/**
 * O feed inteiro.
 *
 * `now` vem por parâmetro (não de new Date() aqui dentro) porque a página
 * precisa usar o MESMO instante pra todas as mensagens — offsets resolvidos
 * contra "agoras" diferentes produziriam horários incoerentes entre si.
 */
export function ChannelFeed({ messages, now }: { messages: FeedMessage[]; now: Date }) {
  const grouped = groupMessages(messages, now);

  return (
    <div className="tg-feed" style={{ position: "relative", zIndex: 1 }}>
      {grouped.map((m, i) => {
        const anterior = grouped[i - 1];
        const novoDia = anterior === undefined || !isSameDay(anterior.at, m.at);

        return (
          <div key={m.id}>
            {novoDia && <DateSeparator label={formatDaySeparator(m.at, now)} />}
            <MessageGroup message={m} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx`
Expected: PASS, 18 testes.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, nenhum teste antigo quebrado.

- [ ] **Step 9: Commit**

```bash
git add components/telegram/message-bubble.tsx components/telegram/date-separator.tsx \
        components/telegram/message-group.tsx components/telegram/channel-feed.tsx \
        tests/lib/social-proof-bubble.test.tsx
git commit -m "feat(prova-social): bolha, agrupamento visual, separador de dia e feed"
```

---

### Task 8: Header e footer do canal

**Files:**
- Create: `components/telegram/channel-header.tsx`
- Create: `components/telegram/channel-footer.tsx`

**Interfaces:**
- Consumes: `FeedChannel` de `@/lib/social-proof/types`.
- Produces: `<ChannelHeader channel: FeedChannel />` e `<ChannelFooter />`.

- [ ] **Step 1: Implementar `channel-header.tsx`**

```tsx
import type { FeedChannel } from "@/lib/social-proof/types";

/**
 * Topo do canal: avatar, título, selo de verificado e a linha de inscritos.
 *
 * É a moldura que faz o feed parecer app; bolha boa dentro de moldura errada
 * continua parecendo site.
 */
export function ChannelHeader({ channel }: { channel: FeedChannel }) {
  return (
    <header
      style={{
        position: "relative",
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        paddingTop: "calc(8px + env(safe-area-inset-top))",
        background: "var(--tgc-header-bg)",
        borderBottom: "1px solid rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}
    >
      {channel.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={channel.avatarUrl}
          alt={channel.title}
          width={40}
          height={40}
          style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            background: "var(--tgc-button)",
            color: "var(--tgc-button-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 500,
          }}
        >
          {channel.title.trim().charAt(0).toUpperCase() || "#"}
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{channel.title}</span>
          {channel.isVerified && (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-label="verificado" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="11" fill="#3fa9f5" />
              <path
                d="M7 12.5l3.2 3.2L17 9"
                stroke="#ffffff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </div>
        <div style={{ color: "var(--tgc-hint)", fontSize: 13, lineHeight: 1.2 }}>
          {channel.subscribersLabel}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Implementar `channel-footer.tsx`**

```tsx
/**
 * Barra inferior do canal. Decorativa: dentro do Mini App não há canal real
 * pra silenciar ou seguir, mas a ausência dessa barra é justamente o que faz o
 * feed parecer uma página em vez de um chat.
 *
 * Sem handler de clique de propósito — botão que não faz nada é menos
 * estranho que botão que faz algo inesperado.
 */
export function ChannelFooter() {
  return (
    <footer
      style={{
        position: "relative",
        zIndex: 2,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
        background: "var(--tgc-secondary-bg)",
        borderTop: "1px solid rgba(0,0,0,0.2)",
        color: "var(--tgc-hint)",
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: 0.2,
      }}
    >
      <span aria-hidden style={{ marginRight: 8 }}>
        🔇
      </span>
      Silenciar
    </footer>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add components/telegram/channel-header.tsx components/telegram/channel-footer.tsx
git commit -m "feat(prova-social): header e footer do canal"
```

---

### Task 9: Rota pública do Mini App

**Files:**
- Create: `lib/social-proof/feed.ts`
- Create: `app/mini/[botId]/page.tsx`
- Create: `app/mini/[botId]/telegram-init.tsx`
- Modify: `lib/supabase/middleware.ts:33-42` (bloco `isPublicRoute`)
- Modify: `package.json` (dependência)

**Interfaces:**
- Consumes: `FeedChannel`, `FeedMessage`; `ChannelHeader`, `ChannelFooter`, `ChannelFeed`, `ChatBackdrop`.
- Produces: `loadFeed(botId: string): Promise<{ channel: FeedChannel; messages: FeedMessage[] } | null>`; a rota `/mini/[botId]`.

- [ ] **Step 1: Instalar o SDK**

```bash
npm install @twa-dev/sdk
```

- [ ] **Step 2: Liberar a rota no middleware**

Em `lib/supabase/middleware.ts`, dentro do `const isPublicRoute =`, acrescentar duas condições ao encadeamento de `||`, junto das que já existem:

```ts
    request.nextUrl.pathname.startsWith("/mini/") ||
    request.nextUrl.pathname.startsWith("/api/mini/") ||
```

Sem isso, `updateSession` redireciona todo lead pro `/login` — a lista é uma allowlist explícita.

- [ ] **Step 3: Implementar a leitura do feed**

Criar `lib/social-proof/feed.ts`:

```ts
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

/**
 * Lê o feed público de um bot.
 *
 * Service-role porque o lead não tem sessão Supabase — RLS não teria em quem se
 * apoiar. As colunas são enumeradas uma a uma, nunca select("*"): assim uma
 * coluna sensível acrescentada no futuro não vaza por acidente pro Mini App.
 *
 * Mesmo padrão de app/go/route.ts: o cliente é criado inline, sem helper
 * compartilhado.
 */
export async function loadFeed(
  botId: string,
): Promise<{ channel: FeedChannel; messages: FeedMessage[] } | null> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: canal } = await supabase
    .from("social_proof_channels")
    .select("id,title,avatar_url,subscribers_label,is_verified")
    .eq("bot_id", botId)
    .eq("is_active", true)
    .single();

  if (!canal) return null;

  const { data: linhas } = await supabase
    .from("social_proof_messages")
    .select(
      "id,sender_name,sender_avatar_url,content_text,media_url,media_type,offset_seconds,views_count",
    )
    .eq("channel_id", canal.id)
    .eq("is_active", true)
    .order("position", { ascending: true });

  return {
    channel: {
      title: canal.title,
      avatarUrl: canal.avatar_url,
      subscribersLabel: canal.subscribers_label,
      isVerified: canal.is_verified,
    },
    messages: (linhas ?? []).map((r) => ({
      id: r.id,
      senderName: r.sender_name,
      senderAvatarUrl: r.sender_avatar_url,
      contentText: r.content_text,
      mediaUrl: r.media_url,
      mediaType: r.media_type,
      offsetSeconds: r.offset_seconds,
      viewsCount: r.views_count,
    })),
  };
}
```

- [ ] **Step 4: Implementar o client component do SDK**

Criar `app/mini/[botId]/telegram-init.tsx`:

```tsx
"use client";

import { useEffect } from "react";

/**
 * Inicialização do Telegram Web App.
 *
 * Client component fino de propósito: o feed inteiro já veio renderizado do
 * servidor, e este componente só liga o SDK. Import dinâmico porque
 * @twa-dev/sdk toca em window no topo do módulo e quebraria o SSR.
 */
export function TelegramInit() {
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const WebApp = (await import("@twa-dev/sdk")).default;
      if (cancelado) return;

      WebApp.ready();
      WebApp.expand();

      // Sem isso, o swipe pra baixo pra ler o feed FECHA o Mini App.
      WebApp.disableVerticalSwipes?.();

      // Faz a moldura nativa do Telegram combinar com o wrapper.
      try {
        WebApp.setHeaderColor("secondary_bg_color");
        WebApp.setBackgroundColor("bg_color");
      } catch {
        // Versões antigas do cliente não têm esses métodos. O feed continua
        // correto; só a moldura fica na cor padrão.
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
```

- [ ] **Step 5: Implementar a página**

Criar `app/mini/[botId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { loadFeed } from "@/lib/social-proof/feed";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import { TelegramInit } from "./telegram-init";
import "@/components/telegram/theme.css";

/**
 * Mini App de prova social.
 *
 * force-dynamic porque o feed é relativo ao instante em que o lead abre: uma
 * resposta cacheada congelaria os horários. Válido porque cacheComponents está
 * desligado em next.config.ts — se alguém ligar, o Next 16 remove este export.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Canal",
  // Mini App não é página pra buscador: é destino de botão dentro do Telegram.
  robots: { index: false, follow: false },
};

export default async function MiniAppPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const feed = await loadFeed(botId);

  if (!feed) notFound();

  // Um único "agora" pra todas as mensagens: resolver offsets contra instantes
  // diferentes produziria horários incoerentes entre si.
  const now = new Date();

  return (
    <div className="tg-app tg-app--fullscreen">
      <TelegramInit />
      <ChatBackdrop />
      <ChannelHeader channel={feed.channel} />
      <ChannelFeed messages={feed.messages} now={now} />
      <ChannelFooter />
    </div>
  );
}
```

- [ ] **Step 6: Implementar a rota de verificação do `initData`**

Criar `app/api/mini/session/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyInitData } from "@/lib/social-proof/init-data";

export const dynamic = "force-dynamic";

/**
 * Confirma que quem abriu o Mini App veio mesmo de dentro do Telegram.
 *
 * O feed já foi renderizado sem esperar por isto — validar antes de pintar
 * traria de volta a tela branca que a decisão de SSR existe pra evitar. Esta
 * rota roda em paralelo e serve pra saber QUEM abriu.
 *
 * POST { botId, initData } → { ok, telegramUserId } | { ok: false, reason }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  // JSON.parse("null") devolve null SEM lançar, então `null` passa direto pelo
  // catch acima. Sem esta guarda, o acesso a campo abaixo estoura TypeError e a
  // rota responde 500 — quebrando a promessa de que recusa prevista vira dado.
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  const { botId: rawBotId, initData: rawInitData } = body as {
    botId?: unknown;
    initData?: unknown;
  };
  const botId = typeof rawBotId === "string" ? rawBotId : "";
  const initData = typeof rawInitData === "string" ? rawInitData : "";
  if (!botId || !initData) {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bot } = await supabase
    .from("bots")
    .select("telegram_token")
    .eq("id", botId)
    .single();

  // Bot inexistente NÃO curto-circuita: verificamos contra um token inerte pra
  // que o `reason` E o tempo de resposta fiquem indistinguíveis do caso em que o
  // bot existe e a assinatura está errada. Curto-circuitar aqui entregava um
  // oráculo de existência de botId — por conteúdo (bad_hash vs missing_hash) e
  // por tempo (nenhum HMAC vs dois HMAC).
  const token = bot?.telegram_token ?? "token-inexistente-para-verificacao-uniforme";

  const result = verifyInitData(initData, token);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  // Assinatura válida mas bot ausente do banco: não há sessão a devolver.
  if (!bot?.telegram_token) {
    return NextResponse.json({ ok: false, reason: "bad_hash" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, telegramUserId: result.telegramUserId });
}
```

- [ ] **Step 7: Verificar build e typecheck**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: build passa; a rota `/mini/[botId]` aparece na saída marcada como dinâmica (`ƒ`).

- [ ] **Step 8: Verificar no navegador**

Inserir um canal e duas mensagens de teste no SQL Editor do Supabase (trocar `<BOT_ID>` e `<TENANT_ID>` por valores reais do seu banco):

```sql
insert into public.social_proof_channels (tenant_id, bot_id, title, subscribers_label, is_verified, is_active)
values ('<TENANT_ID>', '<BOT_ID>', 'Canal de Testes', '12 483 inscritos', true, true)
returning id;

-- usar o id devolvido acima como <CHANNEL_ID>
insert into public.social_proof_messages
  (tenant_id, bot_id, channel_id, sender_name, content_text, offset_seconds, views_count, position)
values
  ('<TENANT_ID>', '<BOT_ID>', '<CHANNEL_ID>', 'Ana', 'primeira mensagem', 1800, 15300, 1),
  ('<TENANT_ID>', '<BOT_ID>', '<CHANNEL_ID>', 'Ana', 'segunda, mesmo grupo', 1740, 15200, 2),
  ('<TENANT_ID>', '<BOT_ID>', '<CHANNEL_ID>', 'Bia', 'outro remetente', 600, 9800, 3);
```

Run: `npm run dev` e abrir `http://localhost:3000/mini/<BOT_ID>`

Conferir, nesta ordem:
1. Não redirecionou pro `/login`.
2. As duas da Ana estão coladas, com **um** nome "Ana" e **um** avatar.
3. A da Bia tem nome e avatar próprios.
4. Separador "Hoje" no topo.
5. Nenhuma cor magenta/roxa do dashboard aparece, e a fonte não é condensada.
6. Horários batem com "agora menos o offset".

- [ ] **Step 9: Commit**

```bash
git add lib/social-proof/feed.ts app/mini app/api/mini lib/supabase/middleware.ts package.json package-lock.json
git commit -m "feat(prova-social): rota publica do Mini App com SSR e SDK do Telegram"
```

---

### Task 10: Composer no console

**Files:**
- Create: `lib/actions/social-proof-actions.ts`
- Create: `app/dashboard/bots/[botId]/prova-social/page.tsx`
- Create: `components/dashboard/social-proof/composer.tsx`
- Create: `components/dashboard/social-proof/feed-preview.tsx`
- Modify: `components/dashboard/bot-sidebar.tsx:17-27` (array `botNavItems`)

**Interfaces:**
- Consumes: `SocialProofChannel`, `SocialProofMessage` de `@/lib/types/database`; `ActionResult`, `ChannelInput`, `MessageInput` de `@/lib/social-proof/types`; `createClient` de `@/lib/supabase/server`; os componentes de `components/telegram/`.
- Produces:
  - `getSocialProof(botId): Promise<{ channel: SocialProofChannel | null; messages: SocialProofMessage[] }>`
  - `saveChannel(botId, data): Promise<ActionResult>`
  - `saveMessage(botId, data): Promise<ActionResult>`
  - `deleteMessage(messageId: string, botId: string): Promise<ActionResult>`
  - `<FeedPreview channel: ChannelInput; messages: SocialProofMessage[]; draft: MessageInput />`

- [ ] **Step 1: Implementar as Server Actions**

Criar `lib/actions/social-proof-actions.ts`. Toda recusa prevista volta como `{ ok: false, error }` — `throw` em Server Action é substituído por mensagem genérica em inglês na produção.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
// Os tipos vivem em types.ts: um módulo "use server" só pode exportar funções async.
import type { ActionResult, ChannelInput, MessageInput } from "@/lib/social-proof/types";

export async function getSocialProof(
  botId: string,
): Promise<{ channel: SocialProofChannel | null; messages: SocialProofMessage[] }> {
  const supabase = await createClient();

  const { data: channel } = await supabase
    .from("social_proof_channels")
    .select("*")
    .eq("bot_id", botId)
    .maybeSingle();

  if (!channel) return { channel: null, messages: [] };

  const { data: messages } = await supabase
    .from("social_proof_messages")
    .select("*")
    .eq("channel_id", (channel as SocialProofChannel).id)
    .order("position", { ascending: true });

  return {
    channel: channel as SocialProofChannel,
    messages: (messages ?? []) as SocialProofMessage[],
  };
}

/**
 * tenant_id a gravar nas linhas novas.
 *
 * Normalmente é o próprio usuário. Quando um admin da plataforma está mexendo
 * no bot de um cliente, é o tenant DO BOT — senão as linhas nasceriam com o
 * tenant errado e sumiriam da vista do dono. Mesmo desvio de
 * lib/actions/media-actions.ts:22-29.
 */
async function tenantDoBot(botId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (await isAdmin()) {
    const { data: bot } = await supabase.from("bots").select("tenant_id").eq("id", botId).single();
    return (bot?.tenant_id as string | undefined) ?? null;
  }

  // Não-admin: RLS já garante que ele só enxerga o próprio bot.
  const { data: bot } = await supabase.from("bots").select("tenant_id").eq("id", botId).single();
  return (bot?.tenant_id as string | undefined) ?? null;
}

export async function saveChannel(botId: string, input: ChannelInput): Promise<ActionResult> {
  if (input.title.trim() === "") {
    return { ok: false, error: "O nome do canal não pode ficar vazio." };
  }

  const tenantId = await tenantDoBot(botId);
  if (!tenantId) return { ok: false, error: "Bot não encontrado." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_proof_channels")
    .upsert({ tenant_id: tenantId, bot_id: botId, ...input }, { onConflict: "bot_id" });

  if (error) return { ok: false, error: `Não deu pra salvar o canal: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

export async function saveMessage(botId: string, input: MessageInput): Promise<ActionResult> {
  const temTexto = (input.content_text ?? "").trim() !== "";
  const temMidia = (input.media_url ?? "").trim() !== "";

  if (!temTexto && !temMidia) {
    return { ok: false, error: "A mensagem precisa de texto ou mídia." };
  }
  if (temMidia && input.media_type === null) {
    return { ok: false, error: "Escolha se a mídia é imagem ou vídeo." };
  }
  if (input.sender_name.trim() === "") {
    return { ok: false, error: "O nome do remetente não pode ficar vazio." };
  }
  if (input.offset_seconds < 0) {
    return { ok: false, error: "O tempo atrás não pode ser negativo." };
  }

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
    sender_name: input.sender_name,
    sender_avatar_url: input.sender_avatar_url,
    content_text: temTexto ? input.content_text : null,
    media_url: temMidia ? input.media_url : null,
    media_type: temMidia ? input.media_type : null,
    offset_seconds: input.offset_seconds,
    views_count: input.views_count,
    position: input.position,
    is_active: true,
  };

  const { error } = input.id
    ? await supabase.from("social_proof_messages").update(row).eq("id", input.id)
    : await supabase.from("social_proof_messages").insert(row);

  if (error) return { ok: false, error: `Não deu pra salvar a mensagem: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

export async function deleteMessage(messageId: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("social_proof_messages").delete().eq("id", messageId);

  if (error) return { ok: false, error: `Não deu pra apagar: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
```

- [ ] **Step 2: Implementar o composer**

Criar `components/dashboard/social-proof/composer.tsx`. Usa os tokens do dashboard (é tela de console, não o Mini App).

```tsx
"use client";

import { useState, useTransition } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
} from "@/lib/actions/social-proof-actions";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

export function SocialProofComposer({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [canal, setCanal] = useState<ChannelInput>({
    title: channel?.title ?? "",
    avatar_url: channel?.avatar_url ?? null,
    subscribers_label: channel?.subscribers_label ?? "",
    is_verified: channel?.is_verified ?? false,
    is_active: channel?.is_active ?? false,
  });

  const [nova, setNova] = useState<MessageInput>({
    sender_name: "",
    sender_avatar_url: null,
    content_text: "",
    media_url: null,
    media_type: null,
    offset_seconds: 600,
    views_count: 0,
    position: messages.length + 1,
  });

  function salvarCanal() {
    setErro(null);
    start(async () => {
      const r = await saveChannel(botId, canal);
      if (!r.ok) setErro(r.error);
    });
  }

  function salvarMensagem() {
    setErro(null);
    start(async () => {
      const r = await saveMessage(botId, nova);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setNova({ ...nova, content_text: "", media_url: null, media_type: null, position: nova.position + 1 });
    });
  }

  function apagar(id: string) {
    setErro(null);
    start(async () => {
      const r = await deleteMessage(id, botId);
      if (!r.ok) setErro(r.error);
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-(--text-primary)">Prova Social</h1>

      {erro && (
        <p className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {erro}
        </p>
      )}

      <section className="space-y-3 rounded-xl border border-(--border-subtle) p-4">
        <h2 className="text-sm font-semibold text-(--text-secondary)">Canal</h2>

        <input
          className={CAMPO}
          placeholder="Nome do canal"
          value={canal.title}
          onChange={(e) => setCanal({ ...canal, title: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL do avatar do canal"
          value={canal.avatar_url ?? ""}
          onChange={(e) => setCanal({ ...canal, avatar_url: e.target.value || null })}
        />
        <input
          className={CAMPO}
          placeholder="Linha de inscritos (ex.: 12 483 inscritos)"
          value={canal.subscribers_label}
          onChange={(e) => setCanal({ ...canal, subscribers_label: e.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
          <input
            type="checkbox"
            checked={canal.is_verified}
            onChange={(e) => setCanal({ ...canal, is_verified: e.target.checked })}
          />
          Selo de verificado
        </label>

        <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
          <input
            type="checkbox"
            checked={canal.is_active}
            onChange={(e) => setCanal({ ...canal, is_active: e.target.checked })}
          />
          Ativo — o Mini App só abre com isto marcado
        </label>

        <button
          onClick={salvarCanal}
          disabled={pending}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
        >
          Salvar canal
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-(--border-subtle) p-4">
        <h2 className="text-sm font-semibold text-(--text-secondary)">Nova mensagem</h2>

        <input
          className={CAMPO}
          placeholder="Nome do remetente"
          value={nova.sender_name}
          onChange={(e) => setNova({ ...nova, sender_name: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL do avatar do remetente"
          value={nova.sender_avatar_url ?? ""}
          onChange={(e) => setNova({ ...nova, sender_avatar_url: e.target.value || null })}
        />
        <textarea
          className={CAMPO}
          rows={3}
          placeholder="Texto da mensagem"
          value={nova.content_text ?? ""}
          onChange={(e) => setNova({ ...nova, content_text: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL da mídia (opcional)"
          value={nova.media_url ?? ""}
          onChange={(e) => setNova({ ...nova, media_url: e.target.value || null })}
        />

        <select
          className={CAMPO}
          value={nova.media_type ?? ""}
          onChange={(e) =>
            setNova({ ...nova, media_type: (e.target.value || null) as "image" | "video" | null })
          }
        >
          <option value="">Sem mídia</option>
          <option value="image">Imagem</option>
          <option value="video">Vídeo</option>
        </select>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-(--text-muted)">
            Há quantos minutos
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={Math.round(nova.offset_seconds / 60)}
              onChange={(e) =>
                setNova({ ...nova, offset_seconds: Math.max(0, Number(e.target.value)) * 60 })
              }
            />
          </label>

          <label className="text-xs text-(--text-muted)">
            Visualizações
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={nova.views_count}
              onChange={(e) => setNova({ ...nova, views_count: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </div>

        <button
          onClick={salvarMensagem}
          disabled={pending}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
        >
          Adicionar mensagem
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-(--text-secondary)">
          Mensagens ({messages.length})
        </h2>

        {messages.length === 0 && (
          <p className="text-sm text-(--text-muted)">Nenhuma mensagem ainda.</p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className="flex items-start gap-3 rounded-lg border border-(--border-subtle) p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-(--text-primary)">{m.sender_name}</p>
              <p className="truncate text-sm text-(--text-secondary)">
                {m.content_text ?? `[${m.media_type}]`}
              </p>
              <p className="text-xs text-(--text-muted)">
                {Math.round(m.offset_seconds / 60)} min atrás · {m.views_count} views
              </p>
            </div>
            <button
              onClick={() => apagar(m.id)}
              disabled={pending}
              className="text-xs text-(--red) disabled:opacity-50"
            >
              Apagar
            </button>
          </div>
        ))}
      </section>

      <FeedPreview channel={canal} messages={messages} draft={nova} />
    </div>
  );
}
```

- [ ] **Step 3: Implementar o preview ao vivo**

Criar `components/dashboard/social-proof/feed-preview.tsx`. Reusa os MESMOS componentes do Mini App — se o preview usasse markup próprio, ele divergiria do real na primeira mudança e deixaria de servir pra qualquer coisa.

```tsx
"use client";

import type { SocialProofMessage } from "@/lib/types/database";
import type { FeedMessage } from "@/lib/social-proof/types";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import "@/components/telegram/theme.css";

function toFeedMessage(m: SocialProofMessage): FeedMessage {
  return {
    id: m.id,
    senderName: m.sender_name,
    senderAvatarUrl: m.sender_avatar_url,
    contentText: m.content_text,
    mediaUrl: m.media_url,
    mediaType: m.media_type,
    offsetSeconds: m.offset_seconds,
    viewsCount: m.views_count,
  };
}

/** A mensagem sendo digitada, mostrada no fim do feed antes de existir no banco. */
function draftToFeedMessage(d: MessageInput): FeedMessage | null {
  const temTexto = (d.content_text ?? "").trim() !== "";
  const temMidia = (d.media_url ?? "").trim() !== "";
  if (!temTexto && !temMidia) return null;

  return {
    id: "__rascunho__",
    senderName: d.sender_name || "Sem nome",
    senderAvatarUrl: d.sender_avatar_url,
    contentText: temTexto ? d.content_text : null,
    mediaUrl: temMidia ? d.media_url : null,
    mediaType: temMidia ? d.media_type : null,
    offsetSeconds: d.offset_seconds,
    viewsCount: d.views_count,
  };
}

/**
 * Preview do Mini App dentro do console.
 *
 * Sem .tg-app--fullscreen: o modificador que fixa na viewport fica só no Mini
 * App real. Aqui a moldura tem altura fixa, como a tela de um celular.
 *
 * `now` é criado a cada render, o que é justamente o certo aqui: mexer no
 * campo "há quantos minutos" tem que mudar a hora exibida na hora.
 */
export function FeedPreview({
  channel,
  messages,
  draft,
}: {
  channel: ChannelInput;
  messages: SocialProofMessage[];
  draft: MessageInput;
}) {
  const rascunho = draftToFeedMessage(draft);
  const lista = [...messages.map(toFeedMessage), ...(rascunho ? [rascunho] : [])];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-(--text-secondary)">
        Prévia — é exatamente isto que o lead vê
      </h2>

      <div
        className="tg-app overflow-hidden rounded-[28px] border-4 border-(--border-default)"
        style={{ height: 620, maxWidth: 380, position: "relative" }}
      >
        <ChatBackdrop />
        <ChannelHeader
          channel={{
            title: channel.title || "Nome do canal",
            avatarUrl: channel.avatar_url,
            subscribersLabel: channel.subscribers_label || "0 inscritos",
            isVerified: channel.is_verified,
          }}
        />
        <ChannelFeed messages={lista} now={new Date()} />
        <ChannelFooter />
      </div>

      <p className="text-xs text-(--text-muted)">
        O tema aqui é o escuro padrão do Telegram. No celular do lead, as cores vêm
        do tema dele.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Implementar a página da aba**

Criar `app/dashboard/bots/[botId]/prova-social/page.tsx`:

```tsx
import { getSocialProof } from "@/lib/actions/social-proof-actions";
import { SocialProofComposer } from "@/components/dashboard/social-proof/composer";

export default async function ProvaSocialPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { channel, messages } = await getSocialProof(botId);

  return <SocialProofComposer botId={botId} channel={channel} messages={messages} />;
}
```

- [ ] **Step 5: Acrescentar o item na sidebar**

Em `components/dashboard/bot-sidebar.tsx`, no array `botNavItems`, inserir depois do item `media` (linha 20):

```ts
  { label: "Prova Social", segment: "prova-social", icon: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0", color: "var(--purple)" },
```

Não mexer no array `PRIMARY` de `components/dashboard/bot-shell.tsx:16` — a aba nova fica atrás do "Mais" no mobile, como as outras secundárias.

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tudo passa.

Run: `npm run dev` e abrir `/dashboard/bots/<BOT_ID>/prova-social`

Conferir:
1. "Prova Social" aparece na sidebar.
2. Salvar o canal com nome vazio mostra "O nome do canal não pode ficar vazio." — em português, na tela, e não um erro genérico.
3. Adicionar mensagem sem texto nem mídia mostra "A mensagem precisa de texto ou mídia."
4. Adicionar uma mensagem válida faz ela aparecer na lista.
5. A prévia à direita mostra o feed com visual de Telegram, e digitar no campo
   de texto faz a bolha de rascunho aparecer na hora.
6. A prévia NÃO cobre a tela do dashboard (é o que o `.tg-app--fullscreen`
   separado garante).
7. Abrir `/mini/<BOT_ID>` mostra a mensagem nova.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/social-proof-actions.ts app/dashboard/bots/\[botId\]/prova-social \
        components/dashboard/social-proof components/dashboard/bot-sidebar.tsx
git commit -m "feat(prova-social): aba de composer no console do bot"
```

---

### Task 11: Botão web_app no fluxo

**Files:**
- Modify: `server/src/telegram/api.ts:42-55` (`InlineKeyboardButton`)
- Modify: `server/src/config.ts:13-19` (nova entrada `publicAppUrl`)
- Modify: `server/.env.example`
- Modify: `server/src/engine/nodes/button.ts:35-47` (o `.map` que monta o teclado)
- Modify: `components/dashboard/flow-builder/config-forms/button-config.tsx:43` e `:159-160`

**Interfaces:**
- Consumes: a rota `/mini/[botId]` da Task 9.
- Produces: botões de fluxo com `action: "miniapp"` que abrem o Mini App dentro do Telegram.

- [ ] **Step 1: Acrescentar `web_app` ao tipo**

Em `server/src/telegram/api.ts`, dentro de `interface InlineKeyboardButton`, logo depois de `copy_text?: { text: string };`:

```ts
  /**
   * Abre um Mini App dentro do Telegram (Bot API 6.0+).
   *
   * A URL precisa ser HTTPS público. Diferente de `url`, é o `web_app` que faz
   * o Telegram injetar initData e as variáveis de tema — com `url` o Mini App
   * vira um site comum num webview, sem tema nativo e sem identificação.
   */
  web_app?: { url: string };
```

- [ ] **Step 2: Acrescentar a URL pública do front na config do server**

`config.baseWebhookUrl` é o domínio do **server** (Railway). O Mini App mora no **front** (`lionbot.site`, ver `lib/site.ts:5`), e hoje o server não tem nenhuma referência a esse domínio. É preciso uma entrada nova.

Em `server/src/config.ts`, dentro do objeto `config`, logo depois da linha `baseWebhookUrl`:

```ts
  // Domínio público do front (Next.js), onde mora o Mini App de prova social.
  // Diferente de baseWebhookUrl, que é o domínio DESTE server.
  publicAppUrl: envOptional("PUBLIC_APP_URL", "https://lionbot.site"),
```

Em `server/.env.example`, acrescentar:

```
PUBLIC_APP_URL=https://lionbot.site
```

- [ ] **Step 3: Montar o botão no engine**

Em `server/src/engine/nodes/button.ts`, acrescentar o import junto dos que já existem no topo:

```ts
import { config } from "../../config.js";
```

Depois, dentro do `.map` que monta `inlineKeyboard` (linha 35), inserir o caso novo **antes** do `return` final que trata callback genérico:

```ts
    // Mini App de prova social. Precisa ser web_app e não url: é o que faz o
    // Telegram abrir dentro do app, com initData e cores do tema.
    if (btn.action === "miniapp") {
      return [
        {
          text: btn.text,
          web_app: { url: `${config.publicAppUrl}/mini/${ctx.lead.bot_id}` },
          style,
        },
      ];
    }
```

O bloco fica assim, no contexto:

```ts
  const inlineKeyboard: InlineKeyboardButton[][] = buttons.map((btn, i) => {
    const style = btn.style || undefined;
    if (btn.action === "open_url") {
      return [{ text: btn.text, url: btn.value, style }];
    }
    if (btn.action === "payment") {
      // ... (inalterado)
      const btnId = btn.id ?? `btn_idx_${i}`;
      return [{ text: btn.text, callback_data: `${ctx.node.id}:${btnId}`, style }];
    }
    if (btn.action === "miniapp") {
      return [
        {
          text: btn.text,
          web_app: { url: `${config.publicAppUrl}/mini/${ctx.lead.bot_id}` },
          style,
        },
      ];
    }
    return [{ text: btn.text, callback_data: `${ctx.node.id}:${btn.value}`, style }];
  });
```

- [ ] **Step 4: Acrescentar a opção no editor de fluxos**

Em `components/dashboard/flow-builder/config-forms/button-config.tsx`:

Linha 43 — acrescentar a action à lista de conhecidas. Sem isso, um botão de Mini App cai no fallback de "Seguir fluxo (clonado)" e some da lista:

```ts
const KNOWN_ACTIONS = ["callback", "go_to_node", "open_url", "payment", "miniapp"];
```

Depois da linha 160 (`<option value="payment">💳 Gerar Pagamento (Pix)</option>`):

```tsx
                <option value="miniapp">📣 Abrir Mini App (prova social)</option>
```

`action` é tipado como `string` (linha 10), então não há união de tipos pra estender.

O campo `value` não é usado por esta action — a URL é montada no server a partir do `bot_id` do lead. O input genérico de "Valor" (linha 259) continua aparecendo e pode ser deixado vazio.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tudo passa.

Run: `cd server && npx tsc --noEmit && cd ..`
Expected: sem erros.

- [ ] **Step 6: Verificar no Telegram de verdade**

Este é o único teste que prova a entrega. Nenhum teste unitário substitui: o comportamento do webview, o tema nativo e o gesto de swipe só existem no app real.

1. Publicar a app no domínio HTTPS (o Telegram recusa `localhost` em `web_app`).
2. Garantir que `PUBLIC_APP_URL` está setada no ambiente do server.
3. No editor de fluxos, criar um nó `button` com um botão de action "Abrir Mini App".
4. Abrir a conversa com o bot no **celular** e chegar nesse nó.
5. Tocar no botão.

Conferir:
- Abre dentro do Telegram, não no navegador externo.
- O tema segue o do app: trocar entre claro/escuro no Telegram e reabrir.
- Rolar o feed **não** fecha o Mini App (é o `disableVerticalSwipes`).
- No iPhone, a última mensagem não fica escondida atrás da barra inferior.
- Nenhum resquício visual do dashboard: sem magenta, sem fonte condensada.

- [ ] **Step 7: Commit**

```bash
git add server/src/telegram/api.ts server/src/config.ts server/.env.example         server/src/engine/nodes/button.ts         components/dashboard/flow-builder/config-forms/button-config.tsx
git commit -m "feat(prova-social): botao web_app no fluxo abre o Mini App"
```

---

## Verificação final

- [ ] `npm test` — toda a suíte passa
- [ ] `npx tsc --noEmit` na raiz e em `server/`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Fluxo ponta a ponta no celular (Task 11, Step 6)
