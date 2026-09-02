# Composer de Prova Social v2 — design

**Data:** 2026-09-02
**Status:** aprovado, pronto pra virar plano de implementação
**Substitui:** partes de `docs/superpowers/specs/2026-09-01-telegram-social-proof-miniapp-design.md` (§5 modelo de dados, §6 componentes)
**Referência visual:** mockup de 3 colunas fornecido pelo usuário

---

## 1. Por que existe

A v1 entregou um composer mínimo: mídia só por URL, um `<select>` nativo ilegível no tema escuro, nenhum conceito de "a dona do canal postando", e um layout de coluna única. O usuário apontou os quatro problemas e forneceu um mockup completo.

Esta v2 reconstrói a tela do console contra esse mockup e estende o renderizador do Mini App para desenhar tudo que a tela nova passa a criar.

**O princípio que governa o escopo:** tudo que o editor cria, `components/telegram/` precisa saber renderizar. Um campo no console que o Mini App ignora é pior que ausência de campo — o tenant monta e o lead nunca vê.

## 2. Estado de partida

- Migration `071_social_proof.sql` **já foi aplicada** no Supabase. A `072` é de outro assunto (traffic filter). A próxima livre é a **`073`**.
- `uploadMedia(formData)` em `lib/actions/upload-actions.ts:26` já funciona: bucket `media`, 50MB, imagem e vídeo. `bot-settings-form.tsx:274` já a usa. A v1 simplesmente não a ligou.
- `components/telegram/` sabe desenhar texto, imagem e vídeo, com agrupamento por remetente e separador de dia.
- `peerColorIndex` (`components/telegram/sender-name.tsx`) já dá cor determinística por nome.

## 3. Modelo de dados

Migration `073_social_proof_v2.sql`, **incremental e idempotente** (`add column if not exists`), porque a `071` está em produção.

### 3.1 Canal — identidade da dona e cabeçalho

```sql
alter table public.social_proof_channels
  add column if not exists owner_name text not null default '',
  add column if not exists owner_avatar_url text,
  add column if not exists owner_username text not null default '',
  add column if not exists pinned_message_id uuid,
  add column if not exists unread_badge integer not null default 0;
```

A dona é **separada do canal**: no mockup o canal é "teste" com avatar de lobo, e a dona é "Daniel" com avatar próprio e `@daniel_oficial`. Mensagens enviadas como dona usam essa identidade; o cabeçalho do canal continua usando a do canal.

`pinned_message_id` guarda o alvo da ação "Fixar" do editor. As duas tabelas já existem em produção, então a FK é criada direto, junto da de `reply_to_id`:

```sql
alter table public.social_proof_channels
  add constraint social_proof_channels_pinned_fk
    foreign key (pinned_message_id)
    references public.social_proof_messages(id) on delete set null;

alter table public.social_proof_messages
  add constraint social_proof_messages_reply_fk
    foreign key (reply_to_id)
    references public.social_proof_messages(id) on delete set null;
```

`on delete set null` nos dois: apagar a mensagem fixada desafixa em vez de derrubar o canal, e apagar a mensagem respondida deixa a resposta órfã em vez de cascatear.

### 3.2 Mensagem — remetente, tipo, mídia em lista

```sql
alter table public.social_proof_messages
  add column if not exists sender_kind text not null default 'member',
  add column if not exists kind text not null default 'text',
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists reactions jsonb not null default '[]'::jsonb,
  add column if not exists reply_to_id uuid,
  add column if not exists display_time text;
```

| Coluna | Domínio | Papel |
|---|---|---|
| `sender_kind` | `owner` \| `member` | Quem aparece enviando |
| `kind` | `text` \| `photo` \| `video` \| `audio` \| `album` | Os cinco botões de "Tipo de mensagem" |
| `media` | lista de `{url, type, duration_seconds?}` | Substitui `media_url`/`media_type` |
| `reactions` | lista de `{emoji, count}` | A linha de reações da bolha |
| `reply_to_id` | uuid | A ação "Responder" |
| `display_time` | `HH:MM` ou nulo | O campo "Horário (opcional)" |

### 3.3 A mudança que quebra: mídia vira lista

`media_url` (texto único) não suporta álbum, e não tem onde guardar duração de áudio. Vira `media`, uma lista de objetos.

**As duas CHECK constraints da `071` bloqueiam isso e precisam cair:**

- `social_proof_messages_has_content` exige `content_text is not null or media_url is not null`. Uma mensagem de álbum tem a mídia na lista e `media_url` nulo — o banco recusaria o insert.
- `social_proof_messages_media_type_consistent` fica obsoleta.

A `073` derruba as duas, faz o backfill, e cria uma constraint nova que entende a lista:

```sql
-- Backfill antes de trocar as constraints, senão as linhas existentes
-- violam a regra nova no momento em que ela é criada.
update public.social_proof_messages
set media = jsonb_build_array(
      jsonb_build_object(
        'url', media_url,
        'type', case when media_type = 'image' then 'photo' else media_type end
      )
    ),
    kind = case when media_type = 'image' then 'photo' else 'video' end
where media_url is not null and media = '[]'::jsonb;

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
```

`media_url` e `media_type` ficam na tabela, sem uso, até uma limpeza futura. Removê-las agora exigiria coordenar com código já em produção sem ganho imediato.

### 3.4 Índice

