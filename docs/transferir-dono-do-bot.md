# Transferir um bot para outro usuário

Caso de uso: um admin criou o bot na própria conta, mas quem opera (e quem deve
receber as vendas) é outro usuário. A transferência move o bot **e tudo que é
dele** para a conta certa.

## 1. Aplicar a migration

A funcionalidade depende da função `public.transfer_bot_owner`, criada em
`supabase/migrations/067_transfer_bot_owner.sql`.

```bash
supabase db push
```

Ou, pelo painel: **SQL Editor → New query**, cole o conteúdo da 067 e rode. O
arquivo é `create or replace`, então pode rodar mais de uma vez sem problema.

## 2. Usar

**Painel Admin → clique no usuário → tabela "Bots" → botão "Transferir"**.

Escolha o novo dono na lista (busca por nome ou e-mail) e confirme. O bot some
da tabela daquele usuário e passa a aparecer na conta do novo dono.

## O que vai junto

Tudo que tem `bot_id`, numa transação só — ou muda tudo, ou não muda nada:

| Tabela | O que é |
| --- | --- |
| `bots` | o bot em si |
| `leads` | os leads |
| `transactions` | as vendas |
| `flows` | os fluxos |
| `products`, `product_bundles` | produtos e conjuntos |
| `tracking_events` | eventos de tracking |
| `remarketing_configs`, `remarketing_flows`, `remarketing_variant_sends` | remarketing |
| `lead_messages` | histórico de conversa |
| `media_assets` | biblioteca de mídia do bot |
| `mtproto_login_sessions` | sessões de login pendentes |
| `tenant_lead_identity` | atribuição de campanha que nasceu neste bot (copiada, não movida) |

A partir daí, **notificação de venda, análises e dashboard** do bot caem na
conta do novo dono — tudo isso é lido por `tenant_id`, que acabou de mudar.

O link do anúncio **não muda**: `/t?bot=<botId>` usa o id do bot, não o do dono.
Campanhas no ar continuam funcionando.

## O que NÃO vai junto (de propósito)

- **Regras do filtro de tráfego** (`traffic_filter_rules`) — são da *conta*, não
  do bot, e valem pra todos os bots daquele dono. Se o bot dependia de alguma
  regra custom, recadastre na conta do novo dono. O robô revisor do Facebook não
  é afetado: desde a migration 046 quem decide isso é a flag
  `bots.tf_block_fb_crawler`, que acompanha o bot.
- **Dispositivos de push** (`push_subscriptions`) — são do usuário. O novo dono
  passa a receber as vendas porque as `transactions` mudaram de dono, nos
  aparelhos que ele já tiver cadastrado.
- **Contas MTProto e bot de automação** — infraestrutura da conta de quem clonou.
- **Clonagens de bot** (`bot_clone_jobs`) — a linha aponta pra conta de Telegram
  *pessoal* que fez a exploração (`account_id`), e essa conta fica com o dono
  antigo. Mover só o `tenant_id` partiria a linha entre dois donos e o novo dono
  passaria a poder dirigir o Telegram do antigo pelo botão "Retomar". O que
  importa do clone — o fluxo gerado — já viaja em `flows`.

## Quando a transferência é recusada

| Erro | Motivo |
| --- | --- |
| `apenas admin pode transferir a posse de um bot` | quem chamou não é admin |
| `bot @x é bot de login MTProto` | desmarque a opção antes — quem receber o bot passaria a vincular contas MTProto ao próprio tenant |
| `bot @x tem N clonagem(ns) não finalizada(s)` | qualquer job que não esteja `completed` pode ser relançado ("Lançar", "Retomar", "Tentar de novo") e voltaria a gravar no bot depois da troca, usando a conta MTProto do dono antigo. Conclua, apague ou espere terminar |

## Detalhes de operação

A migration 067 também troca o corpo de `public.update_updated_at()` (o trigger
de `updated_at` de `leads`, `flows` e remarketing). Motivo: a transferência é um
`update` nessas tabelas, e o trigger carimbaria `now()` em todos os leads — a
tela de Clientes mostra `lead.updated_at` como "última atividade", então todo
mundo apareceria como se tivesse falado agora. A função passa a respeitar uma
chave de transação (`eaglebot.preserve_updated_at`) que só a transferência liga;
para todo o resto do sistema o comportamento é idêntico ao de antes.


O servidor do bot guarda a linha de `bots` em cache por 10 minutos
(`server/src/cache.ts`). A server action chama
`POST /api/bots/:botId/invalidate-cache` logo depois da troca. Se esse servidor
estiver fora do ar, a tela avisa: a troca **já está no banco**, mas o processo do
bot pode levar até o TTL do cache pra enxergar o novo dono — nesse intervalo, um
lead novo ainda seria gravado com o `tenant_id` antigo.
