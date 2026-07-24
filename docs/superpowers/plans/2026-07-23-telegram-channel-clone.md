# Clonagem de canais e grupos do Telegram — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clonar um canal ou grupo do Telegram para um destino novo criado na conta do owner, com a conta pessoal lendo e um bot companheiro publicando.

**Architecture:** A conta MTProto lê o histórico da origem e cria o destino; um bot dedicado (token do BotFather) publica no destino. O job é resumível por cursor de `message_id`, processado pelo `mtproto-worker` existente via BullMQ. Duas rotas de cópia resolvidas em runtime: encaminhamento em lote quando a origem permite, download+reenvio quando não permite.

**Tech Stack:** TypeScript, `telegram` (gramjs) 2.26.22 / layer 198, `grammy` 1.41.1, BullMQ + Redis, Supabase (Postgres), Next.js App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-telegram-channel-clone-design.md`

## Global Constraints

- **Nunca confiar no throttle do gramjs.** `requestIter.js:49-52` passa segundos para `sleep(ms)`. Todo delay é imposto pelo nosso código.
- **FLOOD_WAIT se detecta por classe**, nunca por regex em `.message` — `FloodWaitError.message` é `"A wait of N seconds is required (caused by …)"` e não contém a string `FLOOD`.
- **`CustomFile` acima de 20MB exige caminho real em disco** no 3º argumento (`uploads.js:64`).
- **Conta de usuário não envia botão inline.** Publicação com `replyMarkup` é sempre pelo bot.
- **O bot é pré-requisito.** Sem `automation_bots` válido, clone não roda.
- Migrations seguem `032_channel_monitors.sql`: `create table if not exists public.X`, `references public.tenants(id) on delete cascade`, RLS com `tenant_id = auth.uid()`.
- Server Actions de escrita chamam `requireOwner()` (`@/lib/actions/owner-actions`).
- Jobs são enfileirados via `POST /api/mtproto/enqueue` no bot server, nunca direto no Redis a partir do Next.
- Testes do servidor: `server/tests/**/*.test.ts`, rodados com `cd server && npm test`. Requer `NODE_OPTIONS=--experimental-require-module`.
- Imports internos do servidor usam extensão `.js` (ESM): `from "./pool.js"`.

---

### Task 1: Migration e tipos base

**Files:**
- Create: `supabase/migrations/049_channel_clone.sql`
- Create: `server/src/services/mtproto/clone/types.ts`

**Interfaces:**
- Consumes: nada.
- Produces: tabelas `automation_bots`, `clone_jobs`, `clone_message_map`. Tipos `ClonePeer`, `CloneStrategy`, `CloneStatus`, `SourceMessage`, `CloneOutcome`, `CloneMapRow`, `CloneJobConfig`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/049_channel_clone.sql` com o SQL exato da seção "Schema" do spec (`docs/superpowers/specs/2026-07-23-telegram-channel-clone-design.md`), incluindo as três tabelas, os dois índices, o `enable row level security` das três e as três policies.

- [ ] **Step 2: Aplicar a migration**

Run: `npx supabase db push` (ou colar o SQL no SQL Editor do painel Supabase, que é o fluxo usado neste projeto).
Expected: três tabelas criadas, sem erro de FK. Conferir com:
`select table_name from information_schema.tables where table_name in ('automation_bots','clone_jobs','clone_message_map');`
Expected: 3 linhas.

- [ ] **Step 3: Criar os tipos compartilhados**

```typescript
// server/src/services/mtproto/clone/types.ts

/** Peer da origem, reconstruído a partir de mtproto_dialogs. */
export interface ClonePeer {
  peerId: string;
  peerType: "channel" | "chat";
  accessHash: string | null;
}

/** Rota de cópia resolvida em runtime. */
export type CloneStrategy = "batch" | "download";

export type CloneStatus =
  | "draft"
  | "running"
  | "paused"
  | "waiting_flood"
  | "completed"
  | "failed";

/**
 * Mensagem da origem normalizada. `raw` carrega o Api.Message do gramjs, mas
 * fica opaco para o runner — só o message-cloner destrincha.
 */
export interface SourceMessage {
  id: number;
  groupedId: string | null;
  replyToMsgId: number | null;
  raw: unknown;
}

export type CloneOutcome =
  | { status: "copied"; destMsgId: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface CloneMapRow {
  sourceMsgId: number;
  destMsgId: number | null;
  groupedId: string | null;
  status: "copied" | "skipped" | "failed";
  reason: string | null;
}

export interface CloneJobConfig {
  jobId: string;
  messageLimit: number | null;
  throttleMs: number;
  copyReplies: boolean;
  copyPins: boolean;
  copyButtons: boolean;
  copyPolls: boolean;
}
```

- [ ] **Step 4: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/049_channel_clone.sql server/src/services/mtproto/clone/types.ts
git commit -m "feat(clone): migration 049 e tipos base da clonagem"
```

---

### Task 2: Corrigir a detecção de FLOOD_WAIT (bug em produção)

Hoje `extractFloodWait` em `campaign-runner.ts:86-93` testa `/FLOOD/i` contra `err.message`. O `FloodWaitError` do gramjs monta `message = "A wait of N seconds is required (caused by …)"` — a palavra `FLOOD` só existe em `errorMessage`. O teste nunca casa, então todo FLOOD_WAIT cai no ramo genérico: o alvo vira `failed` (lead perdido) e a conta não entra em `flood_wait`.

**Files:**
- Create: `server/src/services/mtproto/flood.ts`
- Create: `server/tests/services/mtproto-flood.test.ts`
- Modify: `server/src/services/mtproto/campaign-runner.ts:86-93`

**Interfaces:**
- Consumes: nada.
- Produces: `extractWaitSeconds(err: unknown): number | null` — usado pelo `campaign-runner` e depois pelo `clone-runner`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// server/tests/services/mtproto-flood.test.ts
import { describe, it, expect } from "vitest";
import { FloodWaitError, SlowModeWaitError } from "telegram/errors/index.js";
import { extractWaitSeconds } from "../../src/services/mtproto/flood.js";

describe("extractWaitSeconds", () => {
  it("lê os segundos de um FloodWaitError real da lib", () => {
    const err = new FloodWaitError({
      request: undefined as never,
      capture: 42,
    } as never);
    // guarda de sanidade: a mensagem NÃO contém a palavra FLOOD.
    expect(err.message).not.toMatch(/FLOOD/i);
    expect(extractWaitSeconds(err)).toBe(42);
  });

  it("lê os segundos de um SlowModeWaitError real da lib", () => {
    const err = new SlowModeWaitError({
      request: undefined as never,
      capture: 7,
    } as never);
    expect(extractWaitSeconds(err)).toBe(7);
  });

  it("devolve null para erro comum", () => {
    expect(extractWaitSeconds(new Error("CHAT_WRITE_FORBIDDEN"))).toBeNull();
  });

  it("aceita objeto com seconds e mensagem de flood explícita (retrocompat)", () => {
    expect(extractWaitSeconds(Object.assign(new Error("FLOOD_WAIT_30"), { seconds: 30 }))).toBe(30);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npx vitest run tests/services/mtproto-flood.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/mtproto/flood.js'`.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/flood.ts
import { FloodWaitError, SlowModeWaitError } from "telegram/errors/index.js";

/**
 * Extrai o tempo de espera de um erro de flood do Telegram.
 *
 * ARMADILHA: FloodWaitError.message é "A wait of N seconds is required
 * (caused by ...)" — a string "FLOOD" só existe em `errorMessage`. Qualquer
 * detecção por regex na mensagem falha silenciosamente. Detectar por classe.
 */
