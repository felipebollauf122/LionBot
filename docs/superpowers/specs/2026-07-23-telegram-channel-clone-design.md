# Design — Clonagem de canais e grupos do Telegram

**Data:** 2026-07-23
**Status:** Aprovado
**Autor:** Dary + Claude
**Depende de:** `2026-04-24-telegram-mtproto-automations-design.md`

## Contexto

A linha Automações já conecta contas pessoais do Telegram via MTProto e já sincroniza
todo o conteúdo da conta em `mtproto_dialogs` (contatos, DMs, grupos, canais, bots) —
ver `MtprotoClient.listDialogs` em `server/src/services/mtproto/client.ts:223` e o job
`account.sync-dialogs`. Esses dados hoje só aparecem dentro do formulário de campanha.

Esta feature faz duas coisas:

1. **Expõe** o conteúdo da conta numa tela navegável (canais, grupos, bots, contatos).
2. **Clona** um canal ou grupo: cria um destino novo na conta do owner e reproduz nele
   o histórico da origem.

A origem pode ser qualquer canal/grupo que a conta participa, inclusive um onde ela é
apenas assinante — o caso de uso principal é clonar canal de concorrente.

## Decisões do brainstorm

| Pergunta | Decisão |
|---|---|
| Snapshot ou espelho contínuo? | **Snapshot único.** Job resumível, sem processo vivo. |
| Quanto histórico? | **Tudo por padrão**, com campo "últimas N mensagens" e teto de segurança. |
| Destino | **Sempre cria novo**, espelhando o tipo da origem e copiando título/foto/descrição. |
| Estratégia de cópia | **Híbrida por capacidade** — lote rápido quando dá, download+reenvio quando não dá. |
| Fidelidade extra | Respostas, pins, botões inline e enquetes viram **toggles no formulário**. |
| Navegação | **Ambos** — tela de conteúdo por conta *e* seção Clonagem própria. |
| Bot companheiro | Instalado **só sob demanda** (destinos criados pelo clone). Sem varredura em massa. |

## Verificação técnica

O design abaixo se apoia em verificação feita contra as libs **instaladas**
(`telegram` 2.26.22 / layer 198, `grammy` 1.41.1, `@grammyjs/types` 3.25.0), com um
segundo agente tentando refutar cada conclusão. O que ficou provado:

| Premissa | Resultado |
|---|---|
| Conta de usuário envia botão inline | **Impossível.** `client/messages.d.ts:129-138`, `:189-198` e `uploads.d.ts:95` afirmam "will only work if you have signed in as a bot". O objeto serializa; o servidor descarta ou rejeita. |
| Bot autentica por MTProto com token do BotFather | Sim. `client.start({ botAuthToken })` → `auth.js:337` → `Api.auth.ImportBotAuthorization`. |
| Session string de bot é reutilizável | Sim. `StringSession.save()` (`sessions/StringSession.js:91-114`) só serializa dcId+endereço+authKey; não há bit distinguindo bot de usuário. |
| Bot resolve canal sem `access_hash` próprio | Sim. `client/users.js:283-286`: "If we're a bot […] users.getUsers will work with accessHash = 0. Similar for channels.getChannels". `getInputEntity(bigInt("-100<channelId>"))` resolve. |
| Conta promove bot a admin | Sim. `channels.InviteToChannel` + `channels.EditAdmin` com `ChatAdminRights`. Legacy: `messages.AddChatUser` + `messages.EditChatAdmin`. |
| Download de mídia em canal com "proteger conteúdo" | Sim. `noforwards` bloqueia `messages.ForwardMessages` (`CHAT_FORWARDS_RESTRICTED`), não `upload.getFile`. |
| Histórico do mais antigo ao mais novo, retomável | Sim. `client.iterMessages(peer, { reverse: true, offsetId: cursor })` — `client/messages.js:180-183` faz `addOffset -= 100`; ids saem estritamente crescentes (`:243-245`). |
| Criar supergrupo | Sim. `channels.CreateChannel({ megagroup: true })` (`tl/api.d.ts:27118`). |
| `copyMessages`/`forwardMessages` em lote pela Bot API | Sim, lotes de 1-100 ids em ordem estritamente crescente (`@grammyjs/types/methods.d.ts:152`, `:208`, `:217`), agrupamento de álbum preservado (`:207`). |

