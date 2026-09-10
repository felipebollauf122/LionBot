# Campanhas Agendadas — Plano 2: Composer genérico, tela e worker de disparo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar o composer da Prova Social para servir a duas features, construir a tela da campanha em cima dele, e fazer um worker publicar a fila respeitando o agendamento.

**Architecture:** O `ComposerShell` deixa de importar as actions da Prova Social e passa a recebê-las como props, mais slots para as colunas que diferem. `SocialProofComposer` vira o adaptador que reamarra a Prova Social — sua página não muda. O disparo é *tick-based*: um poller de 30s enfileira no máximo uma mensagem vencida por campanha, e cada job publica uma mensagem e termina, sem segurar slot do worker por horas.

**Tech Stack:** Next 16.2.2 (App Router, Server Actions), React 19, motion, Tailwind v4, Vitest + Testing Library na raiz; BullMQ + grammy no `server/`.

**Spec:** `docs/superpowers/specs/2026-09-10-scheduled-post-campaigns-design.md`

**Depende de:** `docs/superpowers/plans/2026-09-10-scheduled-campaigns-1-core.md` (Tasks 1-2: as tabelas e os tipos precisam existir).

## Global Constraints

- **Os 8 testes de Prova Social em `tests/lib/social-proof-*.test.ts(x)` são o portão da refatoração.** Precisam passar **sem edição**. Se um deles exigir mudança, a generalização quebrou contrato — pare e reveja.
- **Server Actions retornam `ActionResult`, nunca `throw`.** Erro lançado em Server Action é apagado em produção e chega ao usuário como texto genérico em inglês.
- **Módulo `"use server"` só exporta função async.** Tipos e helpers puros moram fora — `lib/composer/`, seguindo o precedente de `lib/social-proof/types.ts`.
- **Imports no `server/` levam sufixo `.js`.**
- **Destino só aceita `peer_type='channel'`** (canal ou supergrupo). `promoteBotToAdmin` monta `Api.InputChannel` e não serve pra grupo legacy.
- **Comentários e textos de UI em português.**
- Rodar testes do app: `npm test`. Do server: `cd server && npm test`.

---

### Task 1: `accumulateSchedule` — o cálculo do agendamento

**Files:**
- Create: `lib/composer/schedule.ts`
- Test: `tests/lib/composer-schedule.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `export function accumulateSchedule(rows: SchedulableRow[], startAt: Date): Array<{ id: string; scheduledAt: Date }>` e `export interface SchedulableRow { id: string; delay_seconds: number; ai_discarded: boolean }`.

Mora em `lib/composer/` e não dentro da action por dois motivos: módulo `"use server"` só exporta função async, e **a mesma função alimenta a prévia** — a tela mostra "última postagem cai em…" antes de qualquer gravação.

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/lib/composer-schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { accumulateSchedule, type SchedulableRow } from "@/lib/composer/schedule";

function r(id: string, delay: number, descartada = false): SchedulableRow {
  return { id, delay_seconds: delay, ai_discarded: descartada };
}

const INICIO = new Date("2026-09-10T12:00:00.000Z");

describe("accumulateSchedule", () => {
  it("a primeira mensagem sai no horário de início, sem esperar o próprio delay", () => {
    const out = accumulateSchedule([r("a", 600)], INICIO);
    expect(out).toEqual([{ id: "a", scheduledAt: INICIO }]);
  });

  it("cada delay é somado ao horário da mensagem anterior", () => {
    const out = accumulateSchedule([r("a", 600), r("b", 300), r("c", 900)], INICIO);
    expect(out.map((o) => o.scheduledAt.toISOString())).toEqual([
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:05:00.000Z", // +300s
      "2026-09-10T12:20:00.000Z", // +900s
    ]);
  });

  it("descartada pela IA não entra no resultado nem consome o próprio delay", () => {
    // 'b' foi descartada: 'c' herda a vez dela e espera o delay DE 'c'
    // contado a partir de 'a'. Somar o delay de uma mensagem que não vai ao ar
    // abriria um buraco silencioso na cadência.
    const out = accumulateSchedule([r("a", 600), r("b", 3600, true), r("c", 300)], INICIO);
    expect(out).toEqual([
      { id: "a", scheduledAt: new Date("2026-09-10T12:00:00.000Z") },
      { id: "c", scheduledAt: new Date("2026-09-10T12:05:00.000Z") },
    ]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(accumulateSchedule([], INICIO)).toEqual([]);
  });

  it("lista só de descartadas devolve lista vazia", () => {
    expect(accumulateSchedule([r("a", 60, true), r("b", 60, true)], INICIO)).toEqual([]);
  });

  it("delay negativo ou zero não faz o horário andar pra trás", () => {
    const out = accumulateSchedule([r("a", 0), r("b", -100), r("c", 60)], INICIO);
    expect(out.map((o) => o.scheduledAt.toISOString())).toEqual([
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:01:00.000Z",
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/composer-schedule.test.ts`
Expected: FAIL — "Failed to resolve import @/lib/composer/schedule".

- [ ] **Step 3: Implementar**

Crie `lib/composer/schedule.ts`:

```ts
/**
 * Cálculo do agendamento absoluto a partir dos delays relativos.
 *
 * Vive aqui e não na Server Action por duas razões: um módulo "use server" só
 * exporta função async (mesmo motivo que tirou os tipos da Prova Social pra
 * lib/social-proof/types.ts), e a MESMA função alimenta a prévia da tela, que
 * mostra "última postagem cai em…" antes de qualquer gravação.
 */

export interface SchedulableRow {
  id: string;
  /** Espera, em segundos, DEPOIS da mensagem anterior. */
  delay_seconds: number;
  ai_discarded: boolean;
}

export function accumulateSchedule(
  rows: SchedulableRow[],
  startAt: Date,
): Array<{ id: string; scheduledAt: Date }> {
  const out: Array<{ id: string; scheduledAt: Date }> = [];
  let cursor = startAt.getTime();
  let primeira = true;

  for (const row of rows) {
    // Descartada não vai ao ar, então também não consome o próprio delay:
    // somá-lo abriria um buraco na cadência que ninguém pediu.
    if (row.ai_discarded) continue;

    if (primeira) {
      // A primeira sai no horário de início. O delay de uma mensagem é o que
      // se espera ANTES dela contado da anterior — a primeira não tem anterior.
      primeira = false;
    } else {
      cursor += Math.max(0, row.delay_seconds) * 1000;
    }
    out.push({ id: row.id, scheduledAt: new Date(cursor) });
  }

  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/lib/composer-schedule.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/composer/schedule.ts tests/lib/composer-schedule.test.ts
git commit -m "feat(composer): accumulateSchedule converte delays relativos em horários"
```

---

### Task 2: `ComposerMessageRow` e os defaults no `FeedPreview`

**Files:**
- Create: `lib/composer/types.ts`
- Modify: `components/dashboard/social-proof/feed-preview.tsx`
- Test: `tests/lib/composer-row-defaults.test.tsx`

**Interfaces:**
- Consumes: `MediaItem`, `Reaction` de `@/lib/social-proof/types`.
- Produces: `export interface ComposerMessageRow` e `export interface ComposerActions` (esta última usada pela Task 3).

> **Achado carregado do Plano 1 — requisito desta task, não observação.** Uma linha com `kind: "document"` guarda `media[].type: "photo"`, porque `StagedMedia` herda o union de `MediaItem` (`"photo" | "video" | "audio"`), que não tem `"document"`. Sem tratamento, a prévia renderiza um PDF como `<img>` quebrado. **Não mude o union** — ele é o contrato com a UI reusada e com a tabela. Em vez disso, no mapeamento para `FeedMessage`, uma linha cujo `kind` é `"document"` desenha um chip de arquivo (nome vindo de `file_name`, ícone genérico), nunca uma imagem. Acrescente um teste para isso em `tests/lib/composer-row-defaults.test.tsx`.

**O que o implementador precisa saber:** `FeedPreview` hoje tipa `messages: SocialProofMessage[]` e lê sete campos que **não existem** na tabela de campanha — `sender_kind`, `sender_name`, `sender_avatar_url`, `reactions`, `offset_seconds`, `views_count`, `display_time`. Eles viram opcionais no tipo neutro, e `toFeedMessage`/`draftToFeedMessage` passam a aplicar default. Os defaults descrevem exatamente o comportamento certo no modo campanha: canal posta como ele mesmo, sem reação, sem contador falso.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/lib/composer-row-defaults.tsx`... na verdade `tests/lib/composer-row-defaults.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";
import type { ComposerMessageRow } from "@/lib/composer/types";
import type { ChannelInput } from "@/lib/social-proof/types";

const canal: ChannelInput = {
  title: "Canal de teste",
  avatar_url: null,
  subscribers_label: "1 mil inscritos",
  is_verified: false,
  is_active: true,
  owner_name: "Dona",
  owner_avatar_url: null,
  owner_username: "dona",
  unread_badge: 0,
};

/** Uma linha vinda de mtproto_scheduled_messages: sem os campos de Prova Social. */
const linhaDeCampanha: ComposerMessageRow = {
  id: "m1",
  kind: "text",
  content_text: "Post agendado",
  media: [],
  reply_to_id: null,
};

