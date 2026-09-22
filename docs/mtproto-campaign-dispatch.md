# Disparo MTProto: alvos pulados e contadores derivados

## Intervalos e edição durante o envio

A versão de 22/09 permite editar nome, mensagem, intervalo entre mensagens e
recorrência sem pausar. O worker lê a configuração antes de cada envio; uma
mensagem que já está em trânsito mantém o texto anterior. O intervalo dos ciclos
conta desde o início: se o ciclo ultrapassar o intervalo, o próximo fica elegível
imediatamente, sem sobreposição. A fila verifica campanhas a cada segundo;
rede, duração dos envios e ocupação dos workers também afetam o horário real.

Aplicar `086_mtproto_campaign_configured_timing.sql` com o worker antigo parado
e publicar o Next e o server atualizados. Essa migration remove esperas antigas
inventadas pelo app e recalcula a próxima recorrência quando ela é editada.
Prazos explícitos de FLOOD_WAIT são preservados. PEER_FLOOD e falhas transitórias
são reavaliados no intervalo de recorrência escolhido (ou no intervalo mínimo
entre mensagens, com pelo menos 1 segundo, quando não há recorrência).

Validação isolada: `./server/scripts/test-mtproto-campaign-timing.ps1`.

## Deploy

1. Preparar a versão atualizada do server e do Next. Pausar as campanhas e
   interromper o worker antigo antes da alteração do banco.
2. Aplicar, nesta ordem, `supabase/migrations/083_mtproto_campaign_skipped_targets.sql`
   e `supabase/migrations/084_mtproto_campaign_counter_concurrency.sql` no Supabase.
   Se a 083 já foi aplicada, executar apenas a 084.
3. Publicar o server (worker) e o Next a partir do código atualizado. Conferir
   os contadores com as linhas de alvos antes de retomar as campanhas.

A ordem importa: a partir desta versão o código **não escreve mais**
`sent_count`, `failed_count`, `skipped_count` nem `total_targets` — quem
mantém os quatro é o trigger da migration, recalculando a partir das linhas
de `mtproto_targets` a cada INSERT/UPDATE/DELETE. Código novo sem a migration
deixa os contadores congelados. O worker antigo também é incompatível: a 083
remove as colunas `plain_text_forbidden` usadas por ele, e seus incrementos
manuais podem sobrescrever a contagem derivada. Evite essa combinação durante
o deploy.

A migration também roda um backfill: toda campanha existente passa a mostrar
o que as linhas dizem (é o que corrige na hora uma tela em "Enviadas 0 de
316" com a lista cheia de enviadas).

Para validar a migration localmente sem tocar no Supabase:
`./server/scripts/test-mtproto-campaign-counters.ps1` (PostgreSQL 16 em
contêiner descartável limitado a 256 MB e uma CPU, mesmo molde do teste da 076).
O teste inclui duas conexões reais para reproduzir envio e inclusão de novos
alvos simultâneos. A 084 bloqueia a linha da campanha antes de recontar com um
snapshot atualizado; sem ela, essa concorrência pode voltar a zerar enviadas.

## O que mudou no comportamento

- **Alvo pulado (`status = 'skipped'`)**: destino que nunca vai aceitar a
  mensagem desta conta. Fica na lista com o motivo, fora do total e do
  progresso, e não conta como falha. Dois caminhos levam até ele:
  - na **sincronização** (`mtproto_dialogs.write_block`), pelas permissões
    que o Telegram já entrega: canal broadcast sem admin, conta silenciada,
    "Enviar mensagens" desligado pra membros, chat restrito, conta que saiu;
  - no **envio** (`mtproto_dialogs.send_refusal`, sticky), quando o Telegram
    recusa com código permanente (`CHAT_WRITE_FORBIDDEN`,
    `CHAT_ADMIN_REQUIRED`, `USER_BANNED_IN_CHANNEL`, `CHAT_RESTRICTED`,
    `CHANNEL_PRIVATE`, `PEER_ID_INVALID`, `TOPIC_CLOSED`... lista fechada em
    `server/src/services/mtproto/unwritable.ts`).
  Os rebuilds da campanha global (hot-add e refresh) recriam esses alvos como
  pulados a cada ciclo; o dialog marcado nunca volta como pendente.
- **`channel_subscriber` saiu do disparo global**: assinante não publica em
  canal broadcast; cada um era um `CHAT_ADMIN_REQUIRED` garantido.
- **Fórum com General fechado**: no `TOPIC_CLOSED` o worker lista os tópicos,
  publica no primeiro aberto e guarda o escolhido em
  `mtproto_dialogs.forum_topic_id`. Sem tópico aberto, o alvo é pulado.
- **Reset da recorrência** devolve as linhas `sent` pra `pending` (antes, o
  filtro `.neq` excluía `error_message` nulo e elas ficavam presas em `sent`
  enquanto o contador zerava) e mantém `account_id` em alvo com `dialog_id`
  (o access_hash é da conta dona).
- **Tela da campanha**: carrega todos os alvos (paginado), KPI de pulados,
  filtro por status, status em português e motivo traduzido
  (`lib/mtproto/campaign-errors.ts`).