### Armadilhas confirmadas (a implementação precisa contorná-las)

1. **O throttle nativo do gramjs é no-op.** `requestIter.js:49-52` faz
   `sleep(this.waitTime - …)`, mas `sleep` recebe **milissegundos**
   (`Helpers.js:393`) e `waitTime` é documentado **em segundos**
   (`client/messages.d.ts:70`). Com `limit > 3000` a lib dorme ~1ms entre chamadas.
   **Tratar a lib como se não tivesse throttle nenhum** e impor o nosso.

2. **`FloodWaitError.message` não contém a string `FLOOD`.** `RPCErrorList.js:44-47`
   monta `"A wait of N seconds is required (caused by …)"`; `FLOOD` só existe em
   `errorMessage` (`RPCBaseErrors.js:102`). Detectar por classe e ler `.seconds`.

3. **`CustomFile` acima de 20MB exige caminho real em disco.** `uploads.js:64` entra no
   ramo `options.filePath` acima de `BUFFER_SIZE_20MB` e tenta abrir o 3º argumento como
   arquivo. `client.ts:660` passa o *nome* ali — quebra, não degrada.

4. **`SlowModeWaitError` não é dormido pela lib.** `users.js:66-67` só trata
   `FloodWaitError`/`FloodTestPhoneWaitError`, apesar de `telegramBaseClient.d.ts:64-66`
   prometer o contrário. Precisa de catch manual.

5. **`sendFile` com array não fatia em 10.** `uploads.js:321-415` manda o array inteiro
   num `SendMultiMedia`. Fatiar na mão.

6. **`_getResponseMessage(request, result, peer)`** — o 1º argumento é a *request*
   (é dela que sai o `randomId`), nunca o resultado.

### Ressalvas de servidor (não verificáveis localmente — validar em teste real)

- Se o limite de flood por chat conta por **chamada** ou por **mensagem** em
  `forwardMessages`. Se for por mensagem, a rota lote também leva horas. **Medir com um
  canal de teste de ~200 mensagens antes de prometer prazo.**
- Bot em MTProto **não** tem limite de 2GB comprovado (`BUFFER_SIZE_2GB` em
  `uploads.js:60` é dead code). Assumir o teto de 50MB da Bot API até haver teste.
- `dropAuthor: true` remove a marca "encaminhado de" — comportamento de servidor,
  precisa de confirmação visual no primeiro teste.
- Números de rate limit (30 msg/s global, ~20 msg/min por chat) vêm da doc do Bot API,
  não de constante local. São hipótese a calibrar por telemetria.

## Arquitetura

```
┌──────────────────────┐        ┌────────────────────────────────┐
│ Next.js (dashboard)  │        │ mtproto-worker (processo Node) │
│  /automations        │        │                                │
│   ├ accounts/[id]/   │        │  clone-runner ──┬─ conta (lê)   │
│   │   dialogs        │        │                 └─ bot (publica)│
│   └ clones/[id]      │        └────────────────────────────────┘
└──────────┬───────────┘                         │
           │ Server Action → POST /api/mtproto/enqueue
           ▼                                     ▼
┌──────────────────────┐        ┌────────────────────────────────┐
│ Supabase (Postgres)  │◄───────┤ BullMQ + Redis (queue mtproto) │
│  automation_bots     │        │  job: clone.run                │
│  clone_jobs          │        └────────────────────────────────┘
│  clone_message_map   │
└──────────────────────┘
```

### Divisão de trabalho conta × bot

