# Recuperação automática de bots

O worker detecta credenciais inválidas, recria o bot via uma conta MTProto do mesmo tenant, restaura a identidade e troca `bots.telegram_token` e `bots.bot_username` no registro existente. Leads, fluxos, produtos, pagamentos e mensagens continuam ligados ao mesmo `bots.id`.

## Ativação

1. Aplicar `supabase/migrations/076_bot_auto_healing.sql` no Supabase. Ela cria duas tabelas privadas, um bucket privado `bot-identity` e a função transacional `commit_bot_recovery`.
2. No worker, configurar `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `REDIS_URL`, `BASE_WEBHOOK_URL` e `INTERNAL_API_SECRET`, conforme `server/env.example`.
3. Manter pelo menos uma conta de usuário MTProto **já autenticada**, ativa e pertencente ao tenant do bot. Sem lista explícita de contas, são consideradas as contas disponíveis desse tenant.
4. Definir `BOT_AUTO_HEAL_ENABLED=true` e reiniciar o worker. O padrão é `false`, permitindo aplicar a migração antes de ativar o serviço. O supervisor tem seu próprio worker BullMQ; não depende de `MTPROTO_WORKER_ENABLED`.
5. Consultar o endpoint de status e verificar `identityReady=true` enquanto o token antigo ainda funciona. Um bot que já estava excluído antes da ativação não terá backup recuperável e ficará em `identity_backup_missing`.
6. Para alertas no dispositivo do administrador/tenant, configurar VAPID e uma assinatura Web Push existente. Os estados de atenção também ficam persistidos e são registrados nos logs sem tokens.

Ao ativar globalmente, todos os bots ativos são elegíveis por padrão. É possível desabilitar individualmente ou limitar as contas autorizadas pelos endpoints abaixo. O sistema não cria sessões de usuário nem pede códigos de login durante a recuperação.

## Endpoints internos

Todos exigem `x-internal-secret: <INTERNAL_API_SECRET>` e um `tenantId` correspondente ao dono atual do bot. O frontend, se integrar estes endpoints, deve validar a sessão do usuário e obter o tenant no servidor antes de encaminhar a chamada. O segredo interno nunca deve ser enviado ao navegador.

| Método e caminho | Entrada | Resultado |
| --- | --- | --- |
| `GET /api/bots/:botId/auto-healing?tenantId=<uuid>` | Query `tenantId` | Configuração, data do backup e últimas 20 recuperações, sem credenciais |
| `POST /api/bots/:botId/auto-healing` | `{ "tenantId": "<uuid>", "enabled": true, "accountIds": [] }` | Habilita/desabilita; lista vazia usa contas do tenant; lista preenchida limita as sessões |
| `POST /api/bots/:botId/auto-healing/retry` | `{ "tenantId": "<uuid>" }` | Retoma uma recuperação em `needs_attention`, preservando token e checkpoints |

IDs de contas de outro tenant são recusados. A propriedade da conta, o token, a ativação e a propriedade do bot são revalidados durante a execução; o commit também verifica essas condições no banco.

## Execução e retomada

- Falhas `401` ou descrições explícitas de bot excluído/banido/desativado em `403` notificam o supervisor. Isso cobre o cliente HTTP principal, uploads multipart e o publicador grammy de clones/campanhas. Não inclui tokens independentes de `automation_bots`: a recuperação é dos registros de `bots`.
- `getMe` confirma a falha da credencial atual antes de criar a recuperação. **401 não prova exclusão**: revogação do token também invalida a autenticação e, com a feature habilitada, segue a mesma política de substituição. Bloqueio por um usuário, expulsão de um grupo, `404`, `429`, `5xx`, timeouts e silêncio de webhooks não são tratados como exclusão.
- Uma varredura a cada minuto verifica bots ativos e retoma execuções pendentes. Sem falha de autenticação, `getWebhookInfo` permite corrigir um webhook ausente/incorreto. A fila pode acrescentar latência conforme o tamanho da frota.
- O backup diário e o backup inicial capturam nome real, username, descrição, about e os bytes da foto no Storage privado. Não há dependência de um `file_id` ou de uma URL com o token antigo. A versão anterior da foto não é sobrescrita se o salvamento da nova metadata falhar.
- Cada par `(bot_id, hash do token antigo)` tem no máximo um registro de recuperação. Jobs Redis contêm somente IDs; tokens novos ficam temporariamente na tabela privada.
- Locks Redis com renovação serializam cada bot e cada conversa com BotFather entre réplicas. Cada envio confirma o lock e a propriedade dos recursos. Mudanças manuais simultâneas na mesma conversa do BotFather podem interromper a máquina de estados; evite usar essa conversa durante uma recuperação.
- O worker verifica o perfil oficial e verificado do BotFather, usa `/newbot` e envia o nome salvo. As sugestões do Gemini recebem todo o histórico de tentativas e são validadas localmente: 5–32 caracteres, letras/números/underscore, primeiro caractere letra e sufixo `bot`.
- Há pausas de 1,5 segundo entre mensagens. Após dez sugestões sem sucesso, a execução libera a conta e aguarda pelo menos um minuto; o loop continua com o histórico preservado. `FLOOD_WAIT` e os tempos informados pelo BotFather são persistidos e respeitados, inclusive após reinício.
- A sugestão e o cursor do histórico são persistidos **antes** de enviar o username. Se o processo cair, a retomada procura a resposta de sucesso no histórico recente. Se não for possível determinar o resultado, entra em `creation_outcome_unknown`; não envia outro `/newbot` nessa situação. A resposta pode ser recuperada ao tentar novamente, se chegar depois.
- O token extraído só é aceito de uma resposta que mencione o username esperado; depois, `getMe` valida username e ID do novo bot. `/setuserpic`, `/setdescription` e `/setabouttext` restauram a identidade. As etapas de restauração são repetíveis.
- O novo webhook é registrado e consultado antes da troca no banco. O commit mantém o ID interno, troca token/username/URL e completa a execução na mesma transação. Um token alterado manualmente, bot desativado, recuperação desabilitada ou troca de dono impede o commit.
- O cache local é invalidado e Redis pub/sub avisa as outras réplicas. A varredura periódica também invalida caches para recuperar notificações perdidas. Chamadas que já estavam em andamento com o token antigo podem falhar; chamadas futuras usam o novo registro.

## Estados e intervenção

| Estado/código | Comportamento |
| --- | --- |
| `queued`, `creating`, `restoring` | A fila retoma automaticamente; `retry_at` define o primeiro instante permitido |
| `completed` | Token trocado e webhook verificado; cópia temporária do token removida |
| `cancelled` / `bot_changed` | Alteração manual ou transferência prevaleceu; nenhum commit automático |
| `identity_backup_missing` | É necessário um backup anterior à perda do token |
| `all_accounts_bot_limit` | BotFather recusou todas as contas por limite de bots; liberar capacidade ou adicionar uma conta do mesmo tenant e solicitar retry |
| `mtproto_account_unavailable`, `mtproto_session_unavailable` | Reconectar a sessão ou corrigir a lista de contas e solicitar retry |
| `replacement_credential_invalid` | O token recém-criado foi invalidado; permanece registrado para diagnóstico restrito ao serviço |
| `creation_outcome_unknown` | Resultado do envio incerto; verificar BotFather antes de qualquer intervenção manual no checkpoint |
| `botfather_*_changed`, `account_restricted` | Resposta inesperada ou restrição explícita; a execução para e registra o motivo |

O limite de bots é reconhecido pela resposta do BotFather; não há contador local que suponha que toda conta tenha exatamente 20 vagas. A rotação ocorre somente quando ainda não existe bot/token criado nessa execução. Após a criação, a restauração permanece vinculada à conta criadora.

Tokens temporários de execuções interrompidas/canceladas são mantidos na tabela privada para permitir recuperação operacional. Não copie respostas completas do BotFather, tokens ou sessões para logs, chamados ou prompts. O status HTTP não expõe esses campos. As fotos são versionadas; não há limpeza automática de versões antigas nesta implementação.

## Limites da continuidade no Telegram

Esta implementação preserva o histórico **do sistema**, mas não transfere a identidade do Telegram. O novo bot tem outro ID e username. Usuários precisam abrir/iniciar a conversa com ele; o bot novo não pode iniciar uma conversa privada por ter o histórico no nosso banco. Bots não herdam permissões de administrador, participação em grupos/canais, mensagens antigas ou configurações externas do bot excluído. Promova o substituto novamente nos destinos que exigem permissão.

Links de rastreamento que consultam `bots.bot_username` passam a resolver o novo username. Links `t.me` literais publicados anteriormente, comandos personalizados, menu buttons, configurações de pagamentos Telegram e outras configurações externas não são reescritos/restaurados aqui. Apenas nome, foto, descrição, about e webhook estão no escopo da restauração de identidade.

`file_id`, IDs de mensagens e callbacks antigos pertencem ao bot original. Não são remapeados para IDs do novo bot. Fotos/áudios do fluxo que usam URLs próprias continuam reutilizáveis; mídias armazenadas somente como `file_id` exigem os arquivos originais. A fila de exclusão de mensagens antigas mantém a credencial original para evitar apagar uma mensagem diferente no bot novo.

Referências: [BotFather e propriedades dos bots](https://core.telegram.org/bots/features#botfather), [Bot API e restrições de arquivos](https://core.telegram.org/bots/api#sending-files), [introdução aos bots](https://core.telegram.org/bots), [GramJS TelegramClient](https://gram.js.org/beta/classes/TelegramClient.html), [Gemini generateContent](https://ai.google.dev/api/generate-content).

## Validação local

Na pasta `server`, execute `node node_modules/typescript/bin/tsc --noEmit` e `node node_modules/vitest/vitest.mjs run`. Os testes da feature simulam APIs e não enviam mensagens reais.

Para validar a migração com PostgreSQL 16: `./scripts/test-bot-healing-migration.ps1`. O script usa a imagem local `postgres:16-alpine`, inicia um contêiner sem rede nem volumes de host, testa permissões e o commit transacional e remove o contêiner ao terminar. Não conecta ao Supabase configurado nem aplica migrações no ambiente real.