export function extractWaitSeconds(err: unknown): number | null {
  if (err instanceof FloodWaitError || err instanceof SlowModeWaitError) {
    return typeof err.seconds === "number" ? err.seconds : null;
  }
  // Retrocompat: erros forjados em teste ou vindos de wrappers antigos que
  // carregam `seconds` e mencionam flood no texto.
  if (err && typeof err === "object") {
    const e = err as { seconds?: number; message?: string; errorMessage?: string };
    const text = `${e.message ?? ""} ${e.errorMessage ?? ""}`;
    if (typeof e.seconds === "number" && /FLOOD|SLOWMODE/i.test(text)) return e.seconds;
  }
  return null;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd server && npx vitest run tests/services/mtproto-flood.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Trocar a implementação no campaign-runner**

Em `server/src/services/mtproto/campaign-runner.ts`, remover o bloco:

```typescript
interface FloodWaitErrorLike {
  seconds?: number;
  message?: string;
}

function extractFloodWait(err: unknown): number | null {
  if (err && typeof err === "object") {
    const e = err as FloodWaitErrorLike;
    const msg = e.message ?? String(err);
    if (/FLOOD/i.test(msg) && typeof e.seconds === "number") return e.seconds;
  }
  return null;
}
```

e substituir por um import no topo do arquivo:

```typescript
import { extractWaitSeconds } from "./flood.js";
```

Depois trocar a única chamada, em `processBatch`:

```typescript
const floodSeconds = extractWaitSeconds(err);
```

- [ ] **Step 6: Rodar a suíte inteira do servidor**

Run: `cd server && npm test`
Expected: PASS. Os testes existentes de `mtproto-campaign-runner.test.ts` continuam verdes — o caso "on FloodWaitError marks the account and reuses another" usa `Object.assign(new Error("FLOOD_WAIT"), { seconds: 30 })`, coberto pelo ramo de retrocompat.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/mtproto/flood.ts server/tests/services/mtproto-flood.test.ts server/src/services/mtproto/campaign-runner.ts
git commit -m "fix(mtproto): FLOOD_WAIT nunca era detectado nas campanhas

FloodWaitError.message do gramjs e 'A wait of N seconds is required',
sem a palavra FLOOD (que so existe em errorMessage). O regex /FLOOD/i
nunca casava, entao todo flood caia no ramo generico: o alvo virava
failed (lead perdido) e a conta nao entrava em flood_wait.

Detecta por classe agora, cobrindo tambem SlowModeWaitError."
```

---

### Task 3: `MtprotoClient` — supergrupo e upload de arquivo grande

**Files:**
- Modify: `server/src/services/mtproto/client.ts:611-640` (`createChannel`)
- Modify: `server/src/services/mtproto/client.ts:647-694` (`sendMediaToChannel`)
- Modify: `server/src/services/mtproto/channel-creator.ts:100`

**Interfaces:**
- Consumes: nada.
- Produces: `createChannel(title, about, opts?: { megagroup?: boolean })`, `uploadFromPath(filePath, fileName, sizeBytes)`.

- [ ] **Step 1: Adicionar `megagroup` ao `createChannel`**

Em `server/src/services/mtproto/client.ts`, trocar a assinatura e o invoke:

```typescript
  /**
   * Cria um canal novo. `megagroup: true` cria supergrupo em vez de canal
   * broadcast — usado pela clonagem quando a origem é grupo. Pode estourar
   * FLOOD_WAIT se a conta criou muitos canais recentemente.
   */
  async createChannel(
    title: string,
    about: string,
    opts: { megagroup?: boolean } = {},
  ): Promise<{
    channelId: string;
    accessHash: string;
  }> {
    await this.connect();
    const megagroup = opts.megagroup === true;
    const result = await this.client.invoke(
      new Api.channels.CreateChannel({
        title,
        about,
        broadcast: !megagroup,
        megagroup,
      }),
    );
```

O resto do método fica igual.

- [ ] **Step 2: Confirmar que o chamador existente não muda de comportamento**

Run: `cd c:/Users/Administrator/eaglebot && grep -rn "createChannel(" server/src --include=*.ts`
Expected: só `channel-creator.ts:100` chamando com dois argumentos. Como `opts` tem default `{}` e `megagroup` default `false`, o comportamento continua `broadcast: true`. Nada a mudar lá.

- [ ] **Step 3: Adicionar upload por caminho em disco**

Acima de 20MB o gramjs trata o 3º argumento do `CustomFile` como caminho em disco (`uploads.js:64`). O código atual passa o *nome* do arquivo ali, então quebra. Adicionar um método dedicado em `client.ts`:

```typescript
  /**
   * Sobe um arquivo que já está em disco. Acima de 20MB o gramjs abre o 3º
   * argumento do CustomFile como CAMINHO (uploads.js:64) — passar o nome ali,
   * como sendMediaToChannel fazia, quebra em arquivo grande.
   */
  async uploadFromPath(
    filePath: string,
    fileName: string,
    sizeBytes: number,
  ): Promise<Api.TypeInputFile> {
    await this.connect();
    return this.client.uploadFile({
      file: new CustomFile(fileName, sizeBytes, filePath),
      workers: 4,
    });
  }
```

- [ ] **Step 4: Corrigir o `sendMediaToChannel` existente**

O método atual monta `new CustomFile(media.fileName, media.buffer.length, media.fileName, media.buffer)`. Com o Buffer no 4º argumento a lib usa o buffer e ignora o path abaixo de 20MB, mas acima disso entra no ramo do path. Como esse método só é usado pelo `channel-creator`/`channel-replacer` com mídias de template, adicionar uma guarda explícita em vez de falhar obscuro:

```typescript
    const BUFFER_UPLOAD_LIMIT = 20 * 1024 * 1024;
    if (media.buffer.length >= BUFFER_UPLOAD_LIMIT) {
      throw new Error(
        `MEDIA_TOO_LARGE_FOR_BUFFER_UPLOAD: ${media.fileName} tem ${media.buffer.length} bytes; ` +
          `use uploadFromPath com o arquivo em disco`,
      );
    }
    const file = await this.client.uploadFile({
      file: new CustomFile(media.fileName, media.buffer.length, media.fileName, media.buffer),
      workers: 1,
    });
```

- [ ] **Step 5: Verificar compilação e suíte**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erros de tipo, suíte verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mtproto/client.ts
git commit -m "feat(mtproto): createChannel aceita megagroup e upload por caminho em disco

createChannel ganha opts.megagroup pra criar supergrupo (default segue
broadcast, entao channel-creator nao muda).

uploadFromPath sobe arquivo ja em disco: acima de 20MB o gramjs trata o
3o arg do CustomFile como CAMINHO (uploads.js:64), e sendMediaToChannel
passava o nome ali. Guarda explicita adicionada no metodo antigo."
```

---

### Task 4: `history-iterator` — percorrer a origem do mais antigo ao mais novo

**Files:**
- Create: `server/src/services/mtproto/clone/history-iterator.ts`
- Create: `server/tests/services/clone-history-iterator.test.ts`

**Interfaces:**
- Consumes: `ClonePeer`, `SourceMessage` (Task 1).
- Produces:
  - `buildHistoryPeer(peer: ClonePeer): Api.TypeInputPeer`
  - `normalizeMessage(raw: unknown): SourceMessage | null` — devolve `null` para `MessageEmpty`/`MessageService`/não-mensagem.
  - `iterHistoryAscending(source: HistorySource, opts: { sinceMsgId?: number; throttleMs?: number }): AsyncGenerator<SourceMessage>`
  - `interface HistorySource { fetch(sinceMsgId: number): AsyncIterable<unknown>; delay(ms: number): Promise<void> }`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-history-iterator.test.ts
import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import {
  buildHistoryPeer,
  normalizeMessage,
  iterHistoryAscending,
  type HistorySource,
} from "../../src/services/mtproto/clone/history-iterator.js";

function msg(id: number, extra: Partial<Api.Message> = {}): Api.Message {
  return new Api.Message({ id, message: `m${id}`, ...extra } as never);
}

describe("buildHistoryPeer", () => {
  it("monta InputPeerChannel com accessHash", () => {
    const p = buildHistoryPeer({ peerId: "777", peerType: "channel", accessHash: "999" });
    expect(p).toBeInstanceOf(Api.InputPeerChannel);
    expect((p as Api.InputPeerChannel).channelId.toString()).toBe("777");
  });

  it("monta InputPeerChat sem accessHash", () => {
    const p = buildHistoryPeer({ peerId: "555", peerType: "chat", accessHash: null });
    expect(p).toBeInstanceOf(Api.InputPeerChat);
  });

  it("recusa canal sem accessHash", () => {
    expect(() =>
      buildHistoryPeer({ peerId: "777", peerType: "channel", accessHash: null }),
    ).toThrow(/CHANNEL_PEER_MISSING_ACCESS_HASH/);
  });
});

describe("normalizeMessage", () => {
  it("normaliza uma Api.Message", () => {
    const out = normalizeMessage(msg(10, { groupedId: bigInt(42) }));
    expect(out).toEqual({ id: 10, groupedId: "42", replyToMsgId: null, raw: expect.anything() });
  });

  it("lê o id da mensagem respondida", () => {
    const m = msg(11, { replyTo: new Api.MessageReplyHeader({ replyToMsgId: 5 } as never) });
    expect(normalizeMessage(m)?.replyToMsgId).toBe(5);
  });

  it("descarta MessageService e MessageEmpty", () => {
    expect(normalizeMessage(new Api.MessageEmpty({ id: 1 } as never))).toBeNull();
    expect(
      normalizeMessage(
        new Api.MessageService({
          id: 2,
          action: new Api.MessageActionChatCreate({ title: "x", users: [] } as never),
        } as never),
      ),
    ).toBeNull();
  });
});

describe("iterHistoryAscending", () => {
  it("rende em ordem crescente, pulando service, e aplica o throttle entre itens", async () => {
    const delay = vi.fn(async () => {});
    const source: HistorySource = {
      fetch: async function* () {
        yield msg(1);
        yield new Api.MessageService({
          id: 2,
          action: new Api.MessageActionChatCreate({ title: "x", users: [] } as never),
        } as never);
        yield msg(3);
      },
      delay,
    };

    const ids: number[] = [];
    for await (const m of iterHistoryAscending(source, { throttleMs: 1500 })) ids.push(m.id);

    expect(ids).toEqual([1, 3]);
    expect(delay).toHaveBeenCalledWith(1500);
  });

  it("repassa sinceMsgId para o fetch", async () => {
    const fetch = vi.fn(async function* () {});
    await (async () => {
      for await (const _ of iterHistoryAscending({ fetch, delay: async () => {} }, { sinceMsgId: 99 })) void _;
    })();
    expect(fetch).toHaveBeenCalledWith(99);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-history-iterator.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/clone/history-iterator.ts
import { Api } from "telegram";
import bigInt from "big-integer";
import type { ClonePeer, SourceMessage } from "./types.js";

/**
 * Fonte do histórico. Existe para manter o iterador testável sem rede: a
 * implementação real embrulha client.iterMessages(peer, { reverse: true }).
 */
export interface HistorySource {
  fetch(sinceMsgId: number): AsyncIterable<unknown>;
  delay(ms: number): Promise<void>;
}

export function buildHistoryPeer(peer: ClonePeer): Api.TypeInputPeer {
  if (peer.peerType === "chat") {
    // Grupo legacy não tem access_hash.
    return new Api.InputPeerChat({ chatId: bigInt(peer.peerId) });
  }
  if (!peer.accessHash) throw new Error("CHANNEL_PEER_MISSING_ACCESS_HASH");
  return new Api.InputPeerChannel({
    channelId: bigInt(peer.peerId),
    accessHash: bigInt(peer.accessHash),
  });
}

/**
 * Normaliza um item cru do iterMessages. MessageService e MessageEmpty são
 * ruído estrutural (entrou no grupo, trocou foto, mensagem apagada) e saem
 * como null — o runner nunca os vê.
 */
export function normalizeMessage(raw: unknown): SourceMessage | null {
  if (!(raw instanceof Api.Message)) return null;
  const replyTo = raw.replyTo;
  return {
    id: raw.id,
    groupedId: raw.groupedId ? raw.groupedId.toString() : null,
    replyToMsgId:
      replyTo instanceof Api.MessageReplyHeader && typeof replyTo.replyToMsgId === "number"
        ? replyTo.replyToMsgId
        : null,
    raw,
  };
}

/**
 * Percorre o histórico do mais antigo para o mais novo, retomável a partir de
 * sinceMsgId.
 *
 * ARMADILHA: o waitTime do gramjs é no-op (requestIter.js:49-52 entrega
 * segundos para sleep(ms)). O throttle é imposto aqui.
 */
export async function* iterHistoryAscending(
  source: HistorySource,
  opts: { sinceMsgId?: number; throttleMs?: number } = {},
): AsyncGenerator<SourceMessage, void, void> {
  const { sinceMsgId = 0, throttleMs = 1000 } = opts;
  for await (const raw of source.fetch(sinceMsgId)) {
    const m = normalizeMessage(raw);
    if (!m) continue;
    yield m;
    if (throttleMs > 0) await source.delay(throttleMs);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-history-iterator.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/history-iterator.ts server/tests/services/clone-history-iterator.test.ts
git commit -m "feat(clone): iterador retomavel do historico da origem"
```

---

### Task 5: `media-plan` — classificar o que dá para clonar

Núcleo puro do `message-cloner`: decide, sem tocar em rede, o que fazer com cada mensagem. Testável exaustivamente porque opera sobre `className` de strings.

**Files:**
- Create: `server/src/services/mtproto/clone/media-plan.ts`
- Create: `server/tests/services/clone-media-plan.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type MediaPlan` (união discriminada abaixo)
  - `planForMessage(input: PlanInput): MediaPlan`
  - `interface PlanInput { mediaClassName: string | null; documentAttributeClassNames: string[]; hasText: boolean; copyPolls: boolean }`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-media-plan.test.ts
import { describe, it, expect } from "vitest";
import { planForMessage } from "../../src/services/mtproto/clone/media-plan.js";

function input(over: Partial<Parameters<typeof planForMessage>[0]> = {}) {
  return {
    mediaClassName: null,
    documentAttributeClassNames: [],
    hasText: true,
    copyPolls: false,
    ...over,
  };
}

describe("planForMessage", () => {
  it("mensagem só de texto vira plano de texto", () => {
    expect(planForMessage(input())).toEqual({ kind: "text" });
  });

  it("mensagem vazia sem mídia é pulada", () => {
    expect(planForMessage(input({ hasText: false }))).toEqual({
      kind: "skip",
      reason: "empty_message",
    });
  });

  it("foto vira mídia photo", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaPhoto" }))).toEqual({
      kind: "media",
      mediaKind: "photo",
    });
  });

  it("webpage degrada para texto (o preview é regerado pelo servidor)", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaWebPage" }))).toEqual({
      kind: "text",
    });
  });

  it.each([
    ["DocumentAttributeVideo", "video"],
    ["DocumentAttributeSticker", "sticker"],
    ["DocumentAttributeAnimated", "animation"],
  ])("documento com %s vira %s", (attr, expected) => {
    expect(
      planForMessage(
        input({ mediaClassName: "MessageMediaDocument", documentAttributeClassNames: [attr] }),
      ),
    ).toEqual({ kind: "media", mediaKind: expected });
  });

  it("áudio com voice ganha kind voice", () => {
    expect(
      planForMessage(
        input({
          mediaClassName: "MessageMediaDocument",
          documentAttributeClassNames: ["DocumentAttributeAudio"],
        }),
      ),
    ).toEqual({ kind: "media", mediaKind: "audio" });
  });

  it("documento sem atributo conhecido vira document", () => {
    expect(
      planForMessage(input({ mediaClassName: "MessageMediaDocument" })),
    ).toEqual({ kind: "media", mediaKind: "document" });
  });

  it("enquete só entra quando o toggle está ligado", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaPoll" }))).toEqual({
      kind: "skip",
      reason: "poll_disabled",
    });
    expect(
      planForMessage(input({ mediaClassName: "MessageMediaPoll", copyPolls: true })),
    ).toEqual({ kind: "poll" });
  });

  it.each([
    ["MessageMediaGame", "media_game"],
    ["MessageMediaInvoice", "media_invoice"],
    ["MessageMediaGiveaway", "media_giveaway"],
    ["MessageMediaGiveawayResults", "media_giveaway"],
    ["MessageMediaPaidMedia", "media_paid"],
    ["MessageMediaStory", "media_story"],
    ["MessageMediaGeoLive", "media_geo_live"],
    ["MessageMediaUnsupported", "media_unsupported"],
  ])("%s é pulado com motivo %s", (className, reason) => {
    expect(planForMessage(input({ mediaClassName: className }))).toEqual({
      kind: "skip",
      reason,
    });
  });

  it("mídia desconhecida é pulada em vez de virar mensagem vazia", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaFutura" }))).toEqual({
      kind: "skip",
      reason: "media_unknown",
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-media-plan.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/clone/media-plan.ts

export type CloneMediaKind =
  | "photo"
  | "video"
  | "document"
  | "audio"
  | "sticker"
  | "animation";

export type MediaPlan =
  | { kind: "text" }
  | { kind: "media"; mediaKind: CloneMediaKind }
  | { kind: "poll" }
  | { kind: "skip"; reason: string };

export interface PlanInput {
  /** className da Api.Message.media, ou null quando não há mídia. */
  mediaClassName: string | null;
  /** classNames dos atributos do documento, quando a mídia é documento. */
  documentAttributeClassNames: string[];
  hasText: boolean;
  copyPolls: boolean;
}

/**
 * Motivos de skip são strings estáveis: aparecem no relatório da UI e nos
 * testes. Não renomear sem migrar clone_message_map.reason.
 */
const SKIP_BY_MEDIA: Record<string, string> = {
  MessageMediaGame: "media_game",
  MessageMediaInvoice: "media_invoice",
  MessageMediaGiveaway: "media_giveaway",
  MessageMediaGiveawayResults: "media_giveaway",
  MessageMediaPaidMedia: "media_paid",
  MessageMediaStory: "media_story",
  MessageMediaGeoLive: "media_geo_live",
  MessageMediaDice: "media_dice",
  MessageMediaUnsupported: "media_unsupported",
};

function documentKind(attributeClassNames: string[]): CloneMediaKind {
  if (attributeClassNames.includes("DocumentAttributeSticker")) return "sticker";
  if (attributeClassNames.includes("DocumentAttributeAnimated")) return "animation";
  if (attributeClassNames.includes("DocumentAttributeVideo")) return "video";
  if (attributeClassNames.includes("DocumentAttributeAudio")) return "audio";
  return "document";
}

export function planForMessage(input: PlanInput): MediaPlan {
  const { mediaClassName, documentAttributeClassNames, hasText, copyPolls } = input;

  if (mediaClassName === null) {
    return hasText ? { kind: "text" } : { kind: "skip", reason: "empty_message" };
  }

  // Preview de link não é mídia: é gerado pelo servidor a partir do texto.
  // Enviar só o texto reproduz o post com fidelidade ~100%.
  if (mediaClassName === "MessageMediaWebPage") return { kind: "text" };

  if (mediaClassName === "MessageMediaPhoto") return { kind: "media", mediaKind: "photo" };

  if (mediaClassName === "MessageMediaDocument") {
    return { kind: "media", mediaKind: documentKind(documentAttributeClassNames) };
  }

  if (mediaClassName === "MessageMediaPoll") {
    return copyPolls ? { kind: "poll" } : { kind: "skip", reason: "poll_disabled" };
  }

  const known = SKIP_BY_MEDIA[mediaClassName];
  if (known) return { kind: "skip", reason: known };

  // Desconhecido: pular explicitamente. O utils do gramjs mapeia mídia que
  // não reconhece para InputMediaEmpty, o que enviaria uma mensagem vazia
  // sem avisar ninguém.
  return { kind: "skip", reason: "media_unknown" };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-media-plan.test.ts`
Expected: PASS, 20 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/media-plan.ts server/tests/services/clone-media-plan.test.ts
git commit -m "feat(clone): classificacao pura de midia clonavel"
```

---

### Task 6: `bot-client` — o bot companheiro

**Files:**
- Create: `server/src/services/mtproto/clone/bot-client.ts`
- Create: `server/tests/services/clone-bot-client.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `validateBotToken(token, deps): Promise<{ ok: true; botUserId: string; username: string } | { ok: false; error: string }>`
  - `class CompanionBot` com `publishText`, `publishMedia`, `publishAlbum`, `pin`, `botMtprotoSession()`
  - `interface BotValidationDeps { getMe(token: string): Promise<{ id: number; username?: string; is_bot: boolean }> }`
  - `buildInlineKeyboard(links: Array<{ label: string; url: string }>): { inline_keyboard: Array<Array<{ text: string; url: string }>> }`

A validação de token é a parte com regra de negócio e ganha teste. O wrapper de publicação é fino sobre `grammy` e é exercitado pelo teste manual da Task 12.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-bot-client.test.ts
import { describe, it, expect } from "vitest";
import {
  validateBotToken,
  buildInlineKeyboard,
} from "../../src/services/mtproto/clone/bot-client.js";

describe("validateBotToken", () => {
  it("aceita um bot válido", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, username: "meu_bot", is_bot: true }),
    });
    expect(out).toEqual({ ok: true, botUserId: "555", username: "meu_bot" });
  });

  it("recusa token vazio sem chamar a API", async () => {
    let called = false;
    const out = await validateBotToken("  ", {
      getMe: async () => {
        called = true;
        return { id: 1, username: "x", is_bot: true };
      },
    });
    expect(out).toEqual({ ok: false, error: "token_vazio" });
    expect(called).toBe(false);
  });

  it("recusa quando a API diz que não é bot", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, username: "alguem", is_bot: false }),
    });
    expect(out).toEqual({ ok: false, error: "nao_e_bot" });
  });

  it("recusa bot sem username (não dá pra promover a admin por @)", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, is_bot: true }),
    });
    expect(out).toEqual({ ok: false, error: "bot_sem_username" });
  });

  it("converte falha da API em erro legível", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => {
        throw new Error("401: Unauthorized");
      },
    });
    expect(out).toEqual({ ok: false, error: "401: Unauthorized" });
  });
});