```
CONTA PESSOAL (MTProto)              BOT COMPANHEIRO
────────────────────────             ──────────────────────────────
• lê o histórico da origem           • publica no destino
• baixa as mídias                    • botões inline (exclusivo dele)
• cria o canal/grupo destino         • fixa mensagens
• promove o bot a admin              • absorve a rajada de publicação
~5 requests por clone                milhares de requests por clone
```

A conta pessoal deixa de ser a publicadora. Ela é leitora e fundadora. Um bot derrubado
se recria no BotFather em segundos e o canal e os assinantes sobrevivem; um número
queimado leva a conta, os canais e as sessões junto. O próprio repo é evidência de que
contas caem: existem `pool.ts` com status `banned` e um `channel-replacer.ts` inteiro
só para sobreviver a isso.

**Limite:** um bot não entra sozinho em canal de terceiro (só admin adiciona bot). Em
clone de canal alheio o bot atua apenas no destino; a leitura é toda pela conta.

### Componentes novos

Todos em `server/src/services/mtproto/clone/`, seguindo o padrão de deps injetadas que
`CampaignRunner` já usa (`campaign-runner.ts:27`) — o runner não conhece Telegram e é
testável com mocks.

- **`history-iterator.ts`** — `iterHistoryAscending(client, peer, { sinceMsgId, throttleMs })`.
  Async generator sobre `client.iterMessages(peer, { reverse: true, offsetId })`.
  Descarta `Api.MessageEmpty`; devolve `Api.MessageService` só quando pedido (é sinal de
  pin/troca de foto, não conteúdo). Impõe delay próprio entre chunks.
  `buildHistoryPeer(peerId, peerType, accessHash)` monta `InputPeerChannel` (precisa de
  hash), `InputPeerChat` (não usa hash) ou `InputPeerUser`.

- **`message-cloner.ts`** — traduz **uma** mensagem de origem numa publicação no destino.
  Única unidade que conhece os tipos de mídia (tabela abaixo). Recebe as duas conexões
  (conta para download, bot para publicação) por injeção.

- **`clone-runner.ts`** — orquestra: cursor, agrupamento de álbum por `groupedId`,
  flood, pausa, contadores, replicação de pins no final. Sem nenhuma chamada de Telegram.

- **`bot-client.ts`** — wrapper do bot companheiro. Bot API (grammy) para o caso comum;
  cliente MTProto de bot (`start({ botAuthToken })`) para o que a Bot API não cobre.
  Persiste a session string em `automation_bots.session_string`.

- **`dest-builder.ts`** — cria o destino, copia identidade, promove o bot, exporta invite,
  persiste no job. Idempotente: se `dest_channel_id` já está gravado, não recria.

### Estratégia híbrida

Resolvida em runtime, por clone, e gravada em `clone_jobs.effective_strategy`:

```
origem tem noforwards?
  ├─ não → LOTE:     forwardMessages(dropAuthor: true), até 100 ids por chamada.
  │                  Sem download, sem upload. ~40 chamadas para 3.000 mensagens.
  └─ sim → DOWNLOAD: conta baixa (streaming para disco temporário),
                     bot publica, arquivo apagado por mensagem.
                     Acima de 50MB: registra skip com reason='file_too_large'.
```

A rota LOTE também cai para DOWNLOAD naquele clone se o Telegram devolver
`CHAT_FORWARDS_RESTRICTED` em runtime (a sondagem inicial pode estar desatualizada).

Quando o usuário liga o toggle de **botões inline**, a mensagem correspondente sai
obrigatoriamente pela rota DOWNLOAD publicada pelo bot — encaminhamento não permite
anexar markup.

### Tabela de tipos de mídia

Comportamento por tipo, na rota DOWNLOAD:

