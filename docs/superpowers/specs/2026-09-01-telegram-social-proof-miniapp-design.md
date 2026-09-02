# Mini App de Prova Social — clone da interface de canal do Telegram

**Data:** 2026-09-01
**Status:** aprovado, pronto pra virar plano de implementação
**Escopo:** nova aba no console do bot + rota pública de Mini App (TWA)

---

## 1. Objetivo

Uma tela que o lead abre **dentro do Telegram**, a partir de um botão no fluxo do
bot, e que é visualmente indistinguível da view de um canal do Telegram. O tenant
monta o conteúdo desse feed numa aba nova do console do bot.

Duas superfícies:

| Superfície | Rota | Quem usa |
|---|---|---|
| Composer | `app/dashboard/bots/[botId]/prova-social/` | o tenant, no console |
| Mini App | `app/mini/[botId]/` | o lead, dentro do Telegram |

## 2. Decisões tomadas

| Decisão | Escolha | Consequência |
|---|---|---|
| Onde mora | Aba na sidebar do bot, dentro do Next.js existente | Reusa Supabase, RLS, deploy, domínio HTTPS |
| Origem do conteúdo | Composer manual no dashboard | Sem dependência de MTProto; tabela nova |
| Horários | Relativos ao momento em que o lead abre | `offset_seconds`, não `timestamp` |
| Entrada | Botão `web_app` num nó de fluxo | Exige campo novo na Bot API interna + engine |
| Renderização | SSR + hidratação fina | Feed já no HTML; sem tela branca |
| Moldura | Completa (header, fundo, footer, safe areas) | O que vende a ilusão |

### Fora de escopo na v1

Reações, contador de comentários, indicador de "digitando…", drip de mensagens ao
vivo, e importação via MTProto (`server/src/services/mtproto/clone/`). Todos são
extensões naturais depois; nenhum é pré-requisito.

## 3. Restrições descobertas no código

Três coisas que quebrariam a implementação se descobertas tarde:

1. **`middleware.ts` redireciona `/mini/*` pro `/login`.** A lista `isPublicRoute`
   em `lib/supabase/middleware.ts:33` é uma allowlist explícita. `/mini` precisa
   entrar nela, ou nenhum lead consegue abrir.
2. **O layout raiz é synthwave.** `app/globals.css:3` define `--bg-root: #05030a`
   e acentos magenta/cyan no `:root`; `app/layout.tsx` aplica Chakra Petch e
   Rajdhani no `body`. O Mini App precisa escapar de tudo isso.
3. **`InlineKeyboardButton` não tem `web_app`.** `server/src/telegram/api.ts:42`
   suporta `url`, `callback_data`, `copy_text` e `style`. Falta o campo que abre
   Mini App.

## 4. Isolamento do tema

O App Router só permite dois root layouts via route groups, o que exigiria mover
`app/layout.tsx` pra dentro de um grupo e tocar em todas as rotas existentes.
Custo alto demais pra um ganho que dá pra obter de outro jeito.

**Abordagem:** `app/mini/[botId]/page.tsx` renderiza um wrapper que cobre o
viewport inteiro:

- `position: fixed; inset: 0` — o `body` synthwave continua existindo por baixo,
  completamente coberto e invisível.
- `font-family` da stack de sistema, igual à do Telegram:
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`
- Todas as cores vindas de `--tg-theme-*`, com fallback pros valores oficiais do
  tema Dark/Light do Telegram.
- Nenhuma classe utilitária que dependa dos tokens do dashboard
  (`bg-(--bg-root)`, `text-(--text-primary)`, `glass`, etc.).

`TelegramInit` chama `setBackgroundColor` e `setHeaderColor` pra moldura nativa
do Telegram combinar com o wrapper.

## 5. Modelo de dados

Migration `071_social_proof.sql` (a última hoje é `070_multi_gateway.sql`).

```sql
-- Canal simulado: um por bot.
create table public.social_proof_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  title text not null default '',
  avatar_url text,
  subscribers_label text not null default '',  -- texto livre: "12 483 inscritos"
  is_verified boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bot_id)
);
alter table public.social_proof_channels enable row level security;
create policy "Tenants can manage own social proof channels"
  on public.social_proof_channels for all using (tenant_id = auth.uid());

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
  offset_seconds integer not null default 0,  -- há quanto tempo, contado do "agora" do lead
  views_count integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- uma mensagem precisa de texto OU mídia
  constraint social_proof_messages_has_content
    check (content_text is not null or media_url is not null),
  -- media_type é obrigatório quando há mídia, e proibido quando não há
  constraint social_proof_messages_media_type_consistent
    check ((media_url is null) = (media_type is null))
);
alter table public.social_proof_messages enable row level security;
create policy "Tenants can manage own social proof messages"
  on public.social_proof_messages for all using (tenant_id = auth.uid());