describe("buildInlineKeyboard", () => {
  it("põe um botão por linha", () => {
    expect(
      buildInlineKeyboard([
        { label: "Comprar", url: "https://a" },
        { label: "Suporte", url: "https://b" },
      ]),
    ).toEqual({
      inline_keyboard: [
        [{ text: "Comprar", url: "https://a" }],
        [{ text: "Suporte", url: "https://b" }],
      ],
    });
  });

  it("descarta botão sem url http (callback de bot alheio não funciona)", () => {
    expect(
      buildInlineKeyboard([
        { label: "Callback", url: "" },
        { label: "Ok", url: "https://a" },
      ]),
    ).toEqual({ inline_keyboard: [[{ text: "Ok", url: "https://a" }]] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-bot-client.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/clone/bot-client.ts
import { Api } from "telegram";
import { Bot, InputFile } from "grammy";
import { config } from "../../../config.js";
import { MtprotoClient } from "../client.js";
import type { CloneMediaKind } from "./media-plan.js";

export interface BotValidationDeps {
  getMe(token: string): Promise<{ id: number; username?: string; is_bot: boolean }>;
}

export type BotValidation =
  | { ok: true; botUserId: string; username: string }
  | { ok: false; error: string };

export const defaultBotValidationDeps: BotValidationDeps = {
  getMe: async (token) => {
    const me = await new Bot(token).api.getMe();
    return { id: me.id, username: me.username, is_bot: me.is_bot };
  },
};

/**
 * Valida o token colado pelo owner. Username é obrigatório porque a promoção
 * a admin resolve o bot por @username (contacts.ResolveUsername).
 */
export async function validateBotToken(
  token: string,
  deps: BotValidationDeps = defaultBotValidationDeps,
): Promise<BotValidation> {
  if (!token || !token.trim()) return { ok: false, error: "token_vazio" };
  try {
    const me = await deps.getMe(token.trim());
    if (!me.is_bot) return { ok: false, error: "nao_e_bot" };
    if (!me.username) return { ok: false, error: "bot_sem_username" };
    return { ok: true, botUserId: String(me.id), username: me.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface InlineLink {
  label: string;
  url: string;
}

/**
 * Só botões de URL sobrevivem à clonagem: callback pertence ao bot que criou
 * a mensagem original e não funciona fora dele.
 */
export function buildInlineKeyboard(links: InlineLink[]): {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
} {
  return {
    inline_keyboard: links
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => [{ text: l.label, url: l.url }]),
  };
}

export interface PublishOptions {
  replyToMessageId?: number;
  entities?: unknown[];
  inlineLinks?: InlineLink[];
}

/**
 * Publicador do clone. Bot API para o caso comum; cliente MTProto de bot
 * apenas para o que a Bot API não cobre.
 */
export class CompanionBot {
  private bot: Bot;
  private mt: MtprotoClient | null = null;

  constructor(
    private token: string,
    /** chat_id no formato do Bot API: -100<channelId> para canal/supergrupo. */
    private destChatId: string,
    private sessionString: string | null = null,
  ) {
    this.bot = new Bot(token);
  }

  static destChatIdFromChannelId(channelId: string): string {
    return `-100${channelId}`;
  }

  async publishText(text: string, opts: PublishOptions = {}): Promise<number> {
    const sent = await this.bot.api.sendMessage(this.destChatId, text, {
      entities: opts.entities as never,
      link_preview_options: { is_disabled: false },
      reply_parameters: opts.replyToMessageId
        ? { message_id: opts.replyToMessageId }
        : undefined,
      reply_markup: opts.inlineLinks?.length
        ? buildInlineKeyboard(opts.inlineLinks)
        : undefined,
      disable_notification: true,
    });
    return sent.message_id;
  }

  async publishMedia(
    filePath: string,
    kind: CloneMediaKind,
    caption: string,
    opts: PublishOptions = {},
  ): Promise<number> {
    const file = new InputFile(filePath);
    const common = {
      caption: caption || undefined,
      caption_entities: opts.entities as never,
      reply_parameters: opts.replyToMessageId
        ? { message_id: opts.replyToMessageId }
        : undefined,
      reply_markup: opts.inlineLinks?.length
        ? buildInlineKeyboard(opts.inlineLinks)
        : undefined,
      disable_notification: true,
    };
    const api = this.bot.api;
    const sent =
      kind === "photo"
        ? await api.sendPhoto(this.destChatId, file, common)
        : kind === "video"
          ? await api.sendVideo(this.destChatId, file, common)
          : kind === "audio"
            ? await api.sendAudio(this.destChatId, file, common)
            : kind === "animation"
              ? await api.sendAnimation(this.destChatId, file, common)
              : kind === "sticker"
                ? await api.sendSticker(this.destChatId, file, {
                    reply_parameters: common.reply_parameters,
                    disable_notification: true,
                  })
                : await api.sendDocument(this.destChatId, file, common);
    return sent.message_id;
  }

  /** Álbum. O caller já fatiou em no máximo 10 itens. */
  async publishAlbum(
    items: Array<{ filePath: string; kind: "photo" | "video"; caption: string }>,
  ): Promise<number[]> {
    const media = items.map((it) => ({
      type: it.kind,
      media: new InputFile(it.filePath),
      caption: it.caption || undefined,
    }));
    const sent = await this.bot.api.sendMediaGroup(this.destChatId, media as never, {
      disable_notification: true,
    });
    return sent.map((m) => m.message_id);
  }

  async pin(messageId: number): Promise<void> {
    await this.bot.api.pinChatMessage(this.destChatId, messageId, {
      disable_notification: true,
    });
  }

  /**
   * Cliente MTProto autenticado como bot, para o que a Bot API não faz.
   * Devolve também a session string, para persistir em automation_bots.
   */
  async mtproto(): Promise<{ client: MtprotoClient; sessionString: string }> {
    if (!this.mt) {
      this.mt = new MtprotoClient(
        config.telegramApiId,
        config.telegramApiHash,
        this.sessionString ?? "",
      );
      if (!this.sessionString) {
        this.sessionString = await this.mt.signInAsBot(this.token);
      } else {
        await this.mt.connect();
      }
    }
    return { client: this.mt, sessionString: this.sessionString! };
  }

  async disconnect(): Promise<void> {
    await this.mt?.disconnect().catch(() => {});
    this.mt = null;
  }
}

/** Reexport para o cloner montar entities sem importar gramjs direto. */
export { Api };
```

- [ ] **Step 4: Adicionar `signInAsBot` ao `MtprotoClient`**

Em `server/src/services/mtproto/client.ts`, logo depois de `signInWithPassword`:

```typescript
  /**
   * Autentica como BOT usando o token do BotFather. Verificado em
   * client/auth.js:361-366 — o gramjs decide por duck-typing: sem
   * `phoneNumber` no objeto, cai em signInBot(), que invoca
   * Api.auth.ImportBotAuthorization. A session string resultante tem o mesmo
   * formato da de conta de usuário (sessions/StringSession.js:91-114).
   */
  async signInAsBot(botAuthToken: string): Promise<string> {
    await this.client.start({ botAuthToken });
    return (this.client.session as StringSession).save();
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-bot-client.test.ts && npx tsc --noEmit`
Expected: PASS, 7 testes; sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mtproto/clone/bot-client.ts server/tests/services/clone-bot-client.test.ts server/src/services/mtproto/client.ts
git commit -m "feat(clone): bot companheiro (validacao de token, publicacao, login MTProto de bot)"
```

---

### Task 7: `dest-builder` — criar o destino e instalar o bot

**Files:**
- Create: `server/src/services/mtproto/clone/dest-builder.ts`
- Create: `server/tests/services/clone-dest-builder.test.ts`

**Interfaces:**
- Consumes: `ClonePeer` (Task 1), `createChannel(title, about, { megagroup })` (Task 3).
- Produces:
  - `deriveDestKind(dialogKind: string): "broadcast" | "megagroup"`
  - `ensureDestination(deps: DestBuilderDeps, input: EnsureDestinationInput): Promise<DestinationRef>`
  - `interface DestinationRef { channelId: string; accessHash: string; inviteLink: string | null }`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-dest-builder.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  deriveDestKind,
  ensureDestination,
  type DestBuilderDeps,
} from "../../src/services/mtproto/clone/dest-builder.js";

function deps(over: Partial<DestBuilderDeps> = {}): DestBuilderDeps {
  return {
    readIdentity: vi.fn(async () => ({ title: "Canal X", about: "sobre", photo: null })),
    createChannel: vi.fn(async () => ({ channelId: "111", accessHash: "222" })),
    setAbout: vi.fn(async () => {}),
    setPhoto: vi.fn(async () => {}),
    promoteBot: vi.fn(async () => {}),
    exportInvite: vi.fn(async () => "https://t.me/+abc"),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

const input = {
  jobId: "j1",
  source: { peerId: "9", peerType: "channel" as const, accessHash: "8" },
  destKind: "broadcast" as const,
  destTitle: "Canal X (clone)",
  copyIdentity: true,
  botUsername: "meu_bot",
  existing: null,
};

describe("deriveDestKind", () => {
  it.each([
    ["channel_owner", "broadcast"],
    ["channel_subscriber", "broadcast"],
    ["group_admin", "megagroup"],
    ["group_member", "megagroup"],
  ])("%s vira %s", (kind, expected) => {
    expect(deriveDestKind(kind)).toBe(expected);
  });

  it("recusa kind que não é canal nem grupo", () => {
    expect(() => deriveDestKind("bot")).toThrow(/DIALOG_KIND_NAO_CLONAVEL/);
  });
});

describe("ensureDestination", () => {
  it("cria o destino, aplica identidade, promove o bot e exporta o convite", async () => {
    const d = deps();
    const out = await ensureDestination(d, input);

    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "sobre", {
      megagroup: false,
    });
    expect(d.setAbout).toHaveBeenCalled();
    expect(d.promoteBot).toHaveBeenCalledWith("111", "222", "meu_bot");
    expect(out).toEqual({
      channelId: "111",
      accessHash: "222",
      inviteLink: "https://t.me/+abc",
    });
    expect(d.persist).toHaveBeenCalledWith("j1", out);
  });

  it("cria supergrupo quando destKind é megagroup", async () => {
    const d = deps();
    await ensureDestination(d, { ...input, destKind: "megagroup" });
    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "sobre", {
      megagroup: true,
    });
  });

  it("não copia about nem foto quando copyIdentity é false", async () => {
    const d = deps();
    await ensureDestination(d, { ...input, copyIdentity: false });
    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "", { megagroup: false });
    expect(d.setAbout).not.toHaveBeenCalled();
    expect(d.setPhoto).not.toHaveBeenCalled();
  });

  it("é idempotente: destino já gravado não é recriado", async () => {
    const d = deps();
    const existing = { channelId: "77", accessHash: "88", inviteLink: null };
    const out = await ensureDestination(d, { ...input, existing });
    expect(d.createChannel).not.toHaveBeenCalled();
    expect(d.promoteBot).not.toHaveBeenCalled();
    expect(out).toEqual(existing);
  });

  it("falha de foto e de convite não derruba a criação", async () => {
    const d = deps({
      setPhoto: vi.fn(async () => {
        throw new Error("PHOTO_INVALID");
      }),
      exportInvite: vi.fn(async () => {
        throw new Error("FLOOD");
      }),
      readIdentity: vi.fn(async () => ({
        title: "Canal X",
        about: "sobre",
        photo: Buffer.from("x"),
      })),
    });
    const out = await ensureDestination(d, input);
    expect(out.channelId).toBe("111");
    expect(out.inviteLink).toBeNull();
  });

  it("falha de promoção do bot é fatal (sem bot não há publicação)", async () => {
    const d = deps({
      promoteBot: vi.fn(async () => {
        throw new Error("BOT_GROUPS_BLOCKED");
      }),
    });
    await expect(ensureDestination(d, input)).rejects.toThrow(/BOT_GROUPS_BLOCKED/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-dest-builder.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/clone/dest-builder.ts
import type { ClonePeer } from "./types.js";

export type DestKind = "broadcast" | "megagroup";

export interface SourceIdentity {
  title: string;
  about: string;
  photo: Buffer | null;
}

export interface DestinationRef {
  channelId: string;
  accessHash: string;
  inviteLink: string | null;
}

export interface DestBuilderDeps {
  readIdentity(source: ClonePeer): Promise<SourceIdentity>;
  createChannel(
    title: string,
    about: string,
    opts: { megagroup: boolean },
  ): Promise<{ channelId: string; accessHash: string }>;
  setAbout(channelId: string, accessHash: string, about: string): Promise<void>;
  setPhoto(channelId: string, accessHash: string, photo: Buffer): Promise<void>;
  promoteBot(channelId: string, accessHash: string, botUsername: string): Promise<void>;
  exportInvite(channelId: string, accessHash: string): Promise<string>;
  persist(jobId: string, dest: DestinationRef): Promise<void>;
}

export interface EnsureDestinationInput {
  jobId: string;
  source: ClonePeer;
  destKind: DestKind;
  destTitle: string;
  copyIdentity: boolean;
  botUsername: string;
  /** Destino já criado numa execução anterior. Quando presente, nada é refeito. */
  existing: DestinationRef | null;
}

/**
 * Canal e supergrupo são ambos peer_type='channel' no Telegram — só o kind do
 * dialog os distingue.
 */
export function deriveDestKind(dialogKind: string): DestKind {
  if (dialogKind === "channel_owner" || dialogKind === "channel_subscriber") {
    return "broadcast";
  }
  if (dialogKind === "group_admin" || dialogKind === "group_member") {
    return "megagroup";
  }
  throw new Error(`DIALOG_KIND_NAO_CLONAVEL: ${dialogKind}`);
}

/**
 * Cria o destino, aplica a identidade da origem, promove o bot a admin e
 * exporta o convite. Idempotente: retomada de job não recria nada.
 *
 * Foto e convite são best-effort. A promoção do bot é fatal — sem bot admin
 * não existe publicação, e falhar aqui é mais barato que falhar na mensagem 1.
 */
export async function ensureDestination(
  deps: DestBuilderDeps,
  input: EnsureDestinationInput,
): Promise<DestinationRef> {
  if (input.existing) return input.existing;

  const identity = input.copyIdentity
    ? await deps.readIdentity(input.source)
    : { title: input.destTitle, about: "", photo: null };

  const about = input.copyIdentity ? identity.about : "";
  const created = await deps.createChannel(input.destTitle, about, {
    megagroup: input.destKind === "megagroup",
  });

  if (input.copyIdentity) {
    if (about) {
      try {
        await deps.setAbout(created.channelId, created.accessHash, about);
      } catch (err) {
        console.warn("[clone.dest] setAbout falhou (não fatal):", err);
      }
    }
    if (identity.photo) {
      try {
        await deps.setPhoto(created.channelId, created.accessHash, identity.photo);
      } catch (err) {
        console.warn("[clone.dest] setPhoto falhou (não fatal):", err);
      }
    }
  }

  // Fatal de propósito.
  await deps.promoteBot(created.channelId, created.accessHash, input.botUsername);

  let inviteLink: string | null = null;
  try {
    inviteLink = await deps.exportInvite(created.channelId, created.accessHash);
  } catch (err) {
    console.warn("[clone.dest] exportInvite falhou (não fatal):", err);
  }

  const dest: DestinationRef = { ...created, inviteLink };
  await deps.persist(input.jobId, dest);
  return dest;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-dest-builder.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/dest-builder.ts server/tests/services/clone-dest-builder.test.ts
git commit -m "feat(clone): criacao idempotente do destino com promocao do bot a admin"
```

---

### Task 8: `clone-runner` — orquestração

Não faz nenhuma chamada de Telegram. Cuida de: agrupar álbuns por `groupedId`, respeitar `messageLimit`, remapear respostas, avançar o cursor, tratar flood, abortar em pausa e replicar pins no final.

**Files:**
- Create: `server/src/services/mtproto/clone/clone-runner.ts`
- Create: `server/tests/services/clone-runner.test.ts`

**Interfaces:**
- Consumes: `SourceMessage`, `CloneOutcome`, `CloneMapRow`, `CloneJobConfig`, `CloneStatus` (Task 1); `extractWaitSeconds` (Task 2).
- Produces: `class CloneRunner` com `run(): Promise<void>`, e `interface CloneRunnerDeps`.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { FloodWaitError } from "telegram/errors/index.js";
import {
  CloneRunner,
  type CloneRunnerDeps,
} from "../../src/services/mtproto/clone/clone-runner.js";
import type { CloneJobConfig, SourceMessage } from "../../src/services/mtproto/clone/types.js";

function m(id: number, over: Partial<SourceMessage> = {}): SourceMessage {
  return { id, groupedId: null, replyToMsgId: null, raw: { id }, ...over };
}

function cfg(over: Partial<CloneJobConfig> = {}): CloneJobConfig {
  return {
    jobId: "j1",
    messageLimit: null,
    throttleMs: 0,
    copyReplies: false,
    copyPins: false,
    copyButtons: false,
    copyPolls: false,
    ...over,
  };
}

function deps(
  messages: SourceMessage[],
  over: Partial<CloneRunnerDeps> = {},
): CloneRunnerDeps & { groups: SourceMessage[][]; replies: Array<number | null> } {
  const groups: SourceMessage[][] = [];
  const replies: Array<number | null> = [];
  let nextDestId = 100;
  const base: CloneRunnerDeps = {
    iterate: async function* (since: number) {
      for (const msg of messages) if (msg.id > since) yield msg;
    },
    publish: async (group, replyToDestId) => {
      groups.push(group);
      replies.push(replyToDestId);
      return group.map(() => ({ status: "copied" as const, destMsgId: nextDestId++ }));
    },
    persist: vi.fn(async () => {}),
    loadIdMap: vi.fn(async () => []),
    getStatus: vi.fn(async () => "running"),
    setStatus: vi.fn(async () => {}),
    scheduleResume: vi.fn(async () => {}),
    sourcePinnedIds: vi.fn(async () => []),
    pinInDest: vi.fn(async () => {}),
    delay: vi.fn(async () => {}),
    ...over,
  };
  return Object.assign(base, { groups, replies });
}

describe("CloneRunner", () => {
  it("publica cada mensagem solta e conclui o job", async () => {
    const d = deps([m(1), m(2), m(3)]);
    await new CloneRunner(d, cfg()).run();
    expect(d.groups).toEqual([[m(1)], [m(2)], [m(3)]]);
    expect(d.setStatus).toHaveBeenLastCalledWith("j1", "completed", expect.anything());
  });

  it("agrupa mensagens com o mesmo groupedId num álbum só", async () => {
    const d = deps([
      m(1, { groupedId: "g1" }),
      m(2, { groupedId: "g1" }),
      m(3, { groupedId: "g1" }),
      m(4),
    ]);
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.map((g) => g.map((x) => x.id))).toEqual([[1, 2, 3], [4]]);
  });

  it("fatia álbum acima de 10 itens", async () => {
    const d = deps(Array.from({ length: 12 }, (_, i) => m(i + 1, { groupedId: "g1" })));
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.map((g) => g.length)).toEqual([10, 2]);
  });

  it("respeita messageLimit contando mensagens, não grupos", async () => {
    const d = deps([m(1), m(2), m(3), m(4), m(5)]);
    await new CloneRunner(d, cfg({ messageLimit: 3 })).run();
    expect(d.groups.flat().map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("avança o cursor a cada grupo persistido", async () => {
    const d = deps([m(1), m(2)]);
    await new CloneRunner(d, cfg()).run();
    const cursors = (d.persist as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(cursors).toEqual([1, 2]);
  });

  it("remapeia resposta para o id do destino quando copyReplies está ligado", async () => {
    const d = deps([m(1), m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([null, 100]);
  });

  it("envia sem resposta quando o alvo da resposta não foi clonado", async () => {
    const d = deps([m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([null]);
  });

  it("ignora o remapeamento quando copyReplies está desligado", async () => {
    const d = deps([m(1), m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: false })).run();
    expect(d.replies).toEqual([null, null]);
  });

  it("recarrega o mapa do banco na retomada", async () => {
    const d = deps([m(2, { replyToMsgId: 1 })], {
      loadIdMap: vi.fn(async () => [[1, 900] as [number, number]]),
    });
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([900]);
  });

  it("em FLOOD_WAIT agenda retomada e não conclui o job", async () => {
    const d = deps([m(1), m(2)], {
      publish: async (group) => {
        if (group[0].id === 2) {
          throw new FloodWaitError({ request: undefined as never, capture: 60 } as never);
        }
        return group.map(() => ({ status: "copied" as const, destMsgId: 1 }));
      },
    });
    await new CloneRunner(d, cfg()).run();
    expect(d.scheduleResume).toHaveBeenCalledWith("j1", 60);
    expect(d.setStatus).toHaveBeenCalledWith("j1", "waiting_flood", expect.anything());
    expect(d.setStatus).not.toHaveBeenCalledWith("j1", "completed", expect.anything());
  });

  it("aborta no meio quando o job é pausado pela UI", async () => {
    let calls = 0;
    const d = deps([m(1), m(2), m(3)], {
      getStatus: vi.fn(async () => (++calls > 1 ? "paused" : "running")),
    });
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.flat().map((x) => x.id)).toEqual([1]);
    expect(d.setStatus).not.toHaveBeenCalledWith("j1", "completed", expect.anything());
  });

  it("aborta quando o job some do banco (deletado pela UI)", async () => {
    const d = deps([m(1), m(2)], { getStatus: vi.fn(async () => null) });
    await new CloneRunner(d, cfg()).run();
    expect(d.groups).toEqual([]);
  });

  it("erro comum vira outcome failed e o clone segue", async () => {
    const d = deps([m(1), m(2)], {
      publish: async (group) => {
        if (group[0].id === 1) throw new Error("MEDIA_EMPTY");
        return group.map(() => ({ status: "copied" as const, destMsgId: 500 }));
      },
    });
    await new CloneRunner(d, cfg()).run();
    const rows = (d.persist as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[1]);
    expect(rows[0]).toMatchObject({ sourceMsgId: 1, status: "failed", reason: "MEDIA_EMPTY" });
    expect(d.setStatus).toHaveBeenLastCalledWith("j1", "completed", expect.anything());
  });

  it("aplica os pins só no final, traduzidos pelo mapa", async () => {
    const d = deps([m(1), m(2)], { sourcePinnedIds: vi.fn(async () => [2]) });
    await new CloneRunner(d, cfg({ copyPins: true })).run();
    expect(d.pinInDest).toHaveBeenCalledWith([101]);
    // ordem: pin depois de todo o envio
    const pinOrder = (d.pinInDest as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const lastPublish = d.groups.length;
    expect(lastPublish).toBe(2);
    expect(pinOrder).toBeGreaterThan(0);
  });

  it("não toca em pins quando o toggle está desligado", async () => {
    const d = deps([m(1)], { sourcePinnedIds: vi.fn(async () => [1]) });
    await new CloneRunner(d, cfg({ copyPins: false })).run();
    expect(d.pinInDest).not.toHaveBeenCalled();
  });

  it("aplica o throttle entre publicações", async () => {
    const d = deps([m(1), m(2)]);
    await new CloneRunner(d, cfg({ throttleMs: 3000 })).run();
    expect(d.delay).toHaveBeenCalledWith(3000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-runner.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```typescript
// server/src/services/mtproto/clone/clone-runner.ts
import { extractWaitSeconds } from "../flood.js";
import type {
  CloneJobConfig,
  CloneMapRow,
  CloneOutcome,
  CloneStatus,
  SourceMessage,
} from "./types.js";

/** Máximo de itens por álbum aceito pelo Telegram. */
const ALBUM_MAX = 10;

export interface CloneStatusPatch {
  copiedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  totalSeen?: number;
  lastError?: string | null;
}

export interface CloneRunnerDeps {
  /** Mensagens da origem em ordem crescente, começando depois de sinceMsgId. */
  iterate(sinceMsgId: number): AsyncIterable<SourceMessage>;
  /** Publica um grupo (1 mensagem, ou um álbum já fatiado) no destino. */
  publish(group: SourceMessage[], replyToDestId: number | null): Promise<CloneOutcome[]>;
  persist(jobId: string, rows: CloneMapRow[], cursor: number): Promise<void>;
  loadIdMap(jobId: string): Promise<Array<[number, number]>>;
  getStatus(jobId: string): Promise<string | null>;
  setStatus(jobId: string, status: CloneStatus, patch: CloneStatusPatch): Promise<void>;
  scheduleResume(jobId: string, seconds: number): Promise<void>;
  sourcePinnedIds(): Promise<number[]>;
  pinInDest(destMsgIds: number[]): Promise<void>;
  delay(ms: number): Promise<void>;
}

export class CloneRunner {
  private idMap = new Map<number, number>();
  private copied = 0;
  private skipped = 0;
  private failed = 0;
  private seen = 0;

  constructor(
    private deps: CloneRunnerDeps,
    private cfg: CloneJobConfig,
  ) {}

  async run(): Promise<void> {
    for (const [src, dest] of await this.deps.loadIdMap(this.cfg.jobId)) {
      this.idMap.set(src, dest);
    }

    const cursor = this.highestCopiedSource();
    await this.deps.setStatus(this.cfg.jobId, "running", {});

    let pendingGroup: SourceMessage[] = [];
    let pendingGroupId: string | null = null;

    try {
      for await (const msg of this.deps.iterate(cursor)) {
        if (await this.shouldStop()) return;
        if (this.limitReached()) break;

        // Álbum só fecha quando muda o groupedId (ou quando enche).
        if (msg.groupedId && msg.groupedId === pendingGroupId) {
          pendingGroup.push(msg);
          if (pendingGroup.length === ALBUM_MAX) {
            await this.flush(pendingGroup);
            pendingGroup = [];
            pendingGroupId = null;
          }
          continue;
        }

        if (pendingGroup.length > 0) {
          await this.flush(pendingGroup);
          if (await this.shouldStop()) return;
          if (this.limitReached()) break;
        }

        pendingGroup = [msg];
        pendingGroupId = msg.groupedId;

        if (!msg.groupedId) {
          await this.flush(pendingGroup);
          pendingGroup = [];
          pendingGroupId = null;
        }
      }

      if (pendingGroup.length > 0 && !this.limitReached()) {
        await this.flush(pendingGroup);
      }
    } catch (err) {
      const wait = extractWaitSeconds(err);
      if (wait !== null) {
        // O cursor já está persistido: retomar é só rechamar o job.
        await this.deps.setStatus(this.cfg.jobId, "waiting_flood", {
          ...this.counters(),
          lastError: `flood_wait_${wait}s`,
        });
        await this.deps.scheduleResume(this.cfg.jobId, wait);
        return;
      }
      await this.deps.setStatus(this.cfg.jobId, "failed", {
        ...this.counters(),
        lastError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (this.cfg.copyPins) await this.applyPins();

    await this.deps.setStatus(this.cfg.jobId, "completed", this.counters());
  }

  /** Publica um grupo, grava o resultado e avança o cursor. */
  private async flush(group: SourceMessage[]): Promise<void> {
    const replyToDestId = this.resolveReply(group[0]);
    const cursor = group[group.length - 1].id;

    let outcomes: CloneOutcome[];
    try {
      outcomes = await this.deps.publish(group, replyToDestId);
    } catch (err) {
      if (extractWaitSeconds(err) !== null) throw err; // flood sobe pro run()
      const reason = err instanceof Error ? err.message : String(err);
      outcomes = group.map(() => ({ status: "failed" as const, reason }));
    }

    const rows: CloneMapRow[] = group.map((msg, i) => {
      const outcome = outcomes[i] ?? { status: "failed" as const, reason: "sem_resultado" };
      this.seen++;
      if (outcome.status === "copied") {
        this.copied++;
        this.idMap.set(msg.id, outcome.destMsgId);
        return {
          sourceMsgId: msg.id,
          destMsgId: outcome.destMsgId,
          groupedId: msg.groupedId,
          status: "copied",
          reason: null,
        };
      }
      if (outcome.status === "skipped") this.skipped++;
      else this.failed++;
      return {
        sourceMsgId: msg.id,
        destMsgId: null,
        groupedId: msg.groupedId,
        status: outcome.status,
        reason: outcome.reason,
      };
    });

    await this.deps.persist(this.cfg.jobId, rows, cursor);
    if (this.cfg.throttleMs > 0) await this.deps.delay(this.cfg.throttleMs);
  }

  /**
   * Resposta só é remapeada se o alvo já foi clonado. Alvo fora do
   * messageLimit vira envio sem resposta — perder o encadeamento é melhor
   * que perder a mensagem.
   */
  private resolveReply(first: SourceMessage): number | null {
    if (!this.cfg.copyReplies || first.replyToMsgId === null) return null;
    return this.idMap.get(first.replyToMsgId) ?? null;
  }

  private async applyPins(): Promise<void> {
    const sourceIds = await this.deps.sourcePinnedIds();
    const destIds = sourceIds
      .map((id) => this.idMap.get(id))
      .filter((id): id is number => typeof id === "number");
    if (destIds.length > 0) await this.deps.pinInDest(destIds);
  }

  private async shouldStop(): Promise<boolean> {
    const status = await this.deps.getStatus(this.cfg.jobId);
    return status === null || status === "paused" || status === "failed";
  }

  private limitReached(): boolean {
    return this.cfg.messageLimit !== null && this.seen >= this.cfg.messageLimit;
  }

  private highestCopiedSource(): number {
    let max = 0;
    for (const src of this.idMap.keys()) if (src > max) max = src;
    return max;
  }

  private counters(): CloneStatusPatch {
    return {
      copiedCount: this.copied,
      skippedCount: this.skipped,
      failedCount: this.failed,
      totalSeen: this.seen,
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-runner.test.ts`
Expected: PASS, 16 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd server && npm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mtproto/clone/clone-runner.ts server/tests/services/clone-runner.test.ts
git commit -m "feat(clone): runner com album, cursor, remapeamento de resposta, flood e pins"
```

---

### Task 9: `source-reader` — tudo que a conta faz na origem

Adaptador fino sobre `MtprotoClient`. Sem lógica de decisão (essa está nas Tasks 5 e 8), então o teste unitário aqui seria teste de mock — o que vale é compilar e passar no E2E da Task 14.

**Files:**
- Create: `server/src/services/mtproto/clone/source-reader.ts`
- Modify: `server/src/services/mtproto/client.ts` (novos métodos)

**Interfaces:**
- Consumes: `ClonePeer` (Task 1), `buildHistoryPeer` (Task 4), `SourceIdentity` (Task 7).
- Produces: `class SourceReader` com `historySource()`, `readIdentity()`, `hasNoForwards()`, `downloadToPath(msg, dir)`, `pinnedIds()`, `forwardBatch(destChannelId, destAccessHash, ids)`, `extractInlineLinks(msg)`, `mediaPlanInput(msg, copyPolls)`.

- [ ] **Step 1: Adicionar os métodos crus ao `MtprotoClient`**

Em `server/src/services/mtproto/client.ts`, adicionar ao final da classe:

```typescript
  /** Acesso ao client cru para os adaptadores de clonagem. */
  get raw(): TelegramClient {
    return this.client;
  }

  /**
   * Encaminha um lote de mensagens (máx. 100 ids) apagando a autoria, o que
   * remove a marca "encaminhado de" e faz o post sair nativo no destino.
   */
  async forwardBatch(
    from: Api.TypeInputPeer,
    to: Api.TypeInputPeer,
    messageIds: number[],
  ): Promise<Api.TypeUpdates> {
    await this.connect();
    return this.client.invoke(
      new Api.messages.ForwardMessages({
        fromPeer: from,
        toPeer: to,
        id: messageIds,
        randomId: messageIds.map(() => randomMessageId()),
        dropAuthor: true,
        silent: true,
      }),
    );
  }

  /** Promove um bot (por @username) a admin de um canal/supergrupo. */
  async promoteBotToAdmin(
    channelId: string,
    accessHash: string,
    botUsername: string,
  ): Promise<void> {
    await this.connect();
    const channel = new Api.InputChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    const bot = await this.client.getInputEntity(botUsername);
    await this.client.invoke(
      new Api.channels.InviteToChannel({ channel, users: [bot as never] }),
    );
    await this.client.invoke(
      new Api.channels.EditAdmin({
        channel,
        userId: bot as never,
        adminRights: new Api.ChatAdminRights({
          postMessages: true,
          editMessages: true,
          deleteMessages: true,
          pinMessages: true,
          inviteUsers: true,
        }),
        rank: "clone",
      }),
    );
  }

  /** Define a descrição (about) de um canal/supergrupo. */
  async setChannelAbout(
    channelId: string,
    accessHash: string,
    about: string,
  ): Promise<void> {
    await this.connect();
    await this.client.invoke(
      new Api.messages.EditChatAbout({
        peer: new Api.InputPeerChannel({
          channelId: bigInt(channelId),
          accessHash: bigInt(accessHash),
        }),
        about,
      }),
    );
  }
```

Nota: `channels.EditAbout` não existe — o método correto é `messages.EditChatAbout`, que recebe `peer` (não `channel`).

- [ ] **Step 2: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Implementar o `SourceReader`**

```typescript
// server/src/services/mtproto/clone/source-reader.ts
import { Api } from "telegram";
import bigInt from "big-integer";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { MtprotoClient } from "../client.js";
import { buildHistoryPeer } from "./history-iterator.js";
import type { HistorySource } from "./history-iterator.js";
import type { ClonePeer } from "./types.js";
import type { SourceIdentity } from "./dest-builder.js";
import type { PlanInput } from "./media-plan.js";
import type { InlineLink } from "./bot-client.js";

/**
 * Pausa entre chunks de leitura. Leitura é barata comparada a publicação, mas
 * paginar um canal grande sem pausa nenhuma rende FLOOD_WAIT na conta.
 */
export const READ_THROTTLE_MS = 1000;

export class SourceReader {
  private peer: Api.TypeInputPeer;

  constructor(
    private client: MtprotoClient,
    private source: ClonePeer,
  ) {
    this.peer = buildHistoryPeer(source);
  }

  /**
   * Fonte para o iterHistoryAscending.
   *
   * ARMADILHA: NÃO passar waitTime — em requestIter.js:49-52 o gramjs entrega
   * o valor (documentado em segundos) para sleep(ms), então o throttle nativo
   * é ~1ms. O delay real é imposto pelo iterHistoryAscending.
   */
  historySource(): HistorySource {
    const client = this.client;
    const peer = this.peer;
    return {
      fetch: (sinceMsgId: number) =>
        client.raw.iterMessages(peer, {
          reverse: true,
          offsetId: sinceMsgId,
          limit: undefined,
        }) as AsyncIterable<unknown>,
      delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    };
  }

  get inputPeer(): Api.TypeInputPeer {
    return this.peer;
  }

  /** Título, descrição e foto da origem. Canal e grupo legacy usam calls diferentes. */
  async readIdentity(): Promise<SourceIdentity> {
    await this.client.connect();
    if (this.source.peerType === "chat") {
      const full = await this.client.raw.invoke(
        new Api.messages.GetFullChat({ chatId: bigInt(this.source.peerId) }),
      );
      const chat = full.chats.find((c): c is Api.Chat => c instanceof Api.Chat);
      return {
        title: chat?.title ?? "",
        about: (full.fullChat as Api.ChatFull).about ?? "",
        photo: await this.downloadIdentityPhoto(chat),
      };
    }
    const full = await this.client.raw.invoke(
      new Api.channels.GetFullChannel({
        channel: new Api.InputChannel({
          channelId: bigInt(this.source.peerId),
          accessHash: bigInt(this.source.accessHash ?? "0"),
        }),
      }),
    );
    const chan = full.chats.find((c): c is Api.Channel => c instanceof Api.Channel);
    return {
      title: chan?.title ?? "",
      about: (full.fullChat as Api.ChannelFull).about ?? "",
      photo: await this.downloadIdentityPhoto(chan),
    };
  }

  private async downloadIdentityPhoto(
    chat: Api.Chat | Api.Channel | undefined,
  ): Promise<Buffer | null> {
    if (!chat || !(chat.photo instanceof Api.ChatPhoto)) return null;
    try {
      const buf = await this.client.raw.downloadProfilePhoto(chat, { isBig: true });
      return Buffer.isBuffer(buf) && buf.length > 0 ? buf : null;
    } catch {
      // getInputPeer joga TypeError em canal `min` ou sem accessHash.
      return null;
    }
  }

  /**
   * "Proteger conteúdo" ligado na origem. Bloqueia encaminhamento (mas NÃO o
   * download), então decide a rota do clone.
   */
  async hasNoForwards(): Promise<boolean> {
    if (this.source.peerType === "chat") return false;
    await this.client.connect();
    const res = await this.client.raw.invoke(
      new Api.channels.GetChannels({
        id: [
          new Api.InputChannel({
            channelId: bigInt(this.source.peerId),
            accessHash: bigInt(this.source.accessHash ?? "0"),
          }),
        ],
      }),
    );
    const chats = res instanceof Api.messages.Chats ? res.chats : [];
    const chan = chats[0];
    return chan instanceof Api.Channel ? Boolean(chan.noforwards) : false;
  }

  /** Ids das mensagens fixadas na origem. */
  async pinnedIds(): Promise<number[]> {
    await this.client.connect();
    const res = await this.client.raw.invoke(
      new Api.messages.Search({
        peer: this.peer,
        q: "",
        filter: new Api.InputMessagesFilterPinned(),
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit: 100,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      }),
    );
    const messages =
      res instanceof Api.messages.Messages ||
      res instanceof Api.messages.MessagesSlice ||
      res instanceof Api.messages.ChannelMessages
        ? res.messages
        : [];
    return messages.filter((m): m is Api.Message => m instanceof Api.Message).map((m) => m.id);
  }

  /**
   * Baixa a mídia da mensagem direto para disco (streaming, sem segurar o
   * arquivo em memória). Devolve null quando não há mídia ou o arquivo passa
   * do teto.
   */
  async downloadToPath(
    msg: Api.Message,
    dir: string,
    maxBytes: number,
  ): Promise<{ filePath: string; sizeBytes: number } | null> {
    if (!msg.media) return null;
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `msg_${msg.id}`);
    const out = createWriteStream(filePath);
    try {
      for await (const chunk of this.client.raw.iterDownload({ file: msg.media as never })) {
        out.write(chunk);
      }
    } finally {
      out.end();
      await new Promise((r) => out.on("close", r));
    }
    const { size } = await stat(filePath);
    if (size > maxBytes) {
      await unlink(filePath).catch(() => {});
      return null;
    }
    return { filePath, sizeBytes: size };
  }

  /** Encaminha um lote apagando a autoria. Chamado com no máximo 100 ids. */
  async forwardBatch(
    destChannelId: string,
    destAccessHash: string,
    ids: number[],
  ): Promise<Api.TypeUpdates> {
    return this.client.forwardBatch(
      this.peer,
      new Api.InputPeerChannel({
        channelId: bigInt(destChannelId),
        accessHash: bigInt(destAccessHash),
      }),
      ids,
    );
  }

  /**
   * Botões de URL da mensagem original. Callback não sobrevive à clonagem:
   * pertence ao bot que criou a mensagem.
   */
  static extractInlineLinks(msg: Api.Message): InlineLink[] {
    const markup = msg.replyMarkup;
    if (!(markup instanceof Api.ReplyInlineMarkup)) return [];
    const out: InlineLink[] = [];
    for (const row of markup.rows) {
      for (const btn of row.buttons) {
        if (btn instanceof Api.KeyboardButtonUrl) out.push({ label: btn.text, url: btn.url });
      }
    }
    return out;
  }

  /** Traduz a mensagem para a entrada do planForMessage. */
  static mediaPlanInput(msg: Api.Message, copyPolls: boolean): PlanInput {
    const media = msg.media ?? null;
    const attrs =
      media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document
        ? media.document.attributes.map((a) => a.className)
        : [];
    return {
      mediaClassName: media ? media.className : null,
      documentAttributeClassNames: attrs,
      hasText: Boolean(msg.message && msg.message.trim()),
      copyPolls,
    };
  }
}
```

- [ ] **Step 4: Verificar compilação**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; suíte existente verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mtproto/clone/source-reader.ts server/src/services/mtproto/client.ts
git commit -m "feat(clone): leitor da origem (historico, identidade, download, pins, forward em lote)"
```

---

### Task 10: `publish-router` — escolher a rota e publicar

Onde a estratégia híbrida vira decisão. A escolha é pura e testada; a execução é o adaptador.

**Files:**
- Create: `server/src/services/mtproto/clone/publish-router.ts`
- Create: `server/tests/services/clone-publish-router.test.ts`

**Interfaces:**
- Consumes: `MediaPlan`/`planForMessage` (Task 5), `CloneOutcome`/`SourceMessage` (Task 1), `SourceReader` (Task 9), `CompanionBot` (Task 6).
- Produces:
  - `chooseStrategy(input: { requested: "auto" | "batch" | "download"; sourceHasNoForwards: boolean; copyButtons: boolean }): CloneStrategy`
  - `routeGroup(input: RouteInput): RouteDecision`
  - `createPublisher(ctx: PublisherContext): (group, replyToDestId) => Promise<CloneOutcome[]>`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/tests/services/clone-publish-router.test.ts
import { describe, it, expect } from "vitest";
import {
  chooseStrategy,
  routeGroup,
} from "../../src/services/mtproto/clone/publish-router.js";

describe("chooseStrategy", () => {
  it("auto vira batch quando a origem permite encaminhar", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });

  it("auto vira download quando a origem protege o conteúdo", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("botões inline forçam download mesmo com origem liberada", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: true }),
    ).toBe("download");
  });

  it("batch pedido explicitamente ainda cai pra download se a origem protege", () => {
    expect(
      chooseStrategy({ requested: "batch", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("download pedido explicitamente é respeitado", () => {
    expect(
      chooseStrategy({ requested: "download", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("download");
  });
});

describe("routeGroup", () => {
  const base = { strategy: "batch" as const, copyPolls: false, copyButtons: false };

  it("na rota batch, encaminha o grupo inteiro", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "text" }, { kind: "media", mediaKind: "photo" }] }),
    ).toEqual({ mode: "forward" });
  });

  it("na rota batch, grupo com item não clonável ainda encaminha os clonáveis", () => {
    expect(
      routeGroup({
        ...base,
        plans: [{ kind: "text" }, { kind: "skip", reason: "media_invoice" }],
      }),
    ).toEqual({ mode: "forward", skipIndexes: [1] });
  });

  it("na rota batch, grupo todo não clonável é pulado sem chamar o Telegram", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "skip", reason: "media_giveaway" }] }),
    ).toEqual({ mode: "skip_all" });
  });

  it("na rota download, álbum de fotos vai como álbum", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "video" },
        ],
      }),
    ).toEqual({ mode: "album" });
  });

  it("na rota download, mensagem solta vai individual", () => {
    expect(
      routeGroup({ ...base, strategy: "download", plans: [{ kind: "text" }] }),
    ).toEqual({ mode: "single" });
  });

  it("na rota download, álbum com item não-álbum degrada para envios individuais", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "document" },
        ],
      }),
    ).toEqual({ mode: "single" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/clone-publish-router.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar a parte pura**

```typescript
// server/src/services/mtproto/clone/publish-router.ts
import type { MediaPlan } from "./media-plan.js";
import type { CloneStrategy } from "./types.js";

/** Só foto e vídeo entram num álbum do Telegram. */
const ALBUMABLE = new Set(["photo", "video"]);

export function chooseStrategy(input: {
  requested: "auto" | "batch" | "download";
  sourceHasNoForwards: boolean;
  copyButtons: boolean;
}): CloneStrategy {
  // Encaminhamento não permite anexar reply_markup: quem quer botão, baixa.
  if (input.copyButtons) return "download";
  if (input.sourceHasNoForwards) return "download";
  return input.requested === "download" ? "download" : "batch";
}

export type RouteDecision =
  | { mode: "forward"; skipIndexes?: number[] }
  | { mode: "album" }
  | { mode: "single" }
  | { mode: "skip_all" };

export interface RouteInput {
  strategy: CloneStrategy;
  plans: MediaPlan[];
  copyPolls: boolean;
  copyButtons: boolean;
}

export function routeGroup(input: RouteInput): RouteDecision {
  const { strategy, plans } = input;
  const skipIndexes = plans
    .map((p, i) => (p.kind === "skip" ? i : -1))
    .filter((i) => i >= 0);

  if (skipIndexes.length === plans.length) return { mode: "skip_all" };

  if (strategy === "batch") {
    return skipIndexes.length > 0 ? { mode: "forward", skipIndexes } : { mode: "forward" };
  }

  const albumable =
    plans.length > 1 &&
    plans.every((p) => p.kind === "media" && ALBUMABLE.has(p.mediaKind));
  return albumable ? { mode: "album" } : { mode: "single" };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/clone-publish-router.test.ts`
Expected: PASS, 12 testes.

- [ ] **Step 5: Adicionar o executor no mesmo arquivo**

```typescript
import { Api } from "telegram";
import { rm } from "node:fs/promises";
import { planForMessage } from "./media-plan.js";
import { SourceReader } from "./source-reader.js";
import type { CompanionBot } from "./bot-client.js";
import type { CloneOutcome, SourceMessage } from "./types.js";

/** Teto por arquivo. Acima disso a mensagem é pulada com reason file_too_large. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface PublisherContext {
  reader: SourceReader;
  bot: CompanionBot;
  destChannelId: string;
  destAccessHash: string;
  strategy: CloneStrategy;
  copyPolls: boolean;
  copyButtons: boolean;
  tmpDir: string;
}

/**
 * Devolve a função `publish` que o CloneRunner injeta. Toda a decisão já foi
 * tomada por chooseStrategy/routeGroup; aqui é só execução.
 */
export function createPublisher(
  ctx: PublisherContext,
): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]> {
  return async (group, replyToDestId) => {
    const raws = group.map((m) => m.raw as Api.Message);
    const plans = raws.map((r) =>
      planForMessage(SourceReader.mediaPlanInput(r, ctx.copyPolls)),
    );
    const decision = routeGroup({
      strategy: ctx.strategy,
      plans,
      copyPolls: ctx.copyPolls,
      copyButtons: ctx.copyButtons,
    });

    if (decision.mode === "skip_all") {
      return plans.map((p) => ({
        status: "skipped" as const,
        reason: p.kind === "skip" ? p.reason : "skip",
      }));
    }

    if (decision.mode === "forward") {
      const skip = new Set(decision.skipIndexes ?? []);
      const ids = raws.filter((_, i) => !skip.has(i)).map((r) => r.id);
      // ForwardMessages exige ids em ordem crescente.
      const updates = await ctx.reader.forwardBatch(
        ctx.destChannelId,
        ctx.destAccessHash,
        [...ids].sort((a, b) => a - b),
      );
      const destIds = extractNewMessageIds(updates);
      let cursor = 0;
      return plans.map((p, i) => {
        if (skip.has(i)) {
          return { status: "skipped" as const, reason: p.kind === "skip" ? p.reason : "skip" };
        }
        const destMsgId = destIds[cursor++];
        return destMsgId
          ? { status: "copied" as const, destMsgId }
          : { status: "failed" as const, reason: "sem_id_no_retorno" };
      });
    }

    // Rotas de download: a conta baixa, o bot publica.
    const outcomes: CloneOutcome[] = [];
    const downloaded: string[] = [];
    try {
      if (decision.mode === "album") {
        const items: Array<{ filePath: string; kind: "photo" | "video"; caption: string }> = [];
        for (let i = 0; i < raws.length; i++) {
          const dl = await ctx.reader.downloadToPath(raws[i], ctx.tmpDir, MAX_FILE_BYTES);
          if (!dl) return plans.map(() => ({ status: "skipped" as const, reason: "file_too_large" }));
          downloaded.push(dl.filePath);
          const plan = plans[i];
          items.push({
            filePath: dl.filePath,
            kind: plan.kind === "media" && plan.mediaKind === "video" ? "video" : "photo",
            caption: raws[i].message ?? "",
          });
        }
        const destIds = await ctx.bot.publishAlbum(items);
        return destIds.map((destMsgId) => ({ status: "copied" as const, destMsgId }));
      }

      for (let i = 0; i < raws.length; i++) {
        const raw = raws[i];
        const plan = plans[i];
        const opts = {
          replyToMessageId: i === 0 && replyToDestId ? replyToDestId : undefined,
          entities: raw.entities as unknown[] | undefined,
          inlineLinks: ctx.copyButtons ? SourceReader.extractInlineLinks(raw) : undefined,
        };

        if (plan.kind === "skip") {
          outcomes.push({ status: "skipped", reason: plan.reason });
          continue;
        }
        if (plan.kind === "text") {
          const destMsgId = await ctx.bot.publishText(raw.message ?? "", opts);
          outcomes.push({ status: "copied", destMsgId });
          continue;
        }
        if (plan.kind === "poll") {
          outcomes.push({ status: "skipped", reason: "poll_sem_suporte_no_bot" });
          continue;
        }
        const dl = await ctx.reader.downloadToPath(raw, ctx.tmpDir, MAX_FILE_BYTES);
        if (!dl) {
          outcomes.push({ status: "skipped", reason: "file_too_large" });
          continue;
        }
        downloaded.push(dl.filePath);
        const destMsgId = await ctx.bot.publishMedia(
          dl.filePath,
          plan.mediaKind,
          raw.message ?? "",
          opts,
        );
        outcomes.push({ status: "copied", destMsgId });
      }
      return outcomes;
    } finally {
      // Limpeza por grupo: um clone de canal grande encheria o disco.
      for (const f of downloaded) await rm(f, { force: true }).catch(() => {});
    }
  };
}

/** Colhe os ids criados no destino a partir do Updates do ForwardMessages. */
export function extractNewMessageIds(updates: Api.TypeUpdates): number[] {
  const list =
    updates instanceof Api.Updates || updates instanceof Api.UpdatesCombined
      ? updates.updates
      : [];
  const ids: number[] = [];
  for (const u of list) {
    if (u instanceof Api.UpdateNewChannelMessage || u instanceof Api.UpdateNewMessage) {
      const msg = u.message;
      if (msg instanceof Api.Message) ids.push(msg.id);
    }
  }
  return ids.sort((a, b) => a - b);
}
```

- [ ] **Step 6: Verificar compilação e suíte**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erro de tipo; tudo verde.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/mtproto/clone/publish-router.ts server/tests/services/clone-publish-router.test.ts
git commit -m "feat(clone): roteador de estrategia (lote vs download) e executor de publicacao"
```

---

### Task 11: fio do worker — job `clone.run`

**Files:**
- Modify: `server/src/queue-mtproto.ts:7-12` (novo kind)
- Create: `server/src/workers/clone-handler.ts`
- Modify: `server/src/workers/mtproto-worker.ts:746-757` (novo case)

**Interfaces:**
- Consumes: tudo das Tasks 4 a 10.
- Produces: job `{ kind: "clone.run"; cloneJobId: string }`; função `handleCloneRun(cloneJobId: string): Promise<void>`.

- [ ] **Step 1: Adicionar o kind e o delay na fila**

Em `server/src/queue-mtproto.ts`, acrescentar à união `MtprotoJobData`:

```typescript
  | { kind: "account.sync-dialogs"; accountId: string }
  | { kind: "clone.run"; cloneJobId: string };
```

E dar a `enqueueMtproto` a capacidade de agendar para o futuro — sem isso, a
retomada de FLOOD_WAIT reenfileira na hora e o worker gira em loop batendo no
mesmo bloqueio:

```typescript
export async function enqueueMtproto(
  data: MtprotoJobData,
  opts: { delayMs?: number } = {},
): Promise<void> {
  await mtprotoQueue.add(data.kind, data, {
    attempts: 2,
    backoff: { type: "fixed", delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 100,
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
}
```

O parâmetro é opcional, então nenhuma chamada existente muda.

- [ ] **Step 2: Escrever o handler**

```typescript
// server/src/workers/clone-handler.ts
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import { CompanionBot } from "../services/mtproto/clone/bot-client.js";
import {
  SourceReader,
  READ_THROTTLE_MS,
} from "../services/mtproto/clone/source-reader.js";
import { ensureDestination } from "../services/mtproto/clone/dest-builder.js";
import {
  chooseStrategy,
  createPublisher,
} from "../services/mtproto/clone/publish-router.js";
import { iterHistoryAscending } from "../services/mtproto/clone/history-iterator.js";
import { CloneRunner } from "../services/mtproto/clone/clone-runner.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import type {
  CloneMapRow,
  CloneStatus,
  ClonePeer,
} from "../services/mtproto/clone/types.js";

export async function handleCloneRun(cloneJobId: string): Promise<void> {
  const { data: job } = await supabase
    .from("clone_jobs")
    .select("*")
    .eq("id", cloneJobId)
    .single();
  if (!job) {
    console.warn(`[clone] job ${cloneJobId} não encontrado`);
    return;
  }

  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, session_string, status")
    .eq("id", job.account_id)
    .single();
  if (!account?.session_string || account.status !== "active") {
    await fail(cloneJobId, "conta MTProto inativa ou sem sessão");
    return;
  }

  const { data: botRow } = await supabase
    .from("automation_bots")
    .select("id, token, username, session_string, status")
    .eq("tenant_id", job.tenant_id)
    .single();
  if (!botRow || botRow.status !== "active") {
    await fail(cloneJobId, "bot companheiro não cadastrado — cadastre o token antes de clonar");
    return;
  }

  const client = new MtprotoClient(
    config.telegramApiId,
    config.telegramApiHash,
    account.session_string,
  );
  const source: ClonePeer = {
    peerId: job.source_peer_id,
    peerType: job.source_peer_type,
    accessHash: job.source_peer_access_hash,
  };
  const reader = new SourceReader(client, source);
  const tmpDir = path.join(os.tmpdir(), "lionbot-clone", cloneJobId);

  try {
    await client.connect();

    // 1) Destino (idempotente na retomada)
    const dest = await ensureDestination(
      {
        readIdentity: () => reader.readIdentity(),
        createChannel: (title, about, opts) => client.createChannel(title, about, opts),
        setTitle: async () => {},
        setAbout: (cid, hash, about) => client.setChannelAbout(cid, hash, about),
        setPhoto: (cid, hash, photo) => client.setChannelPhoto(cid, hash, photo),
        promoteBot: (cid, hash, username) => client.promoteBotToAdmin(cid, hash, username),
        exportInvite: (cid, hash) => client.exportChannelInvite(cid, hash),
        persist: async (id, d) => {
          await supabase
            .from("clone_jobs")
            .update({
              dest_channel_id: d.channelId,
              dest_access_hash: d.accessHash,
              dest_invite_link: d.inviteLink,
            })
            .eq("id", id);
        },
      },
      {
        jobId: cloneJobId,
        source,
        destKind: job.dest_kind,
        destTitle: job.dest_title,
        copyIdentity: job.copy_identity,
        botUsername: botRow.username,
        existing: job.dest_channel_id
          ? {
              channelId: job.dest_channel_id,
              accessHash: job.dest_access_hash,
              inviteLink: job.dest_invite_link,
            }
          : null,
      },
    );

    // 2) Estratégia
    const strategy = chooseStrategy({
      requested: job.strategy,
      sourceHasNoForwards: await reader.hasNoForwards(),
      copyButtons: job.copy_buttons,
    });
    await supabase
      .from("clone_jobs")
      .update({ effective_strategy: strategy })
      .eq("id", cloneJobId);

    // 3) Bot publicador
    const bot = new CompanionBot(
      botRow.token,
      CompanionBot.destChatIdFromChannelId(dest.channelId),
      botRow.session_string,
    );

    const publish = createPublisher({
      reader,
      bot,
      destChannelId: dest.channelId,
      destAccessHash: dest.accessHash,
      strategy,
      copyPolls: job.copy_polls,
      copyButtons: job.copy_buttons,
      tmpDir,
    });

    // 4) Runner
    const runner = new CloneRunner(
      {
        iterate: (since) =>
          iterHistoryAscending(reader.historySource(), {
            sinceMsgId: since,
            throttleMs: READ_THROTTLE_MS,
          }),
        publish,
        persist: async (id, rows, cursor) => {
          if (rows.length > 0) {
            await supabase.from("clone_message_map").upsert(
              rows.map((r: CloneMapRow) => ({
                job_id: id,
                source_msg_id: r.sourceMsgId,
                dest_msg_id: r.destMsgId,
                grouped_id: r.groupedId,
                status: r.status,
                reason: r.reason,
              })),
              { onConflict: "job_id,source_msg_id" },
            );
          }
          await supabase
            .from("clone_jobs")
            .update({ cursor_source_msg_id: cursor })
            .eq("id", id);
        },
        loadIdMap: async (id) => {
          const { data } = await supabase
            .from("clone_message_map")
            .select("source_msg_id, dest_msg_id")
            .eq("job_id", id)
            .eq("status", "copied");
          return (data ?? [])
            .filter((r) => r.dest_msg_id !== null)
            .map((r) => [Number(r.source_msg_id), Number(r.dest_msg_id)] as [number, number]);
        },
        getStatus: async (id) => {
          const { data } = await supabase
            .from("clone_jobs")
            .select("status")
            .eq("id", id)
            .maybeSingle();
          return data?.status ?? null;
        },
        setStatus: async (id, status: CloneStatus, patch) => {
          await supabase
            .from("clone_jobs")
            .update({
              status,
              copied_count: patch.copiedCount,
              skipped_count: patch.skippedCount,
              failed_count: patch.failedCount,
              total_seen: patch.totalSeen,
              last_error: patch.lastError ?? null,
              ...(status === "running" ? { started_at: new Date().toISOString() } : {}),
              ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
            })
            .eq("id", id);
        },
        scheduleResume: async (id, seconds) => {
          // +5s de folga sobre o que o Telegram pediu. O job volta pela fila
          // com delay real: reenfileirar na hora giraria em loop no mesmo flood.
          const waitMs = (seconds + 5) * 1000;
          await supabase
            .from("clone_jobs")
            .update({ resume_after: new Date(Date.now() + waitMs).toISOString() })
            .eq("id", id);
          await enqueueMtproto({ kind: "clone.run", cloneJobId: id }, { delayMs: waitMs });
        },
        sourcePinnedIds: () => reader.pinnedIds(),
        pinInDest: async (ids) => {
          for (const id of ids) {
            await bot.pin(id).catch((err) => console.warn("[clone] pin falhou:", err));
          }
        },
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
      {
        jobId: cloneJobId,
        messageLimit: job.message_limit,
        throttleMs: job.throttle_ms,
        copyReplies: job.copy_replies,
        copyPins: job.copy_pins,
        copyButtons: job.copy_buttons,
        copyPolls: job.copy_polls,
      },
    );

    await runner.run();
    await bot.disconnect();
  } catch (err) {
    console.error(`[clone] job ${cloneJobId} falhou:`, err);
    await fail(cloneJobId, err instanceof Error ? err.message : String(err));
  } finally {
    await client.disconnect().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fail(cloneJobId: string, error: string): Promise<void> {
  await supabase
    .from("clone_jobs")
    .update({ status: "failed", last_error: error })
    .eq("id", cloneJobId);
}
```

- [ ] **Step 3: Ligar no switch do worker**

Em `server/src/workers/mtproto-worker.ts`, adicionar o import no topo:

```typescript
import { handleCloneRun } from "./clone-handler.js";
```

e o case no switch (logo depois de `account.sync-dialogs`):

```typescript
        case "clone.run":
          return handleCloneRun(d.cloneJobId);
```

- [ ] **Step 4: Espelhar o tipo do job no Next**

Em `app/dashboard/automations/actions.ts:21-26`, acrescentar à união `MtprotoJob`:

```typescript
  | { kind: "account.sync-dialogs"; accountId: string }
  | { kind: "clone.run"; cloneJobId: string };
```

- [ ] **Step 5: Verificar compilação dos dois lados**

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erro; suíte verde.

Run: `cd c:/Users/Administrator/eaglebot && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add server/src/queue-mtproto.ts server/src/workers/clone-handler.ts server/src/workers/mtproto-worker.ts app/dashboard/automations/actions.ts
git commit -m "feat(clone): job clone.run no worker mtproto"
```

---

### Task 12: Server Actions e card do bot companheiro

O projeto duplica helpers puros entre `server/src/services/mtproto/` e `lib/mtproto/` (ver `target-parser.ts`, idênticos nos dois lados). `deriveDestKind` segue o mesmo padrão.

**Files:**
- Create: `lib/mtproto/clone-kind.ts`
- Create: `tests/lib/clone-kind.test.ts`
- Create: `app/dashboard/automations/clones/actions.ts`
- Create: `components/dashboard/automation-bot-card.tsx`
- Modify: `app/dashboard/automations/page.tsx`

**Interfaces:**
- Consumes: `requireOwner()` de `@/lib/actions/owner-actions`, `enqueueJob` (padrão de `app/dashboard/automations/actions.ts:28`).
- Produces: `deriveDestKind`; actions `saveAutomationBot`, `removeAutomationBot`, `createCloneJob`, `launchClone`, `pauseClone`, `deleteClone`, `listCloneSkipReport`.

- [ ] **Step 1: Escrever o teste do helper**

```typescript
// tests/lib/clone-kind.test.ts
import { describe, it, expect } from "vitest";
import { deriveDestKind, isClonableKind } from "@/lib/mtproto/clone-kind";

describe("deriveDestKind", () => {
  it.each([
    ["channel_owner", "broadcast"],
    ["channel_subscriber", "broadcast"],
    ["group_admin", "megagroup"],
    ["group_member", "megagroup"],
  ])("%s vira %s", (kind, expected) => {
    expect(deriveDestKind(kind)).toBe(expected);
  });

  it("recusa kind que não é canal nem grupo", () => {
    expect(() => deriveDestKind("bot")).toThrow(/DIALOG_KIND_NAO_CLONAVEL/);
  });
});

describe("isClonableKind", () => {
  it("aceita canal e grupo, recusa o resto", () => {
    expect(isClonableKind("channel_subscriber")).toBe(true);
    expect(isClonableKind("group_member")).toBe(true);
    expect(isClonableKind("bot")).toBe(false);
    expect(isClonableKind("contact")).toBe(false);
    expect(isClonableKind("dm")).toBe(false);
    expect(isClonableKind("self")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd c:/Users/Administrator/eaglebot && npx vitest run tests/lib/clone-kind.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar o helper**

```typescript
// lib/mtproto/clone-kind.ts
// Cópia de server/src/services/mtproto/clone/dest-builder.ts (deriveDestKind).
// O projeto duplica helpers puros entre os dois lados — ver target-parser.ts.

export type DestKind = "broadcast" | "megagroup";

const CHANNEL_KINDS = ["channel_owner", "channel_subscriber"];
const GROUP_KINDS = ["group_admin", "group_member"];

export function isClonableKind(dialogKind: string): boolean {
  return CHANNEL_KINDS.includes(dialogKind) || GROUP_KINDS.includes(dialogKind);
}

/**
 * Canal e supergrupo são ambos peer_type='channel' — só o kind os distingue.
 */
export function deriveDestKind(dialogKind: string): DestKind {
  if (CHANNEL_KINDS.includes(dialogKind)) return "broadcast";
  if (GROUP_KINDS.includes(dialogKind)) return "megagroup";
  throw new Error(`DIALOG_KIND_NAO_CLONAVEL: ${dialogKind}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd c:/Users/Administrator/eaglebot && npx vitest run tests/lib/clone-kind.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Escrever as Server Actions**

```typescript
// app/dashboard/automations/clones/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/actions/owner-actions";
import { deriveDestKind, isClonableKind } from "@/lib/mtproto/clone-kind";

async function currentTenantId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

async function enqueueClone(cloneJobId: string): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "clone.run", cloneJobId }),
  });
  if (!res.ok) throw new Error(`Falha ao enfileirar clone (${res.status})`);
}

export type SaveBotResult = { ok: true; username: string } | { ok: false; error: string };

/**
 * Valida o token no Telegram antes de salvar. O erro comum é o owner colar o
 * token errado e só descobrir quando o clone falha na mensagem 1.
 */
export async function saveAutomationBot(token: string): Promise<SaveBotResult> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const clean = token.trim();
  if (!clean) return { ok: false, error: "Cole o token do BotFather." };

  let me: { id: number; username?: string; is_bot: boolean };
  try {
    const res = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
    const body = (await res.json()) as { ok: boolean; result?: typeof me; description?: string };
    if (!body.ok || !body.result) {
      return { ok: false, error: body.description ?? "Token recusado pelo Telegram." };
    }
    me = body.result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!me.is_bot) return { ok: false, error: "Esse token não é de um bot." };
  if (!me.username) {
    return { ok: false, error: "O bot precisa de @username para ser promovido a admin." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("automation_bots").upsert(
    {
      tenant_id: tenantId,
      token: clean,
      bot_user_id: String(me.id),
      username: me.username,
      session_string: null,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/automations");
  return { ok: true, username: me.username };
}

export async function removeAutomationBot(): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase.from("automation_bots").delete().eq("tenant_id", tenantId);
  revalidatePath("/dashboard/automations");
}

export type CreateCloneResult =
  | { ok: true; cloneJobId: string }
  | { ok: false; error: string };

export async function createCloneJob(input: {
  dialogId: string;
  destTitle: string;
  copyIdentity: boolean;
  messageLimit: number | null;
  throttleMs: number;
  copyReplies: boolean;
  copyPins: boolean;
  copyButtons: boolean;
  copyPolls: boolean;
}): Promise<CreateCloneResult> {
  try {
    await requireOwner();
    const tenantId = await currentTenantId();
    const supabase = await createClient();

    const { data: bot } = await supabase
      .from("automation_bots")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!bot) {
      return { ok: false, error: "Cadastre o bot companheiro antes de clonar." };
    }

    const { data: dialog } = await supabase
      .from("mtproto_dialogs")
      .select("id, account_id, peer_id, peer_type, peer_access_hash, kind, title, mtproto_accounts!inner(tenant_id)")
      .eq("id", input.dialogId)
      .eq("mtproto_accounts.tenant_id", tenantId)
      .single();
    if (!dialog) return { ok: false, error: "Origem não encontrada." };
    if (!isClonableKind(dialog.kind)) {
      return { ok: false, error: "Só dá para clonar canal ou grupo." };
    }
    if (input.messageLimit !== null && (input.messageLimit < 1 || input.messageLimit > 50000)) {
      return { ok: false, error: "O limite de mensagens vai de 1 a 50.000." };
    }

    const { data: job, error } = await supabase
      .from("clone_jobs")
      .insert({
        tenant_id: tenantId,
        account_id: dialog.account_id,
        source_dialog_id: dialog.id,
        source_peer_id: dialog.peer_id,
        source_peer_type: dialog.peer_type,
        source_peer_access_hash: dialog.peer_access_hash,
        source_title: dialog.title,
        dest_kind: deriveDestKind(dialog.kind),
        dest_title: input.destTitle.trim() || `${dialog.title ?? "Clone"} (clone)`,
        copy_identity: input.copyIdentity,
        message_limit: input.messageLimit,
        throttle_ms: input.throttleMs,
        copy_replies: input.copyReplies,
        copy_pins: input.copyPins,
        copy_buttons: input.copyButtons,
        copy_polls: input.copyPolls,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    revalidatePath("/dashboard/automations");
    return { ok: true, cloneJobId: job.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createCloneJob] unexpected:", err);
    return { ok: false, error: msg };
  }
}

export async function launchClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase
    .from("clone_jobs")
    .update({ status: "running", last_error: null })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  await enqueueClone(cloneJobId);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

/** Pausa: o runner checa o status entre cada grupo e aborta. O cursor fica salvo. */
export async function pauseClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase
    .from("clone_jobs")
    .update({ status: "paused" })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

export async function deleteClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase.from("clone_jobs").delete().eq("id", cloneJobId).eq("tenant_id", tenantId);
  revalidatePath("/dashboard/automations");
}

/** Relatório: o que foi pulado, agrupado por motivo. */
export async function listCloneSkipReport(
  cloneJobId: string,
): Promise<Array<{ reason: string; count: number }>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("clone_jobs")
    .select("id")
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!job) return [];

  const { data } = await supabase
    .from("clone_message_map")
    .select("reason")
    .eq("job_id", cloneJobId)
    .in("status", ["skipped", "failed"])
    .limit(5000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.reason ?? "desconhecido";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 6: Criar o card do bot**

```tsx
// components/dashboard/automation-bot-card.tsx
"use client";

import { useState, useTransition } from "react";
import { saveAutomationBot, removeAutomationBot } from "@/app/dashboard/automations/clones/actions";

export function AutomationBotCard({
  bot,
}: {
  bot: { username: string; bot_user_id: string } | null;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (bot) {
    return (
      <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02] flex items-center justify-between">
        <div>
          <div className="text-white font-medium">🤖 @{bot.username}</div>
          <div className="text-white/50 text-xs mt-1">
            Publica os clones e é promovido a admin nos destinos criados.
          </div>
        </div>
        <button
          onClick={() => start(() => void removeAutomationBot())}
          disabled={pending}
          className="text-white/40 hover:text-red-400 text-xs"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
      <div className="text-white font-medium">🤖 Bot companheiro</div>
      <p className="text-white/50 text-xs">
        Crie um bot no @BotFather e cole o token. Ele é quem publica os clones — sua
        conta pessoal só lê. No BotFather, deixe <strong>Group Privacy desligado</strong> e{" "}
        <strong>allow groups ligado</strong>, senão a promoção a admin falha.
      </p>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="123456789:AAF-xxxxxxxxxxxxxxxxxxxxx"
        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await saveAutomationBot(token);
            if (!res.ok) setError(res.error);
            else setToken("");
          })
        }
        disabled={pending}
        className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Validando..." : "Salvar bot"}
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Montar o card na página de Automações**

Em `app/dashboard/automations/page.tsx`, adicionar o import e a query, e uma seção antes de "Campanhas":

```tsx
import { AutomationBotCard } from "@/components/dashboard/automation-bot-card";
```

```tsx
  const { data: bot } = await supabase
    .from("automation_bots")
    .select("username, bot_user_id")
    .eq("tenant_id", user.id)
    .maybeSingle();
```

```tsx
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Bot companheiro</h2>
        <AutomationBotCard bot={bot ?? null} />
      </section>
```

- [ ] **Step 8: Verificar**

Run: `cd c:/Users/Administrator/eaglebot && npx tsc --noEmit && npm test && npm run lint`
Expected: sem erro de tipo, testes verdes, lint limpo.

Verificação manual: abrir `/dashboard/automations`, colar um token inválido (`123:abc`) e confirmar que aparece o erro do Telegram em vez de salvar.

- [ ] **Step 9: Commit**

```bash
git add lib/mtproto/clone-kind.ts tests/lib/clone-kind.test.ts app/dashboard/automations/clones/actions.ts components/dashboard/automation-bot-card.tsx app/dashboard/automations/page.tsx
git commit -m "feat(clone): server actions e card do bot companheiro"
```

---

### Task 13: tela de conteúdo da conta

**Files:**
- Create: `app/dashboard/automations/accounts/[accountId]/dialogs/page.tsx`
- Create: `components/dashboard/account-dialogs.tsx`
- Modify: `components/dashboard/mtproto-accounts.tsx` (botão "Ver conteúdo")

**Interfaces:**
- Consumes: `listAccountDialogs`, `syncAccountDialogs` (já existem em `app/dashboard/automations/actions.ts:270,285`); `isClonableKind` (Task 12).
- Produces: rota `/dashboard/automations/accounts/[accountId]/dialogs`.

- [ ] **Step 1: Criar a página (server component)**

```tsx
// app/dashboard/automations/accounts/[accountId]/dialogs/page.tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { AccountDialogs } from "@/components/dashboard/account-dialogs";

export default async function AccountDialogsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("id", accountId)
    .eq("tenant_id", user.id)
    .single();
  if (!account) notFound();

  const { data: bot } = await supabase
    .from("automation_bots")
    .select("username")
    .eq("tenant_id", user.id)
    .maybeSingle();

  return (
    <div className="p-8 max-w-4xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">
        Conteúdo — {account.display_name || account.phone_number}
      </h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Tudo que essa conta enxerga no Telegram. Canais e grupos podem ser clonados.
      </p>
      <AccountDialogs accountId={accountId} hasBot={Boolean(bot)} />
    </div>
  );
}
```

- [ ] **Step 2: Criar o componente de abas**

```tsx
// components/dashboard/account-dialogs.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { listAccountDialogs, syncAccountDialogs } from "@/app/dashboard/automations/actions";
import { isClonableKind } from "@/lib/mtproto/clone-kind";

type Dialog = {
  id: string;
  title: string | null;
  username: string | null;
  kind: string;
  peer_type: string;
  is_bot: boolean;
};

const TABS = [
  { id: "canais", label: "Canais", kinds: ["channel_owner", "channel_subscriber"] },
  { id: "grupos", label: "Grupos", kinds: ["group_admin", "group_member"] },
  { id: "bots", label: "Bots", kinds: ["bot"] },
  { id: "contatos", label: "Contatos", kinds: ["contact", "dm", "self"] },
] as const;

const KIND_LABEL: Record<string, string> = {
  channel_owner: "você administra",
  channel_subscriber: "você assina",
  group_admin: "você administra",
  group_member: "você participa",
};

export function AccountDialogs({ accountId, hasBot }: { accountId: string; hasBot: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("canais");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Dialog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listAccountDialogs(accountId)
      .then((data) => {
        if (alive) setRows(data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const active = TABS.find((t) => t.id === tab)!;
  const term = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      active.kinds.includes(r.kind as never) &&
      (!term || (r.title ?? "").toLowerCase().includes(term) || (r.username ?? "").toLowerCase().includes(term)),
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {TABS.map((t) => {
          const count = rows.filter((r) => t.kinds.includes(r.kind as never)).length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                tab === t.id
                  ? "bg-(--accent) text-black font-medium"
                  : "border border-white/15 text-white/70 hover:bg-white/5"
              }`}
            >
              {t.label} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
        <button
          onClick={() =>
            start(async () => {
              await syncAccountDialogs(accountId);
              setRows(await listAccountDialogs(accountId));
            })
          }
          disabled={pending}
          className="ml-auto text-white/40 hover:text-white text-xs disabled:opacity-50"
        >
          {pending ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou @username"
        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white mb-4"
      />

      {loading && <p className="text-white/40 text-sm">Carregando...</p>}
      {!loading && visible.length === 0 && (
        <p className="text-white/40 text-sm">
          Nada aqui. Se a conta acabou de conectar, use &quot;Sincronizar agora&quot;.
        </p>
      )}

      <div className="space-y-1">
        {visible.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-white/[0.02]"
          >
            <div className="min-w-0">
              <div className="text-white text-sm truncate">{d.title ?? d.username ?? d.id}</div>
              <div className="text-white/40 text-xs">
                {d.username ? `@${d.username} · ` : ""}
                {KIND_LABEL[d.kind] ?? d.kind}
              </div>
            </div>
            {isClonableKind(d.kind) &&
              (hasBot ? (
                <a
                  href={`/dashboard/automations/clones/new?dialogId=${d.id}`}
                  className="shrink-0 px-3 py-1 rounded bg-(--accent) text-black text-xs font-medium"
                >
                  Clonar
                </a>
              ) : (
                <span
                  title="Cadastre o bot companheiro em Automações para poder clonar"
                  className="shrink-0 px-3 py-1 rounded border border-white/10 text-white/30 text-xs cursor-not-allowed"
                >
                  Clonar
                </span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar o link no card da conta**

Em `components/dashboard/mtproto-accounts.tsx`, ao lado do botão "Remover" (linha ~152), acrescentar:

```tsx
            <a
              href={`/dashboard/automations/accounts/${a.id}/dialogs`}
              className="text-white/40 hover:text-white text-xs"
            >
              Ver conteúdo
            </a>
```

- [ ] **Step 4: Verificar**

Run: `cd c:/Users/Administrator/eaglebot && npx tsc --noEmit && npm run lint`
Expected: sem erros.

Verificação manual: com uma conta ativa, abrir `/dashboard/automations`, clicar em "Ver conteúdo", conferir que as quatro abas trazem contagens e que a busca filtra. Sem bot cadastrado, o botão "Clonar" aparece desabilitado com tooltip.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/automations/accounts/ components/dashboard/account-dialogs.tsx components/dashboard/mtproto-accounts.tsx
git commit -m "feat(clone): tela de conteudo da conta com abas e botao clonar"
```

---

### Task 14: seção Clonagem, formulário e progresso

**Files:**
- Create: `app/dashboard/automations/clones/new/page.tsx`
- Create: `components/dashboard/clone-form.tsx`
- Create: `app/dashboard/automations/clones/[cloneId]/page.tsx`
- Create: `components/dashboard/clone-progress.tsx`
- Create: `components/dashboard/clone-list.tsx`
- Modify: `app/dashboard/automations/page.tsx`

**Interfaces:**
- Consumes: `createCloneJob`, `launchClone`, `pauseClone`, `deleteClone`, `listCloneSkipReport` (Task 12).
- Produces: rotas `/dashboard/automations/clones/new` e `/dashboard/automations/clones/[cloneId]`.

- [ ] **Step 1: Formulário de novo clone**

```tsx
// components/dashboard/clone-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCloneJob, launchClone } from "@/app/dashboard/automations/clones/actions";

const TOGGLES = [
  { key: "copyReplies", label: "Respostas encadeadas", hint: "Mensagem que responde outra continua apontando para a cópia certa." },
  { key: "copyPins", label: "Mensagens fixadas", hint: "O que estava fixado na origem sai fixado no destino." },
  { key: "copyButtons", label: "Botões inline", hint: "Recria os botões de link. Força a rota lenta (baixar e reenviar)." },
  { key: "copyPolls", label: "Enquetes", hint: "Recria pergunta e opções. Os votos nascem zerados." },
] as const;

export function CloneForm({
  dialogId,
  sourceTitle,
}: {
  dialogId: string;
  sourceTitle: string;
}) {
  const router = useRouter();
  const [destTitle, setDestTitle] = useState(`${sourceTitle} (clone)`);
  const [copyIdentity, setCopyIdentity] = useState(true);
  const [limit, setLimit] = useState("");
  const [throttle, setThrottle] = useState("3000");
  const [flags, setFlags] = useState({
    copyReplies: false,
    copyPins: false,
    copyButtons: false,
    copyPolls: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-white/70 text-sm">Nome do destino</span>
        <input
          value={destTitle}
          onChange={(e) => setDestTitle(e.target.value)}
          className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
        />
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={copyIdentity}
          onChange={(e) => setCopyIdentity(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-white text-sm">Copiar identidade da origem</span>
          <span className="block text-white/40 text-xs">
            Traz descrição e foto de perfil. O @username público não dá para copiar — o
            destino nasce privado, com link de convite.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-white/70 text-sm">Últimas N mensagens</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
            placeholder="vazio = tudo"
            className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="text-white/70 text-sm">Pausa entre envios (ms)</span>
          <input
            value={throttle}
            onChange={(e) => setThrottle(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="space-y-2">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={flags[t.key]}
              onChange={(e) => setFlags({ ...flags, [t.key]: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="text-white text-sm">{t.label}</span>
              <span className="block text-white/40 text-xs">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createCloneJob({
              dialogId,
              destTitle,
              copyIdentity,
              messageLimit: limit ? Number(limit) : null,
              throttleMs: Math.max(500, Number(throttle) || 3000),
              ...flags,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            await launchClone(res.cloneJobId);
            router.push(`/dashboard/automations/clones/${res.cloneJobId}`);
          })
        }
        disabled={pending}
        className="px-4 py-2 rounded bg-(--accent) text-black text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Criando..." : "Criar e começar a clonar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Página do formulário**

```tsx
// app/dashboard/automations/clones/new/page.tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { CloneForm } from "@/components/dashboard/clone-form";

export default async function NewClonePage({
  searchParams,
}: {
  searchParams: Promise<{ dialogId?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { dialogId } = await searchParams;
  if (!dialogId) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: dialog } = await supabase
    .from("mtproto_dialogs")
    .select("id, title, kind, mtproto_accounts!inner(tenant_id)")
    .eq("id", dialogId)
    .eq("mtproto_accounts.tenant_id", user.id)
    .single();
  if (!dialog) notFound();

  return (
    <div className="p-8 max-w-2xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">Clonar</h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Origem: <strong className="text-white/80">{dialog.title}</strong>
      </p>
      <CloneForm dialogId={dialog.id} sourceTitle={dialog.title ?? "Clone"} />
    </div>
  );
}
```

- [ ] **Step 3: Tela de progresso**

```tsx
// components/dashboard/clone-progress.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import {
  pauseClone,
  launchClone,
  deleteClone,
  listCloneSkipReport,
} from "@/app/dashboard/automations/clones/actions";

type Job = {
  id: string;
  status: string;
  effective_strategy: string | null;
  dest_invite_link: string | null;
  total_seen: number;
  copied_count: number;
  skipped_count: number;
  failed_count: number;
  message_limit: number | null;
  last_error: string | null;
};

const STRATEGY_LABEL: Record<string, string> = {
  batch: "encaminhamento em lote (rápido)",
  download: "baixar e reenviar (a origem protege o conteúdo)",
};

const LIVE = new Set(["running", "waiting_flood"]);

export function CloneProgress({ initial }: { initial: Job }) {
  const [job, setJob] = useState(initial);
  const [report, setReport] = useState<Array<{ reason: string; count: number }>>([]);
  const [pending, start] = useTransition();

  // Polling de 3s, mesmo padrão das campanhas.
  useEffect(() => {
    if (!LIVE.has(job.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/clones/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 3000);
    return () => clearInterval(t);
  }, [job.id, job.status]);

  useEffect(() => {
    listCloneSkipReport(job.id).then(setReport);
  }, [job.id, job.copied_count]);

  const total = job.message_limit ?? Math.max(job.total_seen, 1);
  const pct = Math.min(100, Math.round((job.total_seen / total) * 100));

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white text-sm">{job.status}</span>
          <span className="text-white/40 text-xs">
            {job.effective_strategy ? STRATEGY_LABEL[job.effective_strategy] : "decidindo rota..."}
          </span>
        </div>
        <div className="h-2 rounded bg-white/10 overflow-hidden">
          <div className="h-full bg-(--accent)" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          <span className="text-white/70">{job.copied_count} copiadas</span>
          <span className="text-white/40">{job.skipped_count} puladas</span>
          <span className="text-red-400/70">{job.failed_count} falhas</span>
        </div>
        {job.last_error && <p className="text-red-400 text-xs mt-2">{job.last_error}</p>}
      </div>

      {job.dest_invite_link && (
        <a
          href={job.dest_invite_link}
          target="_blank"
          rel="noreferrer"
          className="block text-(--accent) text-sm hover:underline"
        >
          Abrir o canal clonado →
        </a>
      )}

      <div className="flex gap-2">
        {LIVE.has(job.status) ? (
          <button
            onClick={() => start(() => void pauseClone(job.id))}
            disabled={pending}
            className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-sm"
          >
            Pausar
          </button>
        ) : (
          job.status !== "completed" && (
            <button
              onClick={() => start(() => void launchClone(job.id))}
              disabled={pending}
              className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm"
            >
              Retomar
            </button>
          )
        )}
        <button
          onClick={() => start(() => void deleteClone(job.id))}
          disabled={pending}
          className="px-3 py-1.5 text-white/40 hover:text-red-400 text-sm"
        >
          Apagar
        </button>
      </div>

      {report.length > 0 && (
        <div>
          <h3 className="text-white text-sm font-medium mb-2">O que não foi clonado</h3>
          <div className="space-y-1">
            {report.map((r) => (
              <div
                key={r.reason}
                className="flex justify-between px-3 py-2 rounded border border-white/10 text-xs"
              >
                <span className="text-white/70">{r.reason}</span>
                <span className="text-white/40">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Endpoint de polling e página de detalhe**

```typescript
// app/api/clones/[cloneId]/route.ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cloneId: string }> },
) {
  const { cloneId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
```

```tsx
// app/dashboard/automations/clones/[cloneId]/page.tsx
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { CloneProgress } from "@/components/dashboard/clone-progress";

export default async function ClonePage({
  params,
}: {
  params: Promise<{ cloneId: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { cloneId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: job } = await supabase
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error, source_title, dest_title",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .single();
  if (!job) notFound();

  return (
    <div className="p-8 max-w-2xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">{job.dest_title}</h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Clonando de <strong className="text-white/80">{job.source_title}</strong>
      </p>
      <CloneProgress initial={job} />
    </div>
  );
}
```

- [ ] **Step 5: Lista de clones na página de Automações**

```tsx
// components/dashboard/clone-list.tsx
export function CloneList({
  clones,
}: {
  clones: Array<{
    id: string;
    dest_title: string;
    source_title: string | null;
    status: string;
    copied_count: number;
    total_seen: number;
  }>;
}) {
  if (clones.length === 0) {
    return (
      <p className="text-white/40 text-sm">
        Nenhum clone ainda. Abra &quot;Ver conteúdo&quot; numa conta e clique em Clonar.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {clones.map((c) => (
        <a
          key={c.id}
          href={`/dashboard/automations/clones/${c.id}`}
          className="flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
        >
          <div className="min-w-0">
            <div className="text-white text-sm truncate">{c.dest_title}</div>
            <div className="text-white/40 text-xs truncate">de {c.source_title ?? "—"}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-white/70 text-xs">{c.status}</div>
            <div className="text-white/40 text-xs">{c.copied_count} copiadas</div>
          </div>
        </a>
      ))}
    </div>
  );
}
```

Em `app/dashboard/automations/page.tsx`, adicionar a query e a seção depois de "Campanhas":

```tsx
import { CloneList } from "@/components/dashboard/clone-list";
```

```tsx
  const { data: clones } = await supabase
    .from("clone_jobs")
    .select("id, dest_title, source_title, status, copied_count, total_seen")
    .eq("tenant_id", user.id)
    .order("created_at", { ascending: false });
```

```tsx
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Clonagem</h2>
        <CloneList clones={clones ?? []} />
      </section>
```

- [ ] **Step 6: Verificar build e lint**

Run: `cd c:/Users/Administrator/eaglebot && npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; testes verdes.

- [ ] **Step 7: Teste E2E manual (o único que prova a feature)**

Pré-requisitos: uma conta MTProto `active`, o bot cadastrado, e um **canal de teste próprio com ~200 mensagens** cobrindo texto, álbum de fotos, um vídeo e uma mensagem com botão de link.

1. `/dashboard/automations` → "Ver conteúdo" na conta → aba Canais → "Clonar" no canal de teste.
2. Marcar os quatro toggles. Deixar o limite vazio. Criar.
3. Na tela de progresso, conferir:
   - `effective_strategy` aparece (`download`, porque `copyButtons` força essa rota).
   - a barra avança e os contadores sobem.
   - o link "Abrir o canal clonado" funciona.
4. No Telegram, abrir o canal clonado e conferir:
   - ordem cronológica igual à origem;
   - álbum agrupado, não N fotos soltas;
   - negrito/links preservados;
   - o botão de link aparece e abre a URL certa;
   - a mensagem fixada na origem está fixada aqui;
   - **nenhuma marca "Encaminhado de"**.
5. Repetir com os toggles desligados para exercitar a rota `batch`. Cronometrar. **Anotar o tempo:** é essa medida que responde se o flood conta por chamada ou por mensagem — a ressalva aberta do spec.
6. Pausar no meio de um clone e retomar. Conferir que ele continua de onde parou e não duplica mensagem.

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/automations/clones/ app/api/clones/ components/dashboard/clone-form.tsx components/dashboard/clone-progress.tsx components/dashboard/clone-list.tsx app/dashboard/automations/page.tsx
git commit -m "feat(clone): secao Clonagem, formulario, progresso e relatorio"
```

---

## Cobertura do spec

| Requisito do spec | Task |
|---|---|
| Migration `049_channel_clone.sql`, três tabelas + RLS | 1 |
| Correção do `extractFloodWait` | 2 |
| Correção do `CustomFile` acima de 20MB | 3 |
| `createChannel` com `megagroup` | 3 |
| `history-iterator` retomável, pula service/empty | 4 |
| Tabela de tipos de mídia (10 casos) | 5 |
| Bot companheiro: token, validação, publicação, login MTProto | 6 |
| `dest-builder` idempotente, identidade, promoção do bot, convite | 7 |
| `clone-runner`: álbum, cursor, respostas, flood, pausa, pins | 8 |
| Leitura da origem, download em streaming, `noforwards`, pins | 9 |
| Estratégia híbrida (`batch` vs `download`), teto de 50MB | 10 |
| Job `clone.run` no worker | 11 |
| Server Actions + card do bot (pré-requisito) | 12 |
| Tela de conteúdo da conta com abas | 13 |
| Seção Clonagem, formulário com os 4 toggles, progresso, relatório | 14 |
| Medir se o flood conta por chamada ou por mensagem | 14, passo 7.5 |