| Tipo | Comportamento |
|---|---|
| Texto, foto, vídeo, documento, áudio, voz, gif | Clona. Atributos (duração, w/h, streaming) lidos da mensagem **original**, não chutados. |
| Álbum (`groupedId`) | Reagrupado via `SendMultiMedia`/`sendMediaGroup`, **fatiado em 10**. |
| `MessageMediaWebPage` | Degrada em silêncio: envia só o texto+entities e deixa o Telegram regerar o preview. |
| Enquete | Recria com pergunta/opções; votos nascem zerados. Quiz sem resposta revelada degrada para enquete normal. Nunca copiar `closed`/`closePeriod`/`closeDate`. |
| Sticker de pack privado | Tenta reenviar; se falhar, baixa o arquivo e manda como documento. |
| Custom emoji no texto | Remove a entity e preserva o `alt`. Exige Premium para enviar. |
| `MessageMediaDice` | Clona o emoji; o valor é sorteado pelo servidor. Registra no relatório. |
| `MessageMediaGeoLive` | Degrada para ponto estático + registra. |
| `MessageMediaGame`, `Invoice`, `Giveaway`, `PaidMedia`, `Story` | Pula + registra no relatório. Invoice registra `{title, currency, totalAmount}` — é inteligência de preço. |
| `MessageMediaUnsupported` | Pula + registra. (`Utils.js` mapeia para `InputMediaEmpty`, ou seja, enviaria mensagem vazia sem avisar.) |
| `MessageService` | Pula em silêncio, **exceto** como sinal: `MessageActionPinMessage` dispara o pin no destino; `ChatEditPhoto`/`ChatEditTitle` disparam a atualização de identidade. |

## Schema — migration `049_channel_clone.sql`

Segue o padrão de `032_channel_monitors.sql`: schema `public`, `if not exists`,
`references public.tenants(id)` e política RLS `tenant_id = auth.uid()`.

```sql
-- Bot companheiro do tenant, criado no BotFather pelo owner.
create table if not exists public.automation_bots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null,
  bot_user_id text not null,
  username text not null,
  session_string text,                       -- sessão MTProto do bot (lazy, no 1º uso)
  status text not null default 'active',     -- 'active' | 'invalid'
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)                          -- um bot por tenant no MVP
);

create table if not exists public.clone_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.mtproto_accounts(id) on delete cascade,

  -- origem (snapshot: dialog pode sumir no próximo sync)
  source_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  source_peer_id text not null,
  source_peer_type text not null check (source_peer_type in ('channel', 'chat')),
  source_peer_access_hash text,
  source_title text,

  -- destino. dest_kind deriva de mtproto_dialogs.kind no momento da criação:
  --   channel_owner | channel_subscriber      -> 'broadcast'
  --   group_admin   | group_member            -> 'megagroup'
  -- (supergrupo e canal são ambos peer_type='channel'; só o kind os distingue)
  dest_kind text not null check (dest_kind in ('broadcast', 'megagroup')),
  dest_title text not null,
  dest_channel_id text,
  dest_access_hash text,
  dest_invite_link text,

  -- configuração
  message_limit int check (message_limit is null or message_limit between 1 and 50000),
  strategy text not null default 'auto'
    check (strategy in ('auto', 'batch', 'download')),
  effective_strategy text
    check (effective_strategy in ('batch', 'download')),
  copy_identity boolean not null default true,
  copy_replies boolean not null default false,
  copy_pins boolean not null default false,
  copy_buttons boolean not null default false,
  copy_polls boolean not null default false,
  throttle_ms int not null default 3000,

  -- progresso
  status text not null default 'draft'
    check (status in ('draft','running','paused','waiting_flood','completed','failed')),
  cursor_source_msg_id bigint not null default 0,
  total_seen int not null default 0,
  copied_count int not null default 0,
  skipped_count int not null default 0,
  failed_count int not null default 0,
  resume_after timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Mapa origem→destino. Paga três contas: remapear respostas, replicar pins
-- no final (o id do destino só existe depois do envio) e gerar o relatório.
create table if not exists public.clone_message_map (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.clone_jobs(id) on delete cascade,
  source_msg_id bigint not null,
  dest_msg_id bigint,
  grouped_id text,
  status text not null check (status in ('copied', 'skipped', 'failed')),
  reason text,
  unique (job_id, source_msg_id)
);

create index if not exists idx_clone_jobs_tenant_status
  on public.clone_jobs(tenant_id, status);
create index if not exists idx_clone_map_job_status
  on public.clone_message_map(job_id, status);

alter table public.automation_bots enable row level security;
alter table public.clone_jobs enable row level security;
alter table public.clone_message_map enable row level security;

create policy "owner manages own automation_bots" on public.automation_bots
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "owner manages own clone_jobs" on public.clone_jobs
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "owner manages own clone_message_map" on public.clone_message_map
  for all
  using (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()))
  with check (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()));
```