create index idx_social_proof_messages_feed
  on public.social_proof_messages (bot_id, is_active, position);
```

### Por que `offset_seconds` e não `timestamp`

A especificação original pedia `timestamp`. Com o feed relativo ao momento em que
o lead abre, guardar data absoluta torna o comportamento impossível: em duas
semanas o feed mostraria prova social de 14 dias atrás. `offset_seconds` guarda a
**distância** ("900" = 15 min atrás) e a hora exibida é calculada na renderização.
Efeito colateral desejável: o separador de data mostra "Hoje" pra sempre, sem cron
nem manutenção.

`position` existe separado do offset pra permitir reordenar sem recalcular todos
os offsets.

### Leitura pública

O lead **não tem sessão Supabase** — RLS não ajuda aqui. O Server Component lê com
service-role e projeta só os campos do feed. Abrir uma policy `anon select` na
tabela seria superfície desnecessária num schema onde tudo o mais é por tenant.

O `select` público é explicitamente enumerado (nunca `select('*')`), pra que uma
coluna sensível adicionada no futuro não vaze por acidente.

## 6. Componentes

Em `components/telegram/`, sem dependência de nada do dashboard:

| Componente | Responsabilidade |
|---|---|
| `ChatBackdrop` | Padrão de fundo do chat em SVG, tingido pelo tema |
| `ChannelHeader` | Avatar, título, badge de verificado, "N inscritos" |
| `ChannelFooter` | Barra inferior de canal ("Silenciar" / "Inscrever-se"), decorativa |
| `DateSeparator` | Pill centralizado ("Hoje") |
| `MessageGroup` | Agrupa mensagens seguidas do mesmo remetente |
| `MessageBubble` | A bolha, com e sem rabinho |
| `Avatar` | Círculo, só na última mensagem do grupo |
| `SenderName` | Nome colorido no topo da primeira bolha do grupo |
| `MediaContainer` | Imagem/vídeo com raio de borda correto |
| `MessageMeta` | Hora + ícone de olho + contagem de views |

### Agrupamento: o detalhe que denuncia clones

No Telegram, mensagens consecutivas do mesmo remetente formam um grupo:

- O **nome** aparece só na primeira bolha do grupo.
- O **avatar** aparece só ao lado da **última** bolha do grupo.
- Só a **última** bolha tem o rabinho; as anteriores têm o canto arredondado.
- Espaçamento **dentro** do grupo é menor que **entre** grupos.

Quase todo clone repete avatar e nome em toda mensagem, e é isso que faz parecer
site. `MessageGroup` existe unicamente pra resolver isso.

### Cor do nome do remetente

Hash determinístico do `sender_name` → uma das 7 cores de peer do Telegram. O
mesmo nome sai sempre da mesma cor, como no app real.

### Valores de referência visual

Estes são pontos de partida a **calibrar contra screenshot real** durante a
implementação, não medidas oficiais publicadas pelo Telegram:

| Elemento | Valor inicial |
|---|---|
| Raio da bolha | 12px; canto do rabinho 6px |
| Texto da mensagem | 16px / line-height 1.3125 |
| Nome do remetente | 14px, peso 500 |
| Meta (hora, views) | 12px |
| Avatar | 34px |
| Gap dentro do grupo | 2px |
| Gap entre grupos | 8px |

A calibração final é comparação lado a lado com um canal real no mesmo aparelho.

### Limitação do SDK, declarada

`var(--tg-theme-*)` expõe fundo, texto, hint, link, botão e algumas variantes
recentes — mas **não expõe a cor da bolha de mensagem** nem o padrão de fundo do
chat. A cor da bolha será derivada de `--tg-theme-secondary-bg-color` com fallback
pros valores dos temas Dark/Light oficiais. Nos temas padrão fica imperceptível;
num tema customizado exótico pode desviar. "Pixel-perfect via variáveis" tem esse
teto, e é melhor saber disso agora.

## 7. SDK e viewport

Client component fino, só isso:

- `ready()` — libera a tela de splash do Telegram
- `expand()` — abre em altura cheia
- `disableVerticalSwipes()` — impede que o scroll do feed feche o Mini App
- `setBackgroundColor` / `setHeaderColor`

**A altura tem que vir de `--tg-viewport-stable-height`, não de `100vh`.** No iOS,
`100vh` conta uma barra de navegador que não existe dentro do Telegram, e o feed
fica com o rodapé cortado. `stable-height` (e não `viewport-height`) porque a
variante estável não oscila quando o teclado abre.

Safe areas via `env(safe-area-inset-bottom)` — o padrão `pb-safe` que
`components/dashboard/bot-shell.tsx:49` já usa no bottom-tab-bar.

## 8. Entrada pelo bot

1. `web_app?: { url: string }` em `InlineKeyboardButton`
   (`server/src/telegram/api.ts:42`).
2. `action: "miniapp"` em
   `components/dashboard/flow-builder/config-forms/button-config.tsx`, seguindo o
   padrão de `action: "payment"` que já existe nos botões do nó `button`.
3. `server/src/engine/nodes/button.ts` monta o botão apontando pra
   `https://<dominio>/mini/<botId>`.
