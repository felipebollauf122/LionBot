# Recuperação e acompanhamento dos disparos

O banco guarda a intenção do operador. A cada 5 segundos, o agendador recupera
campanhas `running` sem heartbeat recente e campanhas `scheduled` cujo prazo
venceu, mesmo sem recorrência. `paused`, `draft`, `completed` e `failed` não são
reativados automaticamente. O worker confere o estado de novo antes de assumir.

Cada campanha usa um job determinístico, removido ao terminar, para impedir
enfileiramentos concorrentes. O claim compara também o timestamp anterior; o
heartbeat renova a posse a cada 30 segundos, com expiração após 2 minutos.
O processo antigo não pode liberar a posse de um sucessor.

Uma entrega que não termina em 90 segundos encerra seu cliente privado e preserva
o destino para outra tentativa. A conta é fixada antes da rede; o `random_id`
deriva do destino e do ciclo, reduzindo duplicatas quando a resposta se perde.
Isso não constitui garantia de entrega exatamente uma vez fora da janela de
deduplicação do Telegram.

`FLOOD_WAIT` respeita o prazo recebido. `PEER_FLOOD` persiste uma espera de 24 horas
na conta e na campanha; esse é um intervalo de reavaliação do aplicativo, não uma
garantia de liberação. Falhas de conexão aguardam 60 segundos. Conta indisponível
é reavaliada em 5 minutos sem marcar seus destinos como falha. Sessões revogadas
continuam exigindo reconexão. Destinos permanentemente bloqueados são pulados.

Novos disparos vêm com repetição habilitada; o operador pode desmarcá-la para um
único ciclo. Campanhas existentes conservam sua recorrência. A pausa manual
interrompe os próximos envios e não é desfeita pelo recuperador. Uma requisição
já enviada ao Telegram pode terminar depois do clique.

A sincronização de contatos roda separadamente. O ciclo global usa o snapshot
salvo, evitando ficar preso na sincronização de uma conexão indisponível.

Na tela, **total da lista = aptos + pulados**. O progresso conta enviados,
falhas e pulados como processados; mensagens entregues aparecem separadamente.
A lista tem busca, motivos agrupados e paginação de 50 registros. Falhas de
atualização preservam os últimos dados visíveis.

Referências: [IDs de jobs no BullMQ](https://docs.bullmq.io/guide/jobs/job-ids) e
[esperas exigidas pelo Telegram](https://core.telegram.org/api/errors).