`token` e `session_string` ficam em plaintext, coerente com a decisão já tomada para
`mtproto_accounts.session_string` no design de 2026-04-24.

## Fluxo do job `clone.run`

Novo kind em `MtprotoJobData` (`server/src/queue-mtproto.ts`) e novo case no switch do
worker (`server/src/workers/mtproto-worker.ts:746`).

```
1. Carrega job + conta + bot. O bot é OBRIGATÓRIO: sem ele o job falha na hora, com
   mensagem clara. Não existe modo degradado com a conta publicando — seria um segundo
   caminho de publicação para manter e testar, e justamente o caminho perigoso.

2. Cria destino (pula se dest_channel_id já existe — retomada):
   - lê identidade da origem: channels.GetFullChannel (canal/supergrupo)
     ou messages.GetFullChat (grupo legacy)
   - channels.CreateChannel({ megagroup: dest_kind === 'megagroup' })
   - título, about (messages.EditChatAbout), foto (channels.EditPhoto)
   - InviteToChannel + EditAdmin para o bot (postMessages, editMessages,
     deleteMessages, pinMessages)
   - ExportChatInvite
   - persiste dest_channel_id / dest_access_hash / dest_invite_link

3. Sonda a origem (noforwards) e grava effective_strategy.

4. Loop principal:
   for await (msg of iterHistoryAscending(conta, peer, { sinceMsgId: cursor })):
     - checa status no DB (pausa/deleção aborta, mesmo padrão de campaign-runner.ts:150)
     - acumula por groupedId até fechar o álbum
     - publica (LOTE ou DOWNLOAD)
     - grava clone_message_map + avança cursor_source_msg_id
     - respeita message_limit
     - throttle NOSSO entre publicações

5. FLOOD_WAIT / SLOWMODE_WAIT → status='waiting_flood', resume_after = now + N,
   reenfileira com delay. O cursor já está persistido: a retomada é uma rechamada.

6. Final: se copy_pins, lê os pins da origem (InputMessagesFilterPinned), traduz pelo
   mapa e chama messages.UpdatePinnedMessage(silent: true). Marca completed.
```

Ordem importa: **pins só depois de todo o envio**, porque o id do destino não existe antes.

## UI

### Tela de conteúdo da conta — `/dashboard/automations/accounts/[accountId]/dialogs`

Espelha a rota de inbox que já existe. Abas **Canais | Grupos | Bots | Contatos**, busca
por título, contador por aba, botão "Sincronizar agora" (`account.sync-dialogs`, já
existe). Server Action `listAccountDialogs` (`app/dashboard/automations/actions.ts:285`)
já entrega exatamente esses dados — só falta a tela.

Linhas de canal e grupo ganham botão **Clonar**. Bots e contatos são só leitura.

### Card do bot companheiro

Na página de Automações: campo para colar o token, validação via `getMe`, exibição do
`@username` e status. Botão para remover/trocar.

O bot é **pré-requisito da clonagem**. Enquanto não houver token válido cadastrado, o
botão "Clonar" fica desabilitado e aponta para este card.

### Seção Clonagem

Irmã de Campanhas e Monitoramento na página de Automações: lista de clones com origem,
destino, progresso e status. Botão "Novo clone" abre o formulário.

### Formulário de clone

Origem (pré-preenchida quando vem do botão Clonar), título do destino (pré-preenchido
com o da origem, editável), "copiar identidade da origem", "últimas N mensagens"
(vazio = tudo), ritmo, e os quatro toggles: **respostas encadeadas**, **mensagens
fixadas**, **botões inline**, **enquetes**.