describe("ComposerMessageRow sem os campos de Prova Social", () => {
  it("renderiza a bolha sem quebrar", () => {
    render(
      <FeedPreview
        channel={canal}
        messages={[linhaDeCampanha]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(screen.getByText("Post agendado")).toBeInTheDocument();
  });

  it("não mostra contador de visualizações nem reações", () => {
    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={[linhaDeCampanha]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(container.querySelector(".tg-reactions")).toBeNull();
    // views_count ausente vira 0, e 0 não desenha o contador.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("uma linha de Prova Social completa continua renderizando igual", () => {
    render(
      <FeedPreview
        channel={canal}
        messages={[
          {
            ...linhaDeCampanha,
            id: "m2",
            content_text: "Post de prova social",
            sender_kind: "member",
            sender_name: "Cliente",
            sender_avatar_url: null,
            reactions: [{ emoji: "🔥", count: 3 }],
            offset_seconds: 600,
            views_count: 120,
            display_time: null,
          },
        ]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(screen.getByText("Post de prova social")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });
});
```

Antes de escrever, abra `tests/lib/social-proof-bubble-v2.test.tsx` e **copie o formato de render e os seletores de lá** — os nomes de classe usados acima (`.tg-reactions`) são ilustrativos e precisam bater com `components/telegram/reactions-row.tsx`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/composer-row-defaults.test.tsx`
Expected: FAIL — "Failed to resolve import @/lib/composer/types".

- [ ] **Step 3: Criar o tipo neutro**

Crie `lib/composer/types.ts`:

```ts
import type { ActionResult, MediaItem, MessageInput, Reaction } from "@/lib/social-proof/types";

/**
 * A linha que o preview do composer sabe desenhar, servindo às duas features.
 *
 * Os campos do primeiro bloco existem nas duas tabelas. Os do segundo são só
 * da Prova Social: a campanha não os tem porque o canal posta como ele mesmo,
 * o bot não consegue reagir e ninguém finge horário — o horário dela vem do
 * scheduled_at real, convertido em offset pela página.
 */
export interface ComposerMessageRow {
  id: string;
  kind: string;
  content_text: string | null;
  media: MediaItem[] | unknown;
  reply_to_id: string | null;

  sender_kind?: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  reactions?: Reaction[] | unknown;
  offset_seconds?: number | null;
  views_count?: number | null;
  display_time?: string | null;
  /** Legado da 071, antes de `media` virar lista. Só a Prova Social tem. */
  media_url?: string | null;
  media_type?: string | null;
}

/**
 * As operações que o composer dispara. Injetadas para o shell não conhecer
 * nem a Prova Social nem a campanha.
 */
export type AiAssistAction = "rewrite" | "caption" | "summarize";

export interface ComposerActions {
  saveMessage(input: MessageInput): Promise<ActionResult>;
  deleteMessage(id: string): Promise<ActionResult>;
  duplicateMessage(id: string): Promise<ActionResult>;
  reorderMessages(orderedIds: string[]): Promise<ActionResult>;
  /** Ausente = a feature não tem mensagem fixada. */
  setPinned?(id: string | null): Promise<ActionResult>;
  /** Ausente = a feature não tem assistente de IA (Plano 3 liga na campanha). */
  aiAssist?(id: string, action: AiAssistAction): Promise<ActionResult>;
}
```

- [ ] **Step 4: Aplicar os defaults no `FeedPreview`**

Em `components/dashboard/social-proof/feed-preview.tsx`:

1. Troque o import de tipo: `import type { ComposerMessageRow } from "@/lib/composer/types";` e substitua **todas** as ocorrências de `SocialProofMessage` por `ComposerMessageRow` (nas assinaturas de `resolverCitacao`, `toFeedMessage`, `draftToFeedMessage`, no `Map` e na prop `messages`).

2. Em `toFeedMessage`, aplique os defaults:

```ts
  return {
    id: m.id,
    senderKind: m.sender_kind === "member" ? "member" : "owner",
    senderName: m.sender_name ?? "",
    senderAvatarUrl: m.sender_avatar_url ?? null,
    kind: m.kind as FeedMessage["kind"],
    contentText: m.content_text,
    media: normalizeMedia(m.media, m.media_url ?? null, m.media_type ?? null),
    reactions: normalizeReactions(m.reactions),
    ...resolverCitacao(m, porId, channel),
    offsetSeconds: m.offset_seconds ?? 0,
    displayTime: m.display_time ?? null,
    viewsCount: m.views_count ?? 0,
  };
```

O default de `senderKind` **inverte** a comparação original de propósito: `m.sender_kind === "owner" ? "owner" : "member"` faria `undefined` virar `"member"`, e uma postagem de canal tem que aparecer como do dono. Comparar contra `"member"` mantém a Prova Social idêntica e dá o default certo pra campanha.

3. Em `resolverCitacao`, o acesso a `alvo.sender_kind` e `alvo.sender_name` precisa do mesmo tratamento:

```ts
    replyToSender:
      alvo.sender_kind === "member"
        ? (alvo.sender_name ?? "")
        : channel.owner_name || channel.title,
```

4. Em `draftToFeedMessage`, a mesma inversão no `alvo`.

5. Onde `fixada` é lida pra miniatura da barra fixada, `normalizeMedia(fixada.media, fixada.media_url ?? null, fixada.media_type ?? null)`.

- [ ] **Step 5: Rodar o novo teste e o portão de regressão**

Run: `npx vitest run tests/lib/composer-row-defaults.test.tsx`
Expected: PASS, 3 testes.

Run: `npx vitest run tests/lib/social-proof-bubble.test.tsx tests/lib/social-proof-bubble-v2.test.tsx`
Expected: PASS **sem nenhuma edição nesses arquivos**. Se falharem, a inversão do `senderKind` ou algum default está errado — corrija o componente, nunca o teste.

- [ ] **Step 6: Commit**

```bash
git add lib/composer/types.ts components/dashboard/social-proof/feed-preview.tsx tests/lib/composer-row-defaults.test.tsx
git commit -m "refactor(composer): tipo neutro de linha com defaults para campos de prova social"
```

---

### Task 3: `ComposerShell` recebe actions e slots

**Files:**
- Create: `components/dashboard/composer/composer-shell.tsx` (movido de `components/dashboard/social-proof/composer-shell.tsx`)
- Create: `components/dashboard/social-proof/social-proof-extras.tsx`
- Modify: `components/dashboard/social-proof/composer.tsx`
- Modify: `components/dashboard/social-proof/message-editor.tsx`
- Delete: `components/dashboard/social-proof/composer-shell.tsx`

**Interfaces:**
- Consumes: `ComposerActions`, `ComposerMessageRow` da Task 2.
- Produces: `ComposerShell` com props `{ actions, messages, channel, title, subtitle, headerActions?, leftColumn, editorExtras?, messageBadge?, emptyEditorHint? }`. `MessageEditor` ganha a prop `extras?: ReactNode`.

- [ ] **Step 1: Extrair os campos exclusivos da Prova Social do `MessageEditor`**

Crie `components/dashboard/social-proof/social-proof-extras.tsx` e **mova pra lá** (recortando de `message-editor.tsx`) os blocos de *Visualizações*, *Há quanto tempo*, *Horário fixo* e *Reações* — as linhas 238-300 aproximadamente. O componente:

```tsx
"use client";

import type { MessageInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/** Paleta fixa. Um seletor completo de emoji é uma dependência inteira pra um
 *  caso em que sete opções cobrem quase tudo. */
const EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "🙏", "💎"];

export function SocialProofExtras({
  value,
  onChange,
}: {
  value: MessageInput;
  onChange: (v: MessageInput) => void;
}) {
  // ... o conteúdo recortado do message-editor, incluindo setReacao
}
```

`setReacao` vai junto — ele só serve a esses campos.

- [ ] **Step 2: Dar ao `MessageEditor` o slot de extras**

Em `components/dashboard/social-proof/message-editor.tsx`:

- adicione `extras?: ReactNode` às props (e `import type { ReactNode } from "react"`);
- onde estavam os blocos recortados, renderize `{extras}`;
- remova `EMOJIS` e `setReacao` do arquivo (foram embora com os campos).

O `MessageEditor` fica com o que é comum: tipo, texto, mídia, resposta, e os botões de ação do rodapé.

- [ ] **Step 3: Mover e generalizar o `ComposerShell`**

```bash
mkdir -p components/dashboard/composer
git mv components/dashboard/social-proof/composer-shell.tsx components/dashboard/composer/composer-shell.tsx
```

Em `components/dashboard/composer/composer-shell.tsx`:

1. **Remova** o import de `@/lib/actions/social-proof-actions` e o de `ChannelCard`/`OwnerCard`.
2. Troque a assinatura:

```tsx
export function ComposerShell({
  actions,
  messages,
  channel,
  title,
  subtitle,
  headerActions,
  leftColumn,
  leftColumnLabel = "Canal",
  editorExtras,
  messageBadge,
  emptyEditorHint = "Selecione ou crie uma mensagem para editar seus detalhes.",
}: {
  actions: ComposerActions;
  messages: ComposerMessageRow[];
  /** Identidade usada pelo cabeçalho da prévia. */
  channel: ChannelInput;
  title: string;
  subtitle: string;
  /** Botões do canto superior direito (Visualizar, Salvar, Publicar…). */
  headerActions?: ReactNode;
  /** Coluna 1. Prova Social passa ChannelCard+OwnerCard; campanha, os cards dela. */
  leftColumn: ReactNode;
  /** Rótulo da aba mobile da coluna 1. */
  leftColumnLabel?: string;
  /** Campos extras do editor, específicos da feature. */
  editorExtras?: (value: MessageInput, onChange: (v: MessageInput) => void) => ReactNode;
  /** Chip por mensagem no preview (status de envio, na campanha). */
  messageBadge?: (row: ComposerMessageRow) => ReactNode;
  emptyEditorHint?: string;
}) {
```

3. Substitua cada chamada direta por `actions.*`:

| Antes | Depois |
|---|---|
| `saveChannel(botId, canal)` | removido — vai pro `headerActions` de cada feature |
| `saveMessage(botId, rascunho)` | `actions.saveMessage(rascunho)` |
| `deleteMessage(id, botId)` | `actions.deleteMessage(id)` |
| `duplicateMessage(id, botId)` | `actions.duplicateMessage(id)` |
| `reorderMessages(botId, ids)` | `actions.reorderMessages(ids)` |
| `setPinnedMessage(botId, x)` | `actions.setPinned?.(x)` |

4. O estado `canal` (`useState<ChannelInput>`) sai do shell: quem edita identidade é a coluna esquerda de cada feature. O shell recebe `channel` como prop e repassa ao `FeedPreview`. As props `onPin` do `FeedPreview` e `onPin` do editor ficam condicionadas a `actions.setPinned` existir.

5. `pinnedId`/`pinnedText` viram props opcionais (`pinnedId?: string | null`, `pinnedText?: string`), com default `null`/`""` — a campanha não fixa nada pela UI.

6. Passe `editorExtras?.(rascunho, setRascunho)` como `extras` do `MessageEditor`.

7. A aba mobile "Canal" usa `leftColumnLabel`.

- [ ] **Step 4: Reamarrar a Prova Social no adaptador**

Reescreva `components/dashboard/social-proof/composer.tsx` para ser o adaptador. Ele passa a carregar o estado do canal (que saiu do shell), os cards e as actions:

```tsx
"use client";

import { useState } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
  duplicateMessage,
  setPinnedMessage,
  reorderMessages,
} from "@/lib/actions/social-proof-actions";
import { ComposerShell } from "@/components/dashboard/composer/composer-shell";
import { ChannelCard } from "@/components/dashboard/social-proof/channel-card";
import { OwnerCard } from "@/components/dashboard/social-proof/owner-card";
import { SocialProofExtras } from "@/components/dashboard/social-proof/social-proof-extras";

export function SocialProofComposer({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
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

  return (
    <ComposerShell
      title="Prova Social"
      subtitle="Monte a prévia do canal que aparecerá no seu Mini App."
      channel={canal}
      messages={messages}
      pinnedId={pinnedId}
      pinnedText={pinnedText}
      leftColumn={
        <>
          <ChannelCard value={canal} onChange={setCanal} />
          <OwnerCard value={canal} onChange={setCanal} />
        </>
      }
      editorExtras={(value, onChange) => (
        <SocialProofExtras value={value} onChange={onChange} />
      )}
      headerActions={/* link "Visualizar" + botão "Salvar" chamando saveChannel(botId, canal) */ null}
      actions={{
        saveMessage: (input: MessageInput) => saveMessage(botId, input),
        deleteMessage: (id) => deleteMessage(id, botId),
        duplicateMessage: (id) => duplicateMessage(id, botId),
        reorderMessages: (ids) => reorderMessages(botId, ids),
        setPinned: (id) => setPinnedMessage(botId, id),
      }}
    />
  );
}
```

Mova o JSX do link "Visualizar" e do botão "Salvar" (com o spinner do `AnimatePresence`) do shell antigo pra dentro deste `headerActions`, preservando as classes exatas. `app/dashboard/bots/[botId]/prova-social/page.tsx` **não muda uma linha**.

- [ ] **Step 5: Rodar o portão de regressão**

Run: `npm test`
Expected: PASS — os 25 arquivos de `tests/lib/`, **sem editar nenhum**.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erro.

- [ ] **Step 6: Verificar a Prova Social no navegador**

Suba com `npm run dev`, abra `/dashboard/bots/<id>/prova-social` e confirme: as três colunas, criar/editar/apagar/duplicar/fixar/reordenar mensagem, salvar o canal, e as abas mobile. Nada pode ter mudado de aparência ou comportamento.

- [ ] **Step 7: Commit**

```bash
git add -A components/dashboard/composer components/dashboard/social-proof
git commit -m "refactor(composer): shell genérico com actions injetadas e slots"
```

---

### Task 4: Server Actions da campanha

**Files:**
- Create: `app/dashboard/automations/scheduled/actions.ts`

**Interfaces:**
- Consumes: `accumulateSchedule` (Task 1); tabelas do Plano 1.
- Produces: `getScheduledCampaign`, `saveScheduledMessage`, `deleteScheduledMessage`, `duplicateScheduledMessage`, `reorderScheduledMessages`, `setCampaignDestination`, `setCampaignSchedule`, `toggleDiscarded`, `revertAiText`, `launchScheduledCampaign`, `pauseScheduledCampaign`, `listDestinationDialogs`.

Todas retornam `ActionResult` (ou dados, nas leituras). **Nenhuma faz `throw`.**

- [ ] **Step 1: Escrever o arquivo**

Crie `app/dashboard/automations/scheduled/actions.ts`. Estrutura, com as três de maior risco escritas por inteiro:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { accumulateSchedule } from "@/lib/composer/schedule";
import { validateMessage } from "@/lib/social-proof/validate-message";
import type { ActionResult, MessageInput } from "@/lib/social-proof/types";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";

function rota(campaignId: string): string {
  return `/dashboard/automations/scheduled/${campaignId}`;
}

export async function getScheduledCampaign(campaignId: string): Promise<{
  campaign: ScheduledCampaign | null;
  messages: ScheduledMessage[];
}> {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { campaign: null, messages: [] };

  const { data: messages } = await supabase
    .from("mtproto_scheduled_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    // Mesmo desempate da 071: sem created_at, position repetida faz a ordem da
    // tela divergir da ordem de envio.
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    campaign: campaign as ScheduledCampaign,
    messages: (messages ?? []) as ScheduledMessage[],
  };
}

/**
 * Só canal e supergrupo entram: promoteBotToAdmin monta Api.InputChannel, e
 * grupo legacy (peer_type 'chat') não tem InputChannel. Oferecer um destino
 * que o bot nunca conseguiria administrar seria prometer o que não se cumpre.
 */
export async function listDestinationDialogs(
  actingTenantId?: string,
): Promise<Array<{ id: string; label: string; accountId: string }>> {
  try {
    await requireAutomationsAccess();
    const tenantId = await resolveActingTenantId(actingTenantId);
    const supabase = await createClient();
    const { data } = await supabase
      .from("mtproto_dialogs")
      .select("id, title, username, kind, account_id, mtproto_accounts!inner(tenant_id)")
      .eq("mtproto_accounts.tenant_id", tenantId)
      .eq("peer_type", "channel")
      .in("kind", ["channel_owner", "group_admin"])
      .order("title", { ascending: true });
    return (data ?? []).map((d) => ({
      id: d.id as string,
      label: (d.title as string | null) ?? (d.username as string | null) ?? "(sem nome)",
      accountId: d.account_id as string,
    }));
  } catch {
    return [];
  }
}

export async function setCampaignDestination(
  campaignId: string,
  dialogId: string,
): Promise<ActionResult> {
  await requireAutomationsAccess();
  const supabase = await createClient();

  const { data: dialog } = await supabase
    .from("mtproto_dialogs")
    .select("id, peer_id, peer_access_hash, peer_type, title")
    .eq("id", dialogId)
    .maybeSingle();
  if (!dialog) return { ok: false, error: "Destino não encontrado." };
  if (dialog.peer_type !== "channel") {
    return {
      ok: false,
      error: "Só canal ou supergrupo pode ser destino — grupo comum não aceita bot como admin.",
    };
  }

  // Snapshot: o dialog pode sumir num sync futuro e o envio precisa do peer.
  const { data, error } = await supabase
    .from("mtproto_scheduled_campaigns")
    .update({
      dest_dialog_id: dialog.id,
      dest_channel_id: dialog.peer_id,
      dest_access_hash: dialog.peer_access_hash,
      dest_title: dialog.title,
    })
    .eq("id", campaignId)
    .select("id");
  if (error) return { ok: false, error: `Não deu pra salvar o destino: ${error.message}` };
  // Sem linha afetada o supabase-js NÃO devolve error: a RLS pode ter barrado
  // tudo e a action responderia { ok: true }, sucesso silencioso.
  if (!data || data.length === 0) {
    return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
  }

  revalidatePath(rota(campaignId));
  return { ok: true };
}

/**
 * Publica: calcula os horários absolutos e liga a campanha.
 *
 * A validação do bot como admin do destino NÃO acontece aqui — ela exige o
 * worker (o Next não fala MTProto). Quem confere e promove é
 * ensureBotAccess (Task 10), chamado pela tela antes do usuário publicar. Se
 * ele for pulado, o worker ainda recusa a primeira mensagem com erro legível
 * em vez de publicar em lugar nenhum.
 */
export async function launchScheduledCampaign(
  campaignId: string,
  startAtIso: string,
): Promise<ActionResult> {
  await requireAutomationsAccess();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select("id, dest_channel_id, dest_access_hash, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
  if (!campaign.dest_channel_id) {
    return { ok: false, error: "Escolha o canal de destino antes de publicar." };
  }
  if (campaign.status === "running") {
    return { ok: false, error: "Esta campanha já está publicando." };
  }

  const startAt = new Date(startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, error: "Horário de início inválido." };
  }

  const { data: rows } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id, delay_seconds, ai_discarded")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const agenda = accumulateSchedule(
    (rows ?? []).map((r) => ({
      id: r.id as string,
      delay_seconds: r.delay_seconds as number,
      ai_discarded: r.ai_discarded as boolean,
    })),
    startAt,
  );
  if (agenda.length === 0) {
    return { ok: false, error: "Não há nenhuma mensagem pendente pra publicar." };
  }

  for (const item of agenda) {
    const { error } = await supabase
      .from("mtproto_scheduled_messages")
      .update({ scheduled_at: item.scheduledAt.toISOString() })
      .eq("id", item.id)
      .eq("campaign_id", campaignId);
    if (error) return { ok: false, error: `Não deu pra agendar: ${error.message}` };
  }

  // Descartadas viram 'skipped' AGORA: deixá-las 'pending' faria o poller
  // enfileirá-las (elas não têm scheduled_at, mas um reprocessamento futuro
  // poderia dar), e o contador de progresso mentiria.
  await supabase
    .from("mtproto_scheduled_messages")
    .update({ status: "skipped" })
    .eq("campaign_id", campaignId)
    .eq("ai_discarded", true)
    .eq("status", "pending");

  const { error } = await supabase
    .from("mtproto_scheduled_campaigns")
    .update({
      status: "running",
      start_at: startAt.toISOString(),
      started_at: new Date().toISOString(),
      total_messages: agenda.length,
      last_error: null,
    })
    .eq("id", campaignId);
  if (error) return { ok: false, error: `Não deu pra publicar: ${error.message}` };

  revalidatePath(rota(campaignId));
  revalidatePath("/dashboard/automations");
  return { ok: true };
}
```

As demais seguem o padrão de `lib/actions/social-proof-actions.ts` — copie a forma de lá, trocando `bot_id` por `campaign_id`:

- `saveScheduledMessage(campaignId, input)` — valida com `validateMessage`, e no insert calcula `position` como `max+1` lendo do banco (nunca do cliente). Grava também `delay_seconds` e `silent`, que vêm no `MessageInput` estendido (ver Task 5).
- `deleteScheduledMessage(id, campaignId)` / `duplicateScheduledMessage(id, campaignId)` — com `.eq("campaign_id", campaignId)` além do id e checagem de linhas afetadas.
- `reorderScheduledMessages(campaignId, orderedIds)` — **copie inteira** a validação de permutação completa de `reorderMessages` (as três condições, incluindo a de unicidade), trocando o escopo.
- `setCampaignSchedule(campaignId, { startAt, defaultDelaySeconds })`.
- `toggleDiscarded(id, campaignId, discarded)` — inverte `ai_discarded`.
- `revertAiText(id, campaignId)` — `content_text = content_text_original`, `content_text_original = null`, `ai_action = 'none'`. Se `content_text_original` for null, devolve `{ ok: false, error: "Esta mensagem não foi alterada pela IA." }`.
- `pauseScheduledCampaign(campaignId)` — `status = 'paused'`. O poller para de enfileirar; o que já está na fila termina.

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/automations/scheduled/actions.ts
git commit -m "feat(campanhas): server actions da campanha de postagem agendada"
```

---

### Task 5: Cards e extras da campanha

**Files:**
- Create: `components/dashboard/campaigns/destination-card.tsx`
- Create: `components/dashboard/campaigns/schedule-card.tsx`
- Create: `components/dashboard/campaigns/campaign-extras.tsx`
- Create: `components/dashboard/campaigns/status-badge.tsx`
- Modify: `lib/social-proof/types.ts` (estender `MessageInput`)

**Interfaces:**
- Consumes: actions da Task 4; `accumulateSchedule` da Task 1.
- Produces: os quatro componentes, consumidos pela Task 6.

- [ ] **Step 1: Estender `MessageInput`**

Em `lib/social-proof/types.ts`, acrescente ao fim de `MessageInput`:

```ts
  /**
   * Campos da campanha agendada. Opcionais porque a Prova Social não os tem:
   * o mesmo MessageInput serve às duas features, e o composer não precisa
   * saber qual delas está montando a mensagem.
   */
  delay_seconds?: number;
  silent?: boolean;
  ai_discarded?: boolean;
  content_text_original?: string | null;
  ai_reason?: string | null;
```

Todos opcionais — nenhuma chamada existente quebra.

- [ ] **Step 2: `DestinationCard`**

Crie `components/dashboard/campaigns/destination-card.tsx`: um `<select>` populado por `listDestinationDialogs`, o nome do destino atual, e um aviso quando não há destino. Quando a lista vem vazia, a mensagem é específica em vez de um select vazio:

```tsx
        <p className="text-(--text-muted) text-xs">
          Nenhum canal elegível. O destino precisa ser um canal ou supergrupo
          onde uma das suas contas conectadas seja administradora.
        </p>
```

- [ ] **Step 3: `ScheduleCard`**

Crie `components/dashboard/campaigns/schedule-card.tsx`: `<input type="datetime-local">` pro início, um campo de delay padrão em minutos, e o resumo calculado — que usa a **mesma** `accumulateSchedule`, não uma soma feita à mão:

```tsx
  const agenda = accumulateSchedule(
    messages.map((m) => ({
      id: m.id,
      delay_seconds: m.delay_seconds,
      ai_discarded: m.ai_discarded,
    })),
    new Date(startAt),
  );
  const ultima = agenda.at(-1)?.scheduledAt ?? null;
```

E o botão "Publicar campanha", desabilitado sem destino, com o motivo em `title`.

- [ ] **Step 4: `CampaignExtras`**

Crie `components/dashboard/campaigns/campaign-extras.tsx` — o que entra no slot `editorExtras`:

- **Delay em minutos:** `value={Math.round((value.delay_seconds ?? 900) / 60)}`, gravando `delay_seconds: Math.max(0, Number(e.target.value) || 0) * 60`.
- **Silencioso:** checkbox ligado a `value.silent ?? true`, com hint "Publica sem tocar a notificação dos inscritos."
- **Toggle Original / IA:** só aparece quando `value.content_text_original` não é null. Dois botões e um "Reverter" que chama `revertAiText`.
- **Motivo do descarte:** quando `value.ai_discarded`, mostra `value.ai_reason` e um botão "Restaurar mensagem".
- Os três botões de assistente ficam **de fora deste plano** — Plano 3 os acrescenta aqui.

- [ ] **Step 5: `StatusBadge`**

Crie `components/dashboard/campaigns/status-badge.tsx`: um chip por status, cores do tema.

```tsx
const ROTULO: Record<string, { texto: string; classe: string }> = {
  pending: { texto: "pendente", classe: "text-(--text-muted) border-(--border-subtle)" },
  sending: { texto: "enviando", classe: "text-(--accent) border-(--accent)" },
  sent: { texto: "enviada", classe: "text-(--green) border-(--green)" },
  failed: { texto: "falhou", classe: "text-(--red) border-(--red)" },
  skipped: { texto: "descartada", classe: "text-(--text-muted) border-dashed border-(--border-default)" },
};
```

Confirme os nomes das variáveis de cor em `app/globals.css` antes de usar — `--green` pode não existir; se não existir, use a que o projeto já usa para sucesso.

- [ ] **Step 6: Verificar que compila e o lint passa**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/campaigns lib/social-proof/types.ts
git commit -m "feat(campanhas): cards de destino, agendamento e extras do editor"
```

---

### Task 6: A tela da campanha

**Files:**
- Create: `app/dashboard/automations/scheduled/[campaignId]/page.tsx`
- Create: `components/dashboard/campaigns/campaign-composer.tsx`
- Modify: `app/dashboard/automations/page.tsx`
- Modify: `app/dashboard/automations/clones/[cloneId]/page.tsx`

**Interfaces:**
- Consumes: `ComposerShell` (Task 3), actions (Task 4), cards (Task 5).
- Produces: a rota `/dashboard/automations/scheduled/[campaignId]`.

- [ ] **Step 1: A página**

Crie `app/dashboard/automations/scheduled/[campaignId]/page.tsx`, no padrão das outras páginas de automações:

```tsx
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { getScheduledCampaign } from "../actions";
import { CampaignComposer } from "@/components/dashboard/campaigns/campaign-composer";

export const dynamic = "force-dynamic";

export default async function ScheduledCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { campaignId } = await params;
  const { campaign, messages } = await getScheduledCampaign(campaignId);
  if (!campaign) notFound();

  return <CampaignComposer campaign={campaign} messages={messages} />;
}
```

`params` é uma `Promise` nesta versão do Next — as páginas vizinhas já fazem `await params`, siga o mesmo formato.

- [ ] **Step 2: O adaptador**

Crie `components/dashboard/campaigns/campaign-composer.tsx`, espelhando o `SocialProofComposer` da Task 3:

```tsx
"use client";

import { ComposerShell } from "@/components/dashboard/composer/composer-shell";
import { DestinationCard } from "./destination-card";
import { ScheduleCard } from "./schedule-card";
import { CampaignExtras } from "./campaign-extras";
import { StatusBadge } from "./status-badge";
import {
  saveScheduledMessage,
  deleteScheduledMessage,
  duplicateScheduledMessage,
  reorderScheduledMessages,
} from "@/app/dashboard/automations/scheduled/actions";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";
import type { ChannelInput } from "@/lib/social-proof/types";
```

Três pontos que exigem atenção:

1. **O `channel` da prévia vem do destino**, não de uma tabela de canal:

```tsx
  const canal: ChannelInput = {
    title: campaign.dest_title ?? "Escolha o destino",
    avatar_url: null,
    subscribers_label: "",
    is_verified: false,
    is_active: campaign.status === "running",
    owner_name: campaign.dest_title ?? "",
    owner_avatar_url: null,
    owner_username: "",
    unread_badge: 0,
  };
```

2. **`offset_seconds` é derivado, não persistido.** É o que faz o `FeedPreview` desenhar os horários certos sem saber que está olhando uma campanha:

```tsx
  const agora = Date.now();
  const linhas = messages.map((m) => ({
    ...m,
    // FeedPreview desenha o horário a partir de "há quantos segundos".
    // Uma postagem futura tem offset negativo, e o formatador do Telegram
    // já lida com isso — o que importa é a distância, não o sinal.
    offset_seconds: m.scheduled_at
      ? Math.round((agora - new Date(m.scheduled_at).getTime()) / 1000)
      : 0,
  }));
```

3. **`setPinned` não é passado**: a campanha não fixa pela UI (o `is_pinned` vem do clone). Omitir a prop faz o shell esconder o botão de fixar, que é o comportamento certo.

- [ ] **Step 2b: Chip de documento de verdade (dívida carregada da Task 2)**

A Task 2 resolveu o `kind: "document"` do jeito que dava dentro dos arquivos dela: prefixando `📄 <nome do arquivo>` no `contentText`. Isso tirou o `<img>` quebrado, mas cria uma quebra de fidelidade — a prévia passa a exibir uma linha de texto que o post real no Telegram **não terá**, numa tela cuja promessa inteira é "isto é exatamente o que vai ser publicado". Aqui os componentes de bolha estão no escopo, então é aqui que se paga.

Substitua o prefixo em texto por um elemento visual: em `components/telegram/message-bubble.tsx` (ou no `media-container.tsx`, onde couber no desenho existente), uma linha com ícone de arquivo genérico e o nome vindo de `file_name`, no estilo do anexo de documento do Telegram. Remova a concatenação no `contentText` de `feed-preview.tsx` — o `contentText` volta a ser só a legenda real.

Mantenha o teste que a Task 2 criou em `tests/lib/composer-row-defaults.test.tsx` passando: ajuste a asserção para procurar o elemento novo em vez do texto `📄`, mas **não** afrouxe o que ela prova — que uma linha `document` nunca vira `<img>` e que o nome do arquivo aparece.

- [ ] **Step 2c: Abrir o slot de badge por bolha (dívida carregada da Task 3)**

A Task 3 declarou `messageBadge` no contrato de props do `ComposerShell`, mas **não o renderiza**: `FeedPreview` e `ChannelFeed` não têm ponto de extensão por bolha, e abri-lo estava fora da lista de arquivos daquela task. Hoje é uma prop que não faz nada — exatamente o tipo de contrato pendurado que engana quem lê o tipo.

Abra o slot: `FeedPreview` repassa `messageBadge` para `ChannelFeed`, que o chama por mensagem e renderiza o retorno junto da bolha (o chip de status da campanha: pendente / enviando / enviada / falhou / descartada). Quando a prop não é passada — que é o caso da Prova Social — nada muda no DOM. Prove isso: os 8 testes de `tests/lib/social-proof-*` continuam passando sem edição.

- [ ] **Step 3: Card na página de automações**

Em `app/dashboard/automations/page.tsx`, acrescente a query e o `CardShell`, copiando o formato do bloco "Clonagem":

```tsx
  let scheduledQuery = supabase
    .from("mtproto_scheduled_campaigns")
    .select("id, name, status, dest_title, total_messages, sent_count, failed_count, start_at")
    .order("created_at", { ascending: false });
  if (viewTenantId) scheduledQuery = scheduledQuery.eq("tenant_id", viewTenantId);
```

Some `scheduledQuery` ao `Promise.all` existente e renderize um `CardShell` com `title="Postagens agendadas"`, `subtitle="conteúdo contínuo em canal"`, `icon={icons.megaphone}` (ou o mais próximo disponível em `analytics/icons`), listando nome, destino e `sent_count/total_messages`.

- [ ] **Step 3b: Criar campanha do zero**

Nem toda campanha nasce de um clone — o dono pode querer montar uma sequência à mão. Acrescente a action em `app/dashboard/automations/scheduled/actions.ts`:

```ts
export async function createEmptyCampaign(
  actingTenantId?: string,
): Promise<{ ok: true; campaignId: string } | { ok: false; error: string }> {
  await requireAutomationsAccess();
  const tenantId = await resolveActingTenantId(actingTenantId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mtproto_scheduled_campaigns")
    .insert({ tenant_id: tenantId, name: "Nova campanha", status: "draft" })
    .select("id")
    .single();
  if (error) return { ok: false, error: `Não deu pra criar a campanha: ${error.message}` };
  revalidatePath("/dashboard/automations");
  return { ok: true, campaignId: data.id };
}
```

E crie `app/dashboard/automations/scheduled/new/page.tsx`, que cria e redireciona — não há formulário a preencher, porque destino e agendamento são editados na própria tela da campanha:

```tsx
import { notFound, redirect } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { createEmptyCampaign } from "../actions";

export const dynamic = "force-dynamic";

type SP = { [key: string]: string | string[] | undefined };

export default async function NovaCampanhaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : undefined;

  const r = await createEmptyCampaign(view);
  if (!r.ok) notFound();
  redirect(`/dashboard/automations/scheduled/${r.campaignId}`);
}
```

`redirect()` lança por dentro — não o coloque dentro de um `try/catch`, ou o Next trata o redirect como erro.

No `CardShell` do Step 3, some o botão, no mesmo formato dos outros cards da página:

```tsx
          right={
            canCreate && (
              <a
                href={`/dashboard/automations/scheduled/new${createQuery}`}
                className="btn-primary text-xs px-4 py-2"
              >
                Nova campanha
              </a>
            )
          }
```

Não crie uma rota `scheduled/page.tsx` separada só pra listar: o `CardShell` na página de automações já é a lista, no mesmo lugar em que o dono procura clones e campanhas de Mass DM.

- [ ] **Step 4: "Abrir rascunho" na tela do clone**

Em `app/dashboard/automations/clones/[cloneId]/page.tsx`, inclua `mode, draft_campaign_id` no `select` e renderize o link quando existir:

```tsx
      {clone.mode === "draft" && clone.draft_campaign_id && (
        <a
          href={`/dashboard/automations/scheduled/${clone.draft_campaign_id}`}
          className="btn-primary text-xs px-4 py-2"
        >
          Abrir rascunho
        </a>
      )}
```

- [ ] **Step 5: Fechar o redirect do formulário**

Em `components/dashboard/clone-form.tsx`, o Plano 1 deixou o redirect apontando pra tela do clone com um comentário dizendo que a tela da campanha só existiria a partir daqui. Agora existe:

```tsx
      if (r.ok) {
        router.push(
          r.draftCampaignId
            ? `/dashboard/automations/scheduled/${r.draftCampaignId}`
            : `/dashboard/automations/clones/${r.cloneJobId}`,
        );
      }
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: tudo passa, `tests/lib/` sem edição.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/automations components/dashboard/campaigns components/dashboard/clone-form.tsx
git commit -m "feat(campanhas): tela de edição e agendamento da campanha"
```

---

### Task 7: Worker de disparo

**Files:**
- Create: `server/src/workers/scheduled-campaign-handler.ts`
- Modify: `server/src/queue-mtproto.ts`
- Modify: `server/src/workers/mtproto-worker.ts` (o `switch` de `startMtprotoWorker`)
- Test: `server/tests/services/scheduled-send.test.ts`

**Interfaces:**
- Consumes: tabelas do Plano 1; `CompanionBot` de `services/mtproto/clone/bot-client.js`.
- Produces: `MtprotoJobData` ganha `{ kind: "postcampaign.send-one"; messageId: string }`; `export async function handleScheduledSend(messageId: string): Promise<void>`; `export function nextFloodSchedule(...)` (pura, testada).

O núcleo testável é a **matemática do reagendamento pós-flood** — é ela que decide se a campanha mantém a cadência ou despeja tudo de uma vez.

- [ ] **Step 1: Escrever o teste que falha**

Crie `server/tests/services/scheduled-send.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextFloodSchedule } from "../../src/workers/scheduled-campaign-handler.js";

const AGORA = new Date("2026-09-10T12:00:00.000Z");

describe("nextFloodSchedule", () => {
  it("a mensagem que bateu flood volta pra depois da espera, com folga de 5s", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 60, pendentes: [] });
    expect(r.retryAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });

  it("as seguintes são empurradas pelo MESMO delta, preservando a cadência", () => {
    // Sem o empurrão, a fila inteira vence durante o flood e o bot despeja
    // tudo de uma vez quando ele passa — que é o que queima a conta.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [
        { id: "b", scheduledAt: new Date("2026-09-10T12:10:00.000Z") },
        { id: "c", scheduledAt: new Date("2026-09-10T12:20:00.000Z") },
      ],
    });
    expect(r.empurradas).toEqual([
      { id: "b", scheduledAt: new Date("2026-09-10T12:11:05.000Z") },
      { id: "c", scheduledAt: new Date("2026-09-10T12:21:05.000Z") },
    ]);
  });

  it("não empurra nada quando não há pendentes depois", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 30, pendentes: [] });
    expect(r.empurradas).toEqual([]);
  });

  it("uma pendente que já estava atrasada é empurrada a partir de agora, não do passado", () => {
    // Sem esse piso, uma mensagem já vencida continuaria vencida depois do
    // flood e sairia junto com a que acabou de ser reagendada.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [{ id: "b", scheduledAt: new Date("2026-09-10T11:50:00.000Z") }],
    });
    expect(r.empurradas[0].scheduledAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/scheduled-send.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar a função pura e o handler**

Crie `server/src/workers/scheduled-campaign-handler.ts`:

```ts
import path from "node:path";
import os from "node:os";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { CompanionBot } from "../services/mtproto/clone/bot-client.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";
import type { Api } from "telegram";

/** Tentativas antes de desistir de uma mensagem. */
const MAX_ATTEMPTS = 3;

/** Janela de obsolescência do claim, mesmo padrão de clone-handler. */
export const SEND_CLAIM_STALE_MS = 10 * 60 * 1000;

export interface FloodInput {
  now: Date;
  waitSeconds: number;
  /** Pendentes da MESMA campanha, com scheduled_at futuro ou passado. */
  pendentes: Array<{ id: string; scheduledAt: Date }>;
}

/**
 * Reagendamento após FLOOD_WAIT.
 *
 * O ponto não óbvio: empurrar SÓ a mensagem que bateu no flood faz a fila
 * inteira vencer durante a espera, e quando ela passa o bot publica tudo de
 * uma vez — exatamente o comportamento que queima a conta. O delta é aplicado
 * a todas as pendentes, com piso em `retryAt` pra que uma já atrasada não saia
 * junto da reagendada.
 */
export function nextFloodSchedule(input: FloodInput): {
  retryAt: Date;
  empurradas: Array<{ id: string; scheduledAt: Date }>;
} {
  const deltaMs = (input.waitSeconds + 5) * 1000;
  const retryAt = new Date(input.now.getTime() + deltaMs);
  const empurradas = input.pendentes.map((p) => ({
    id: p.id,
    scheduledAt: new Date(Math.max(p.scheduledAt.getTime() + deltaMs, retryAt.getTime())),
  }));
  return { retryAt, empurradas };
}

export async function handleScheduledSend(messageId: string): Promise<void> {
  // 1) Claim CAS. Sem linha de volta, outro worker pegou (ou já não é pending).
  const { data: claimed } = await supabase
    .from("mtproto_scheduled_messages")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!claimed) {
    console.log(`[postcampaign] mensagem ${messageId} não reivindicada, ignorando`);
    return;
  }

  const { data: campaign } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select("*")
    .eq("id", claimed.campaign_id)
    .single();
  if (!campaign || campaign.status !== "running") {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ status: "pending", claimed_at: null })
      .eq("id", messageId);
    return;
  }

  const { data: botRow } = await supabase
    .from("automation_bots")
    .select("token, username, status")
    .eq("tenant_id", campaign.tenant_id)
    .single();
  if (!botRow || botRow.status !== "active") {
    await falhar(messageId, campaign.id, "bot companheiro não cadastrado ou inválido");
    return;
  }

  const bot = new CompanionBot(
    botRow.token,
    CompanionBot.destChatIdFromChannelId(campaign.dest_channel_id as string),
    null,
    { apiId: config.telegramApiId, apiHash: config.telegramApiHash },
  );
  const tmpDir = path.join(os.tmpdir(), "eaglebot-postcampaign", messageId);

  try {
    const destMsgId = await publicar(bot, claimed, tmpDir);
    await supabase
      .from("mtproto_scheduled_messages")
      .update({
        status: "sent",
        dest_msg_id: destMsgId,
        sent_at: new Date().toISOString(),
        claimed_at: null,
        error_message: null,
      })
      .eq("id", messageId);
    await incrementar(campaign.id, "sent");
    if (claimed.is_pinned) {
      await bot.pin(destMsgId).catch((e) => console.warn("[postcampaign] pin falhou:", e));
    }
    await concluirSeUltima(campaign.id);
  } catch (err) {
    const wait = extractWaitSeconds(err);
    if (wait !== null) {
      await reagendarPorFlood(messageId, campaign.id, wait);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const tentativas = (claimed.attempts as number) + 1;
    if (tentativas >= MAX_ATTEMPTS) {
      await falhar(messageId, campaign.id, msg);
    } else {
      // Volta pra pending com uma tentativa a mais contabilizada; o poller
      // reenfileira no próximo tick porque scheduled_at já venceu.
      await supabase
        .from("mtproto_scheduled_messages")
        .update({ status: "pending", claimed_at: null, attempts: tentativas, error_message: msg })
        .eq("id", messageId);
    }
  } finally {
    await bot.disconnect().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

E os auxiliares no mesmo arquivo:

```ts
/** Baixa uma URL pública do Storage pro disco, pro InputFile do grammy. */
async function baixar(url: string, dir: string, nome: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download da mídia falhou (${res.status}): ${url}`);
  const destino = path.join(dir, nome);
  await writeFile(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}

async function publicar(
  bot: CompanionBot,
  row: Record<string, unknown>,
  tmpDir: string,
): Promise<number> {
  const texto = (row.content_text as string | null) ?? "";
  const entities = (row.entities as Api.TypeMessageEntity[] | null) ?? undefined;
  const inlineLinks = (row.inline_links as Array<{ label: string; url: string }> | null) ?? undefined;
  const silent = row.silent !== false;
  const opts = { entities, inlineLinks, silent };
  const media = (row.media as Array<{ url: string; type: string }>) ?? [];

  switch (row.kind as string) {
    case "text":
      return bot.publishText(texto, opts);

    case "poll": {
      const poll = row.poll as {
        question: string;
        options: string[];
        isAnonymous: boolean;
        allowsMultipleAnswers: boolean;
      };
      return bot.publishPoll(poll, { silent });
    }

    case "album": {
      const itens = [];
      for (let i = 0; i < media.length; i++) {
        itens.push({
          filePath: await baixar(media[i].url, tmpDir, `item_${i}`),
          kind: media[i].type === "video" ? ("video" as const) : ("photo" as const),
          caption: i === 0 ? texto : "",
          entities: i === 0 ? entities : undefined,
        });
      }
      const ids = await bot.publishAlbum(itens, { silent });
      if (ids.length === 0) throw new Error("álbum publicado sem devolver id");
      return ids[0];
    }

    default: {
      // photo | video | audio | document
      const item = media[0];
      if (!item) throw new Error(`mensagem ${row.kind} sem mídia gravada`);
      const nome = (row.file_name as string | null) ?? `arquivo_${row.id}`;
      const filePath = await baixar(item.url, tmpDir, nome);
      const kind =
        row.kind === "video" ? "video" : row.kind === "audio" ? "audio" : row.kind === "document" ? "document" : "photo";
      return bot.publishMedia(filePath, kind, texto, { ...opts, fileName: nome });
    }
  }
}

async function reagendarPorFlood(
  messageId: string,
  campaignId: string,
  waitSeconds: number,
): Promise<void> {
  const { data: pendentes } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id, scheduled_at")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .not("scheduled_at", "is", null);

  const { retryAt, empurradas } = nextFloodSchedule({
    now: new Date(),
    waitSeconds,
    pendentes: (pendentes ?? []).map((p) => ({
      id: p.id as string,
      scheduledAt: new Date(p.scheduled_at as string),
    })),
  });

  await supabase
    .from("mtproto_scheduled_messages")
    .update({
      status: "pending",
      claimed_at: null,
      scheduled_at: retryAt.toISOString(),
      error_message: `flood_wait_${waitSeconds}s`,
    })
    .eq("id", messageId);

  for (const e of empurradas) {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ scheduled_at: e.scheduledAt.toISOString() })
      .eq("id", e.id);
  }
  console.warn(
    `[postcampaign] flood de ${waitSeconds}s na campanha ${campaignId}: ${empurradas.length} mensagens empurradas`,
  );
}

async function falhar(messageId: string, campaignId: string, erro: string): Promise<void> {
  await supabase
    .from("mtproto_scheduled_messages")
    .update({ status: "failed", error_message: erro, claimed_at: null })
    .eq("id", messageId);
  await incrementar(campaignId, "failed");
  await concluirSeUltima(campaignId);
}

async function incrementar(campaignId: string, kind: "sent" | "failed"): Promise<void> {
  const coluna = kind === "sent" ? "sent_count" : "failed_count";
  const { data } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select(coluna)
    .eq("id", campaignId)
    .single();
  const atual = ((data as Record<string, number> | null)?.[coluna] ?? 0) + 1;
  await supabase
    .from("mtproto_scheduled_campaigns")
    .update({ [coluna]: atual })
    .eq("id", campaignId);
}

/** Sem nenhuma pendente nem enviando, a campanha acabou. */
async function concluirSeUltima(campaignId: string): Promise<void> {
  const { count } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "sending"]);
  if ((count ?? 0) > 0) return;
  await supabase
    .from("mtproto_scheduled_campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", campaignId);
}
```

`publishText`, `publishMedia`, `publishAlbum` e `publishPoll` precisam aceitar `silent` — a Task 8 faz isso. Escreva o handler já passando; ele compila porque `PublishOptions` ganha o campo lá.

- [ ] **Step 4: Registrar o job kind**

Em `server/src/queue-mtproto.ts`, acrescente ao union `MtprotoJobData`:

```ts
  | { kind: "postcampaign.send-one"; messageId: string }
```

Em `server/src/workers/mtproto-worker.ts`, no `switch`:

```ts
        case "postcampaign.send-one":
          return handleScheduledSend(d.messageId);
```

com o import correspondente.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/scheduled-send.test.ts`
Expected: PASS, 4 testes.

Run: `cd server && npx tsc --noEmit`
Expected: sem erro (depois da Task 8, se `silent` acusar; faça as duas antes de checar).

- [ ] **Step 6: Commit**

```bash
git add server/src/workers/scheduled-campaign-handler.ts server/src/queue-mtproto.ts server/src/workers/mtproto-worker.ts server/tests/services/scheduled-send.test.ts
git commit -m "feat(campanhas): worker que publica uma mensagem agendada por job"
```

---

### Task 8: `PublishOptions` aprende `silent`

**Files:**
- Modify: `server/src/services/mtproto/clone/bot-client.ts`
- Test: `server/tests/services/clone-bot-client.test.ts`

**Interfaces:**
- Produces: `PublishOptions.silent?: boolean` (default `true`); `publishAlbum` e `publishPoll` ganham `silent?: boolean` nos seus `opts`.

Hoje os cinco métodos cravam `disable_notification: true`. É o certo pro clone — 500 posts de uma vez não podem tocar 500 vezes — e o errado pra campanha de conteúdo, onde a notificação é o ponto.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `server/tests/services/clone-bot-client.test.ts` (use o formato de fake da Bot API que já existe no arquivo):

```ts
it("silent:false publica com notificação; o default continua silencioso", async () => {
  const chamadas: Array<Record<string, unknown>> = [];
  const bot = botComApiFake(chamadas); // helper já existente no arquivo

  await bot.publishText("com som", { silent: false });
  await bot.publishText("sem som", {});

  expect(chamadas[0].disable_notification).toBe(false);
  expect(chamadas[1].disable_notification).toBe(true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-bot-client.test.ts`
Expected: FAIL — a primeira chamada recebe `true`.

- [ ] **Step 3: Implementar**

Em `PublishOptions`, acrescente:

```ts
  /**
   * `false` publica com notificação. Default true: o clone despeja centenas
   * de posts de uma vez e não pode tocar o celular dos inscritos a cada um.
   * A campanha de conteúdo passa false, onde a notificação é o objetivo.
   */
  silent?: boolean;
```

E em cada um dos cinco métodos, troque `disable_notification: true` por `disable_notification: opts.silent !== false`. Em `publishAlbum` e `publishPoll`, acrescente `silent?: boolean` ao tipo do `opts` e faça o mesmo.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npm test`
Expected: suite VERDE. O `server/` roda 53 arquivos e o root 41 (contagem de 2026-09-10; ela sobe conforme o plano avança, entao compare com a sua baseline, nao com este numero) — qualquer suite que falhe ou nao carregue e regressao SUA, nao condicao pre-existente. (Ate 2026-09-10 tres suites de `tests/engine/*` nao carregavam por falta de SUPABASE_URL; isso foi corrigido em `ac945ad` e nao deve ser usado como desculpa.)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/bot-client.ts server/tests/services/clone-bot-client.test.ts
git commit -m "feat(bot): PublishOptions.silent, default silencioso como o clone espera"
```

---

### Task 9: Poller e limpeza do Storage

**Files:**
- Modify: `server/src/queue.ts` (dentro de `startWorkers`, junto do poller de recorrência em ~`:472`)

**Interfaces:**
- Consumes: `enqueueMtproto` com o kind da Task 7.
- Produces: nada consumido adiante.

- [ ] **Step 1: Escrever o poller**

Em `server/src/queue.ts`, logo depois do bloco `[mtproto-recurrent]`:

```ts
  // Campanhas de postagem agendada: enfileira o que venceu.
  //
  // NO MÁXIMO UMA MENSAGEM POR CAMPANHA POR TICK. Não é detalhe de
  // performance: o worker roda com concurrency 4, e enfileirar duas da mesma
  // campanha permite que a segunda seja publicada antes da primeira.
  let scheduledPostsRunning = false;
  setInterval(() => {
    if (scheduledPostsRunning) return;
    scheduledPostsRunning = true;
    (async () => {
      try {
        const { data: campanhas } = await supabase
          .from("mtproto_scheduled_campaigns")
          .select("id")
          .eq("status", "running")
          .limit(50);
        if (!campanhas || campanhas.length === 0) return;

        const { enqueueMtproto } = await import("./queue-mtproto.js");
        const agora = new Date().toISOString();
        for (const c of campanhas) {
          const { data: due } = await supabase
            .from("mtproto_scheduled_messages")
            .select("id")
            .eq("campaign_id", c.id)
            .eq("status", "pending")
            .not("scheduled_at", "is", null)
            .lte("scheduled_at", agora)
            .order("scheduled_at", { ascending: true })
            .limit(1);
          if (!due || due.length === 0) continue;
          await enqueueMtproto({ kind: "postcampaign.send-one", messageId: due[0].id });
        }
      } catch (err) {
        console.error("[postcampaign-poller] Error:", err);
      } finally {
        scheduledPostsRunning = false;
      }
    })();
  }, 30_000);

  // Claim órfão: um worker que morreu no meio deixa a mensagem em 'sending'
  // pra sempre, e o poller acima nunca a reenfileira (ele só olha 'pending').
  setInterval(() => {
    (async () => {
      const limite = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("mtproto_scheduled_messages")
        .update({ status: "pending", claimed_at: null })
        .eq("status", "sending")
        .lt("claimed_at", limite)
        .select("id");
      if (data && data.length > 0) {
        console.warn(`[postcampaign-sweep] ${data.length} claims órfãos devolvidos pra pending`);
      }
    })().catch((err) => console.error("[postcampaign-sweep] Error:", err));
  }, 5 * 60 * 1000);
```

- [ ] **Step 2: Limpar a mídia do Storage das campanhas concluídas**

Sem isso, um clone de 500 mensagens com vídeo deixa GB no bucket `media` pra sempre — o risco de custo registrado no spec §11. Depois de a campanha completar, os arquivos já foram publicados no Telegram e não servem mais a ninguém.

Ainda em `server/src/queue.ts`, dentro de `startWorkers`:

```ts
  // Limpeza da mídia de campanhas concluídas. Roda 1x por dia e só toca em
  // campanha completed há mais de 7 dias: a janela existe pra o dono ainda
  // conseguir olhar o rascunho publicado antes de as prévias sumirem.
  //
  // Só apaga o que veio de clone (prefixo `campaign/`), nunca mídia que o
  // usuário subiu à mão pela biblioteca — media_assets vive no mesmo bucket.
  async function limparMidiaDeCampanhas(): Promise<void> {
    const corte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: campanhas } = await supabase
      .from("mtproto_scheduled_campaigns")
      .select("id, tenant_id, source_clone_job_id")
      .eq("status", "completed")
      .lt("completed_at", corte)
      .not("source_clone_job_id", "is", null)
      .limit(20);
    if (!campanhas || campanhas.length === 0) return;

    for (const c of campanhas) {
      const pasta = `${c.tenant_id}/campaign/${c.source_clone_job_id}`;
      const { data: arquivos } = await supabase.storage.from("media").list(pasta);
      if (!arquivos || arquivos.length === 0) continue;
      const { error } = await supabase.storage
        .from("media")
        .remove(arquivos.map((a) => `${pasta}/${a.name}`));
      if (error) {
        console.error(`[postcampaign-cleanup] falha em ${pasta}: ${error.message}`);
        continue;
      }
      // Marca a campanha pra não varrer a mesma pasta todo dia pra sempre.
      await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ source_clone_job_id: null })
        .eq("id", c.id);
      console.log(`[postcampaign-cleanup] ${arquivos.length} arquivos removidos de ${pasta}`);
    }
  }
  setInterval(() => {
    limparMidiaDeCampanhas().catch((err) =>
      console.error("[postcampaign-cleanup] Error:", err),
    );
  }, 24 * 60 * 60 * 1000);
  setTimeout(() => {
    limparMidiaDeCampanhas().catch(() => {});
  }, 120_000);
```

O `source_clone_job_id = null` no fim é o que evita a varredura eterna, e é seguro: depois de a mídia sumir, o vínculo com o job de clone não serve mais pra nada — o `clone_jobs` continua lá, com o próprio histórico.

- [ ] **Step 3: Verificar que compila**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: suite VERDE. O `server/` roda 53 arquivos e o root 41 (contagem de 2026-09-10; ela sobe conforme o plano avança, entao compare com a sua baseline, nao com este numero) — qualquer suite que falhe ou nao carregue e regressao SUA, nao condicao pre-existente. (Ate 2026-09-10 tres suites de `tests/engine/*` nao carregavam por falta de SUPABASE_URL; isso foi corrigido em `ac945ad` e nao deve ser usado como desculpa.)

- [ ] **Step 4: Commit**

```bash
git add server/src/queue.ts
git commit -m "feat(campanhas): poller de disparo, sweep de claims e limpeza de mídia"
```

---

### Task 10: Acesso do bot ao destino

**Files:**
- Create: `server/src/services/mtproto/ensure-bot-access.ts`
- Modify: `server/src/index.ts` (rota nova, junto de `/api/mtproto/enqueue`)
- Modify: `app/dashboard/automations/scheduled/actions.ts`
- Modify: `components/dashboard/campaigns/destination-card.tsx`
- Test: `server/tests/services/ensure-bot-access.test.ts`

**Interfaces:**
- Consumes: `promoteBotToAdmin` de `services/mtproto/client.js`.
- Produces: `export async function ensureBotAccess(deps, input): Promise<BotAccessResult>`; `POST /api/mtproto/ensure-bot-access`; Server Action `ensureBotAccessOnDestination(campaignId)`.

O bot publica, mas quem consegue promovê-lo é a **conta MTProto dona do dialog** — o Next não fala MTProto, então isso mora no worker. Sem esta task, o usuário só descobre que o bot não é admin quando a primeira mensagem falha, minutos ou horas depois de publicar.

- [ ] **Step 1: Escrever o teste que falha**

Crie `server/tests/services/ensure-bot-access.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ensureBotAccess } from "../../src/services/mtproto/ensure-bot-access.js";

function deps(over: Record<string, unknown> = {}) {
  return {
    promote: vi.fn(async () => {}),
    ...over,
  } as Parameters<typeof ensureBotAccess>[0];
}

const input = {
  channelId: "123",
  accessHash: "456",
  botUsername: "meubot",
};

describe("ensureBotAccess", () => {
  it("promoção bem-sucedida devolve ok", async () => {
    const d = deps();
    expect(await ensureBotAccess(d, input)).toEqual({ ok: true });
    expect(d.promote).toHaveBeenCalledWith("123", "456", "meubot");
  });

  it("bot já admin (NOT_MODIFIED) conta como sucesso", async () => {
    // promoteBotToAdmin já tolera USER_ALREADY_PARTICIPANT e USER_BOT por
    // dentro; NOT_MODIFIED sobe, e repromover quem já é admin é sucesso.
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("400: NOT_MODIFIED");
      }),
    });
    expect(await ensureBotAccess(d, input)).toEqual({ ok: true });
  });

  it("privacidade de grupo ligada no bot vira erro acionável", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("400: BOT_GROUPS_BLOCKED");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/BotFather/i);
  });

  it("conta sem direito de promover vira erro acionável", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("403: RIGHT_FORBIDDEN");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/administrador/i);
  });

  it("erro desconhecido não é engolido: volta com a mensagem original", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("500: ALGO_ESTRANHO");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ALGO_ESTRANHO");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/ensure-bot-access.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar o núcleo**

Crie `server/src/services/mtproto/ensure-bot-access.ts`:

```ts
/**
 * Garante que o bot companheiro é admin do canal de destino de uma campanha.
 *
 * Quem promove é a conta MTProto dona do dialog — o Next não fala MTProto, e
 * o bot não consegue se auto-promover. Roda antes de publicar pra o dono não
 * descobrir o problema só quando a primeira postagem falha.
 */

export interface EnsureBotAccessDeps {
  promote(channelId: string, accessHash: string, botUsername: string): Promise<void>;
}

export type BotAccessResult = { ok: true } | { ok: false; error: string };

/** O bot já estava lá com os direitos certos: repromover não muda nada. */
const JA_ADMIN = /NOT_MODIFIED/i;

/**
 * Erros com causa conhecida e ação clara pro dono. Qualquer outro sobe com a
 * mensagem original — inventar texto amigável pra erro desconhecido esconde a
 * causa de quem poderia consertar.
 */
const CONHECIDOS: Array<{ padrao: RegExp; mensagem: string }> = [
  {
    padrao: /BOT_GROUPS_BLOCKED/i,
    mensagem:
      "O bot está com a privacidade de grupo ligada. Abra o BotFather, vá em Bot Settings › Group Privacy e desligue, depois tente de novo.",
  },
  {
    padrao: /RIGHT_FORBIDDEN|CHAT_ADMIN_REQUIRED/i,
    mensagem:
      "A conta conectada não tem permissão para promover administradores neste canal. Use uma conta que seja administradora com direito de adicionar admins.",
  },
  {
    padrao: /CHANNEL_INVALID|CHANNEL_PRIVATE/i,
    mensagem:
      "A conta conectada não enxerga mais este canal. Sincronize os diálogos da conta e escolha o destino de novo.",
  },
  {
    padrao: /USER_ADMIN_INVALID/i,
    mensagem:
      "O Telegram recusou a promoção do bot neste canal. Adicione o bot como administrador manualmente e tente publicar de novo.",
  },
];

export async function ensureBotAccess(
  deps: EnsureBotAccessDeps,
  input: { channelId: string; accessHash: string; botUsername: string },
): Promise<BotAccessResult> {
  try {
    await deps.promote(input.channelId, input.accessHash, input.botUsername);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (JA_ADMIN.test(msg)) return { ok: true };
    for (const c of CONHECIDOS) {
      if (c.padrao.test(msg)) return { ok: false, error: c.mensagem };
    }
    return { ok: false, error: `Não deu pra promover o bot: ${msg}` };
  }
}
```

- [ ] **Step 4: A rota no worker**

Em `server/src/index.ts`, junto de `/api/mtproto/enqueue`:

```ts
// Promove o bot companheiro a admin do canal de destino de uma campanha,
// usando a conta MTProto dona do dialog. Síncrono de propósito: a tela espera
// a resposta pra dizer ao dono se ele já pode publicar.
app.post("/api/mtproto/ensure-bot-access", async (req, res) => {
  try {
    const { campaignId } = req.body as { campaignId?: string };
    if (!campaignId) {
      res.status(400).json({ error: "campaignId ausente" });
      return;
    }

    const { data: campaign } = await supabase
      .from("mtproto_scheduled_campaigns")
      .select("id, tenant_id, dest_channel_id, dest_access_hash, dest_dialog_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign?.dest_channel_id || !campaign.dest_access_hash) {
      res.json({ ok: false, error: "Escolha o canal de destino antes." });
      return;
    }

    const { data: dialog } = await supabase
      .from("mtproto_dialogs")
      .select("account_id")
      .eq("id", campaign.dest_dialog_id)
      .maybeSingle();
    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("session_string, status")
      .eq("id", dialog?.account_id)
      .maybeSingle();
    if (!account?.session_string || account.status !== "active") {
      res.json({ ok: false, error: "A conta dona deste canal não está conectada." });
      return;
    }

    const { data: botRow } = await supabase
      .from("automation_bots")
      .select("username, status")
      .eq("tenant_id", campaign.tenant_id)
      .maybeSingle();
    if (!botRow || botRow.status !== "active") {
      res.json({ ok: false, error: "Cadastre o bot companheiro antes de publicar." });
      return;
    }

    const client = new MtprotoClient(
      config.telegramApiId,
      config.telegramApiHash,
      account.session_string,
    );
    try {
      await client.connect();
      const r = await ensureBotAccess(
        {
          promote: (cid, hash, username) => client.promoteBotToAdmin(cid, hash, username),
        },
        {
          channelId: campaign.dest_channel_id,
          accessHash: campaign.dest_access_hash,
          botUsername: botRow.username,
        },
      );
      res.json(r);
    } finally {
      await client.disconnect().catch(() => {});
    }
  } catch (error) {
    console.error("[ensure-bot-access] falhou:", error);
    res.status(500).json({ error: "verificação falhou" });
  }
});
```

- [ ] **Step 5: A Server Action**

Em `app/dashboard/automations/scheduled/actions.ts`:

```ts
/**
 * Promove o bot no destino escolhido. Passa pelo worker (mesmo hop de
 * enqueueClone) porque promover exige MTProto, que o Next não fala.
 */
export async function ensureBotAccessOnDestination(
  campaignId: string,
): Promise<ActionResult> {
  await requireAutomationsAccess();
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  try {
    const res = await fetch(`${serverUrl}/api/mtproto/ensure-bot-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (!res.ok) {
      return { ok: false, error: `Não deu pra verificar o bot (${res.status}).` };
    }
    const body = (await res.json()) as { ok: boolean; error?: string };
    // Recusa prevista volta como DADO, com o texto acionável que o worker montou.
    return body.ok ? { ok: true } : { ok: false, error: body.error ?? "Falha desconhecida." };
  } catch {
    return { ok: false, error: "Não deu pra falar com o servidor de automações." };
  }
}
```

- [ ] **Step 6: O botão no `DestinationCard`**

Acrescente um botão "Preparar o bot neste canal" que chama a action e mostra o resultado. Quando der certo, um selo verde "Bot pronto para publicar"; quando não, o texto de erro por inteiro — ele é acionável de propósito (diz o que fazer no BotFather, por exemplo).

- [ ] **Step 7: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/ensure-bot-access.test.ts`
Expected: PASS, 5 testes.

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erro, tudo verde.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/mtproto/ensure-bot-access.ts server/src/index.ts app/dashboard/automations/scheduled/actions.ts components/dashboard/campaigns/destination-card.tsx server/tests/services/ensure-bot-access.test.ts
git commit -m "feat(campanhas): promover o bot no canal de destino antes de publicar"
```

---

### Task 11: Verificação de ponta a ponta

**Files:** nenhum.

- [ ] **Step 1: Suítes**

Run: `npm test && cd server && npm test`
Expected: suite VERDE. O `server/` roda 53 arquivos e o root 41 (contagem de 2026-09-10; ela sobe conforme o plano avança, entao compare com a sua baseline, nao com este numero) — qualquer suite que falhe ou nao carregue e regressao SUA, nao condicao pre-existente. (Ate 2026-09-10 tres suites de `tests/engine/*` nao carregavam por falta de SUPABASE_URL; isso foi corrigido em `ac945ad` e nao deve ser usado como desculpa.)

- [ ] **Step 2: Regressão da Prova Social no navegador**

`/dashboard/bots/<id>/prova-social`: criar, editar, apagar, duplicar, fixar, reordenar, salvar canal, abas mobile. Idêntico ao de antes.

- [ ] **Step 3: Fluxo novo ponta a ponta**

1. Rode um clone em modo rascunho (Plano 1) com ~5 mensagens.
2. Abra `/dashboard/automations/scheduled/<id>`: as 5 aparecem na prévia, na ordem certa, com a mídia visível.
3. Edite o texto de uma, reordene duas, ajuste o delay de uma pra 2 minutos.
4. Escolha o destino e defina o início pra daqui a 2 minutos.
5. Clique em **"Preparar o bot neste canal"** e confirme o selo "Bot pronto para publicar".
6. Publique. Confirme no banco que `scheduled_at` foi preenchido em cadeia.
7. Acompanhe: as mensagens saem uma a uma, na ordem, respeitando o delay, e os chips viram "enviada".
8. Ao fim, a campanha fica `completed`.

- [ ] **Step 4: Caso de erro**

Remova o bot do canal e publique outra campanha. Confirme que a mensagem falha com erro legível na tela e que **a campanha não trava** — as demais também falham, uma a uma, com `attempts` chegando a 3.

---

## Sequência de dependências

```
Task 1 (schedule) ──┬── Task 4 (actions) ──┬── Task 6 (tela) ──┬─ Task 10 (bot access) ─┐
Task 2 (row type) ──┴── Task 3 (shell) ────┤                   │                        ├─ Task 11
                        Task 5 (cards) ────┘                   │                        │
Task 8 (silent) ── Task 7 (worker) ── Task 9 (poller) ──────────┴────────────────────────┘
```

Faça a **Task 8 antes da 7** — o handler já usa `silent`. Tasks 1-6 (frontend) e 7-9 (backend) são independentes entre si. A Task 10 toca os dois lados e precisa da Task 6 (o card onde o botão mora) e da Task 4 (o arquivo de actions).