4. `/mini` entra em `isPublicRoute` (`lib/supabase/middleware.ts:33`).

O Telegram exige HTTPS público pra Mini Apps — já atendido pelo Caddy.

### Validação de `initData`

Sem validação, a URL do Mini App é aberta por qualquer um, fora do Telegram.
Route handler que valida o HMAC-SHA256 de `initData` com o token do bot (algoritmo
padrão da Bot API: chave `WebAppData`, pares ordenados, `hash` de fora). Isso dá o
`telegram_user_id` de quem abriu, o que permite registrar o evento de tracking
com o lead correto.

O feed em si continua sendo renderizado no SSR sem esperar validação — validar
antes de pintar reintroduziria a tela branca que a decisão de SSR existe pra
evitar. A validação acontece em paralelo, no cliente, e serve pra tracking e pra
decidir se mostra ou não conteúdo sensível numa versão futura.

## 9. Testes

`vitest` + Testing Library, já configurados (`vitest.config.mts`).

| Alvo | Por quê |
|---|---|
| Agrupamento de mensagens | É a regra com mais casos de borda: um só, dois iguais, alternados, remetente repetido não-adjacente |
| `offset_seconds` → hora exibida | Vira o conteúdo visível de toda mensagem |
| Formatação de views (`1.2K`, `15.3K`) | Formato próprio do Telegram, fácil de errar |
| HMAC do `initData` | Segurança; precisa rejeitar hash adulterado |

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Cor da bolha não exposta pelo SDK | Derivar + fallback pros temas oficiais (§6) |
| Vazamento do CSS synthwave | Wrapper `fixed inset-0`, zero tokens do dashboard (§4) |
| `100vh` cortando o feed no iOS | `--tg-viewport-stable-height` (§7) |
| Mini App aberto fora do Telegram | Validação de `initData` (§8) |
| Feed grande em 4G ruim | SSR + `loading="lazy"` na mídia abaixo da dobra |

## 11. Nota legal

O componente é neutro — renderiza o que estiver na tabela, e serve igualmente pra
feed real, prévia de canal ou vitrine de produtos. O conteúdo é responsabilidade
do tenant. Vale registrar que mensagens fabricadas apresentadas como interações
reais de terceiros ("fulano acabou de comprar", depoimentos inventados)
configuram publicidade enganosa pelo art. 37 do CDC.

## 12. Arquivos

**Novos**

```
supabase/migrations/071_social_proof.sql
app/mini/[botId]/page.tsx
app/mini/[botId]/telegram-init.tsx
app/dashboard/bots/[botId]/prova-social/page.tsx
components/telegram/{chat-backdrop,channel-header,channel-footer,date-separator,
                     message-group,message-bubble,avatar,sender-name,
                     media-container,message-meta}.tsx
components/telegram/theme.css
components/dashboard/social-proof/{composer,message-form,feed-preview}.tsx
lib/social-proof/{feed,grouping,format,init-data}.ts
lib/actions/social-proof-actions.ts
tests/social-proof/{grouping,format,init-data}.test.ts
```

**Modificados**

```
lib/supabase/middleware.ts           -- /mini em isPublicRoute
components/dashboard/bot-sidebar.tsx -- item "Prova Social" em botNavItems
server/src/telegram/api.ts           -- web_app em InlineKeyboardButton
components/dashboard/flow-builder/config-forms/button-config.tsx  -- action "miniapp"
server/src/engine/nodes/button.ts    -- montar o botão web_app
lib/types/database.ts                -- tipos das tabelas novas
```

## 13. Nota de implementação

`AGENTS.md` do projeto: esta versão do Next.js tem breaking changes em relação ao
conhecimento pré-treinado. Ler os guias relevantes em `node_modules/next/dist/docs/`
antes de escrever as rotas — em especial params dinâmicos, Server Components e
Server Actions.