O campo "últimas N mensagens" aceita 1 a 50.000; vazio significa todo o histórico.

### Detalhe do clone — `/dashboard/automations/clones/[cloneId]`

Progresso com polling de 3s (mesmo padrão das campanhas), link de convite do destino,
botões pausar/retomar/apagar, e o **relatório**: lista do que foi pulado agrupado por
motivo, lida de `clone_message_map`.

## Correções pontuais no código existente

Três defeitos que esta feature encosta:

1. **`extractFloodWait`** (`server/src/services/mtproto/campaign-runner.ts:86-93`) — bug
   **em produção**. Testa `/FLOOD/i` contra `err.message`, que é
   `"A wait of N seconds is required (caused by …)"`. Nunca casa. Consequência hoje: todo
   FLOOD_WAIT cai no ramo genérico, o alvo é marcado `failed` (lead perdido) e a conta
   **não** entra em `flood_wait`. Trocar por `err instanceof FloodWaitError` + `.seconds`,
   cobrindo também `SlowModeWaitError`. Teste de regressão obrigatório.

2. **`CustomFile`** (`server/src/services/mtproto/client.ts:659-661`) — passa
   `media.fileName` no 3º argumento, que a lib usa como caminho em disco acima de 20MB
   (`uploads.js:64`). Quebra em vídeo grande. Passar caminho real do arquivo temporário.

3. **`createChannel`** (`server/src/services/mtproto/client.ts:611`) — hoje fixo em
   `broadcast: true, megagroup: false`. Ganha parâmetro para criar supergrupo.
   `channel-creator.ts` continua chamando com o default de canal.

## Testes

Unitários com deps mockadas, seguindo o estilo dos testes existentes de runner:

- **`history-iterator`** — ordem crescente, retomada a partir de `sinceMsgId`, descarte
  de `MessageEmpty`, emissão condicional de `MessageService`, throttle aplicado.
- **`message-cloner`** — um caso por linha da tabela de tipos de mídia; caminho de
  degradação de webpage; enquete-quiz sem resposta revelada; arquivo acima do teto.
- **`clone-runner`** — agrupamento de álbum por `groupedId` (inclusive fatiamento em 10);
  FLOOD_WAIT persiste cursor e agenda retomada; pausa mid-loop aborta; remapeamento de
  resposta cujo alvo ficou fora do `message_limit` (deve enviar sem reply, não falhar);
  pins aplicados só no final.
- **`extractFloodWait`** — regressão com um `FloodWaitError` real da lib.
- **`dest-builder`** — idempotência (não recria destino já gravado).

E2E manual pelo owner: um clone de um canal de teste com ~200 mensagens, cobrindo texto,
álbum, vídeo e uma mensagem com botão. Serve também para medir se o flood conta por
chamada ou por mensagem — número que o design assume mas não pode provar localmente.

## Fora de escopo

Espelho contínuo (a `clone_message_map` já deixa o caminho pronto), clonar bots, clonar
membros ou assinantes, clonar username público (o Telegram não permite repetir — o
destino nasce privado com invite link), votos de enquete, invoice/sorteio/mídia paga,
custom emoji, e varredura em massa para instalar o bot em canais preexistentes.

## Riscos aceitos

1. **Ban da conta.** Reduzido em ordens de grandeza ao mover a publicação para o bot,
   mas a conta continua exposta na criação de canal (`channels.CreateChannel` é limitada
   a poucas por dia — `channel-creator.ts:104-111` já apanhou disso) e no download em
   massa.
2. **Token do bot e session strings em plaintext no banco**, coerente com a decisão já
   vigente para as contas MTProto.
3. **Duração imprevisível.** Um canal grande em rota DOWNLOAD é job de horas. Mitigado
   por retomada, pausa e progresso visível — não eliminado.
4. **Denúncia do canal clonado.** Se o conteúdo for denunciado, o destino cai
   independentemente de quem publicou.