O índice da `071` (`channel_id, is_active, position, created_at`) continua correto — nenhuma query nova muda a forma de leitura.

## 4. Upload

`uploadMedia()` ganha os tipos de áudio na allowlist (`lib/actions/upload-actions.ts:35`):

```ts
"audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav",
```

Decisão do usuário: estender a função compartilhada em vez de duplicar. O bot já envia áudio pelo Telegram, então aceitar upload de áudio é coerente com o resto do produto, e duas funções de upload divergiriam com o tempo.

O `media-picker` do editor aceita **arrastar-e-soltar**, **escolher arquivo**, e **colar URL** — os três caminhos do mockup.

## 5. Componentes do Mini App que precisam crescer

Em `components/telegram/`. Sem isso, o console cria o que o lead não vê.

| Componente | Novo ou muda | Papel |
|---|---|---|
| `PinnedBar` | novo | Barra "Mensagem fixada" no topo, com X |
| `ReactionsRow` | novo | Pílulas de emoji com contador sob a bolha |
| `AlbumGrid` | novo | Grade de 2–4 mídias dentro de uma bolha |
| `AudioBubble` | novo | Onda estática, botão de play, duração |
| `ReplyPreview` | novo | Bloco citado dentro da bolha |
| `MediaContainer` | muda | Sobreposição de play e duração no vídeo |
| `MessageBubble` | muda | Selo "Dona do canal", reações, resposta, álbum, áudio |
| `MessageGroup` | muda | Avatar da dona vs. do membro |
| `ChannelHeader` | muda | Seta de voltar e badge de não lidas |

**A onda do áudio é estática**, derivada de um hash do id da mensagem — não há análise de forma de onda real. Áudio falso com onda plausível convence; onda real custa processamento de arquivo sem ganho visual proporcional.

## 6. A tela do console

Três colunas, conforme o mockup.

### Esquerda
Cartão **Canal** (avatar, nome, selo, inscritos, toggles de "Selo de verificação" e "Ativo no Mini App"). Cartão **Identidade da dona** (avatar, nome, `@username`). Lista **Mensagens**, reordenável por arrastar, cada linha com número, avatar, autor, tipo, tempo relativo, views e menu `⋮`. Botão **Nova mensagem**.

### Centro
A prévia usando os componentes **reais** do Mini App — não uma reimplementação. É a única forma de a prévia não mentir. Abaixo, a barra de composição rápida ("Digite sua mensagem..." + seletor "Enviar como") que cria uma mensagem de texto sem passar pelo editor.

### Direita
Editor da mensagem selecionada: **Enviar como** (dois cartões), **Tipo** (cinco botões segmentados), **Conteúdo** (textarea com contador `n/1024`), **Mídia** (miniatura com X + zona de arrastar + "ou usar URL"), **Metadados** (views, minutos atrás, horário opcional), **Reações**, e as ações **Duplicar / Responder / Fixar / Excluir**.

### Nenhum `<select>` na tela

No Windows, `<option>` é desenhado pelo sistema operacional e ignora CSS da página. É a causa raiz do campo branco ilegível que o usuário relatou, e nenhum tema conserta. Todo lugar que pediria um `select` usa botões segmentados ou uma lista customizada.

## 7. Decisões e seus motivos

- **Reordenar com eventos nativos de HTML5** (`draggable`, `dragover`, `drop`), sem dependência nova. `@xyflow/react` existe no projeto mas é do editor de fluxos, e trazê-lo pra cá seria peso desproporcional.
- **Reações com paleta fixa** — ❤️ 🔥 👏 😂 😮 🙏 💎. Um seletor completo de emoji é uma dependência inteira para um caso em que sete opções cobrem quase tudo.
- **Identidade do membro continua por mensagem.** O mockup não tem seção de membros cadastrados, e `peerColorIndex` já garante que "Ana" saia sempre da mesma cor. Um elenco cadastrado seria estado a mais sem ganho visível.
- **`display_time` sobrepõe o offset quando preenchido.** O mockup mostra "há 10 min" e "02:44" simultaneamente: o offset ordena e descreve, o horário fixa o que aparece na bolha.

## 8. Testes

`vitest`, em `tests/lib/` (convenção plana do repo).

| Alvo | Por quê |
|---|---|
| Normalização de `media` (colunas antigas → lista) | É a conversão que a migration faz e que o código precisa reproduzir |
| `sender_kind` → identidade resolvida (dona vs. membro) | Decide avatar, nome e selo de toda bolha |
| Reordenação (mover item de índice A para B) | Aritmética de índice erra fácil e o resultado é invisível em teste manual |
| `display_time` sobrepondo o offset | Duas fontes para o mesmo pixel |
| Validação de `kind` contra `media` | `album` sem mídia, `text` com mídia, `audio` sem duração |

## 9. Riscos

| Risco | Mitigação |
|---|---|
| A `071` está em produção; a `073` altera tabela com dados | Idempotente, backfill antes de trocar constraints |
| Console cria o que o Mini App não desenha | §5 lista os componentes; nenhum campo entra sem bolha correspondente |
| A tela do console fica grande demais num arquivo | Um arquivo por cartão/painel, não um composer monolítico |
| Prévia divergir do resultado real | A prévia usa os componentes reais, nunca markup próprio |

## 10. Fora de escopo

Seletor completo de emoji, edição de imagem no navegador, agendamento de publicação, e importação de canal real via MTProto.
