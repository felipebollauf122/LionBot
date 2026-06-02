# Auditoria Profunda EagleBot — 2026-06-01

> Auditoria com 47 agentes em 6 dimensões, achados verificados contra o código real.
> Plano de execução para amanhã. **Não adicionar perguntas novas ao cliente no funil.**

## 🔙 PONTO DE RESTAURAÇÃO

- **Commit:** `2225dce` (fix(ghost): NUNCA vaza nome real pra fora)
- **Tag git:** `restore-point-2026-06-01`
- **Como voltar tudo:** `git reset --hard restore-point-2026-06-01` (no VPS e local) + redeploy
- **Branch de trabalho recomendada amanhã:** `git checkout -b melhorias-2026-06-02` (assim o main fica intacto)

---

## ONDA 1 — EMQ FACEBOOK (subir de 7 → 8+)

Objetivo: nota EMQ ≥ 8 e parar de queimar campanhas. **Sem perguntas novas ao cliente.**

| # | Item | Arquivo | Impacto EMQ | Esforço |
|---|------|---------|-------------|---------|
| 1 | **Propagar fbp/fbc/IP/UA até os eventos CAPI** — hoje são capturados na tracking page (`event_data`) mas `resolveTrackingData`/`resolveFlowName` só pegam fbclid+UTMs. Persistir em colunas novas do lead e usar em TODOS os eventos. | `webhook/telegram.ts`, `lead-service.ts`, migration | +0.4 a +0.7 | médio |
| 2 | **Reativar Lead/ViewContent/InitiateCheckout no CAPI** — hoje só Purchase dispara (decisão antiga "Purchase-only"). Reativar COM user_data rico (só quando há dados, nunca evento "pelado"). | `tracking-service.ts` | +1.5 a +2.5 | grande |
| 3 | **fbp consistente do 1º toque ao Purchase** — guardar fbp no lead, reusar em todos os eventos (não regerar). | `lead-service.ts`, `tracking-service.ts` | +0.4 a +0.7 | médio |
| 4 | **IP/UA do contexto certo** — recapturar no momento do Purchase quando possível; fallback pro da tracking page. | `purchase-completer.ts` | +0.2 a +0.4 | médio |
| 5 | **event_time do Purchase = paid_at** (não Date.now()). | `tracking-service.ts:185` | +0.1 a +0.2 | pequeno |
| 6 | **Dedup de Purchase** — coluna `transactions.sent_to_facebook`; só dispara 1x; retry com backoff. | `purchase-completer.ts`, migration | +0.2 a +0.4 | pequeno |
| 7 | **Guard email vazio no CAPI** — hoje rejeita `@eaglebot.temp` mas aceita `""`. Não setar `em` se vazio. | `facebook-capi.ts:100` | +0.3 (qualidade) | trivial |
| 8 | **Normalizar nome antes do hash** — remover acentos (NFD), espaços duplos, rejeitar placeholder ("anônimo","na"). | `facebook-capi.ts:97-98` | +0.2 a +0.4 | pequeno |
| 9 | **Validação forte de telefone E.164** + log quando rejeitado. | `facebook-capi.ts:103-108` | +0.3 a +0.5 | pequeno |
| 10 | **external_id extra: CPF e telefone hash** (quando existirem no state). | `tracking-service.ts:126` | +0.2 a +0.4 | pequeno |
| 11 | **ct/st/zp/db (cidade/estado/CEP/nascimento)** — ⚠️ EXIGIRIA coletar dados novos. **PULAR** (decisão do dono: sem perguntas novas). Só ativar se vier de algum lugar sem fricção (ex: gateway retorna no payload do pagador). Investigar se SigiloPay/EvPay devolvem CPF/nome/cidade do pagador no webhook → usar isso. | — | +0.5 a +1.0 (se vier de graça) | médio |
| 12 | **Pixel JS no browser (PageView/ViewContent) com event_id compartilhado pra dedup browser+server** — DECISÃO PENDENTE (você decide amanhã). Maior mover isolado (+1.5 a +2.0). | `app/t/page.tsx` | +1.5 a +2.0 | grande |
| 13 | **PageView server-side no CAPI** quando a tracking page é visitada. | `app/t/page.tsx` / tracking-service | +0.5 a +1.0 | médio |
| 14 | **country via geo-IP** (CF-IPCountry header) em vez de "br" hardcoded. | `facebook-capi.ts:110` | +0.1 (só se há gringo) | pequeno |

**Impacto combinado estimado (sem #11/#12 que exigem decisão):** EMQ 7 → ~8.0-8.3.
**Com #12 (Pixel browser):** ~8.5-9.0.

---

## ONDA 2 — SEGURANÇA CRÍTICA (fraude/dados)

| # | Item | Severidade | Arquivo |
|---|------|-----------|---------|
| 15 | **Webhook SigiloPay sem validação HMAC** — qualquer um forja `status=APPROVED` e recebe produto de graça. Implementar assinatura igual ao EvPay. ⚠️ depende de descobrir o header/secret que a Poseidon usa. | CRÍTICO | `webhook/payment.ts:270` |
| 16 | **Endpoints Express sem autenticação** (`/api/bots/:id/delete`, `register-webhook`, `/api/mtproto/*`) — qualquer um na rede chama. Adicionar HMAC entre dashboard↔engine ou validar token Supabase. | CRÍTICO | `index.ts:68-369` |
| 17 | **CORS reflete qualquer origin** — permite CSRF. Whitelist de origens. | ALTO | `index.ts:27-39` |
| 18 | **Coluna `tenants.role` NUNCA criada** — `is_admin()` sempre retorna false (consulta coluna inexistente). Schema mismatch com migration 028 (`is_owner`). **Pode estar quebrando o painel admin AGORA.** Migration pra alinhar. | ALTO | `admin-actions.ts`, migration 007 |
| 19 | **`EVPAY_REQUIRE_SIGNATURE` default false** — em prod ignora HMAC. Mudar default pra true. | MÉDIO | `config.ts:25` |
| 20 | **IDOR no webhook de pagamento** — fallback de lookup sem `bot_id` confirma pagamento de transação de outro bot. | MÉDIO | `payment.ts:114-141` |
| 21 | **upload-actions usa service_role** — bypassa RLS em upload de usuário. Usar client autenticado. | ALTO | `upload-actions.ts:4` |
| 22 | **RLS: usuário pode mudar próprio `role`/`is_owner`** — bloquear UPDATE dessas colunas. | MÉDIO | migration |
| 23 | **MTProto endpoints sem verificação de tenant** — manipular conta de outro tenant. | MÉDIO | `index.ts:205-269` |
| 24 | **Logs vazam request body inteiro** — redação de campos sensíveis. | MÉDIO | `payment.ts:103` |

---

## ONDA 3 — PERFORMANCE / TEMPO DE RESPOSTA DO BOT

| # | Item | Impacto | Arquivo |
|---|------|---------|---------|
| 25 | **`findTrackingEvent` faz até 3s de sleep no hot path** do /start (3 retries x 1s). Mover pra background job. | CRÍTICO (3s de atraso no /start) | `telegram.ts:59-80` |
| 26 | **Queries sequenciais no hot path do webhook** (8-13 queries seriais, com `isBlacklisted` duplicado e `black_enabled` refetch redundante). Paralelizar + remover duplicação. | CRÍTICO | `telegram.ts:191-301` |
| 27 | **`resolveTenantIdentity` faz SELECT+INSERT/UPDATE por mensagem** → usar upsert + cache 10s. | ALTO | `lead-identity.ts:41-125` |
| 28 | **N+1 no remarketing** — `checkAudience` faz 1 COUNT por lead (1000 leads = 1000 queries). Trocar por 1 query GROUP BY. | ALTO | `remarketing-worker.ts:295-314` |
| 29 | **TTL de cache curto** (bot 300s, flow 120s) causa thundering herd. Subir pra 1h/30min + invalidação ativa. | MÉDIO | `cache.ts:48-54` |
| 30 | **Caches são Maps sem limite** (botCache/flowCache) — risco de OOM. LRU com max size + cleanup ativo. | MÉDIO | `cache.ts` |
| 31 | **`isBlacklisted` query por mensagem** — cachear Set por bot (5min TTL). | MÉDIO | `blacklist.ts:10-22` |
| 32 | **Índices faltando** em transactions(lead_id,status), transactions(gateway,status,created_at), message_delete_queue(status,delete_at). | MÉDIO | migration |
| 33 | **`updatePosition` 2x por flow simples** — batch update no fim. | MÉDIO | `lead-service.ts:119-138` |
| 34 | **3 pollers concorrentes sem rate-limit** (evpay 5s, remarketing 60s, deletion 30s) — staggering + semáforo. | MÉDIO | `queue.ts` |
| 35 | **`payment.ts` 2 queries seriais** (bot+lead) → Promise.all. | ALTO | `payment.ts:206,213` |
| 36 | **Dashboard 3 queries seriais** → Promise.all. | MÉDIO | `app/dashboard/page.tsx:8-26` |

---

## ONDA 4 — FRONTEND / TRACKING PAGE

| # | Item | Impacto | Arquivo |
|---|------|---------|---------|
| 37 | **Tracking page: insert bloqueante + query sem cache** no caminho do anúncio. Fire-and-forget no insert + considerar route handler. | CRÍTICO (caminho do dinheiro) | `app/t/page.tsx:38-123` |
| 38 | **`getTrackingFunnel` 5 queries waterfall** → Promise.all. | CRÍTICO | `tracking-actions.ts:45-52` |
| 39 | **Flow editor sem dynamic import** (ReactFlow ~80KB em toda página). | ALTO | `flow-editor.tsx` |
| 40 | **`window.location.reload()` em vários componentes** → `router.refresh()`. | MÉDIO | vários |
| 41 | **Bot layout query sem cache** (re-query a cada navegação). | ALTO | `bots/[botId]/layout.tsx` |
| 42 | **Imagens com `<img>` em vez de next/image.** | ALTO | vários |
| 43 | **Sem Suspense/loading states** nas páginas data-heavy. | ALTO | vários |
| 44 | **next.config sem otimizações** (compress, optimizePackageImports). | MÉDIO | `next.config.ts` |

---

## ONDA 5 — ROBUSTEZ MTPROTO

| # | Item | Severidade | Arquivo |
|---|------|-----------|---------|
| 45 | **`liveClients` Map cresce sem limite** — memory leak. TTL cleanup. | ALTO | `mtproto-worker.ts:26` |
| 46 | **Sem graceful shutdown** — conexões MTProto vazam no restart. | ALTO | `mtproto-worker.ts:669` |
| 47 | **FLOOD_WAIT em conta pinned = target perdido pra sempre** (campanha não-recorrente). | ALTO | `campaign-runner.ts:179` |
| 48 | **`createChannel` não trata FLOOD_WAIT** — canal vira "dead" sem retry. | ALTO | `channel-creator.ts:98` |
| 49 | **Sem rate-limit por conta** — bursts de retry podem passar limite do Telegram → ban. | ALTO | `campaign-runner.ts` |
| 50 | **Delay pode ser 0** (delayMin=delayMax=0) → spam → ban. Mínimo 1s. | MÉDIO | `campaign-runner.ts:225` |
| 51 | **sync-dialogs sem dedup** — múltiplos syncs paralelos da mesma conta. | MÉDIO | `mtproto-worker.ts:164` |
| 52 | **channel-monitor cria client por instância sem pooling** — 200 conexões/min. | MÉDIO | `channel-monitor-poller.ts:67` |
| 53 | **randomId com Math.random()** — pode colidir. Usar crypto. | BAIXO | `client.ts:650` |
| 54 | **sendMessage com phone importa contato toda vez** — incha conta. Cache. | MÉDIO | `client.ts:130` |

---

## ONDA 6 — CONFIABILIDADE DE PAGAMENTO

| # | Item | Severidade | Arquivo |
|---|------|-----------|---------|
| 55 | **Race webhook+poller pode entregar 2x** — lock pessimista Redis por transactionId OU reordenar CAS-first. | ALTO | `payment.ts:102-264` |
| 56 | **Sem UNIQUE em (bot_id, external_id)** — transações duplicadas; `.single()` no timeout worker explode. | ALTO | migration |
| 57 | **Poseidon poller desligado** — se webhook falhar, cliente paga e nunca recebe. (depende de achar endpoint de status). | ALTO | `queue.ts:495` |
| 58 | **Sem dashboard de "pagou e não recebeu"** — view SQL de transações órfãs (approved sem delivered_tx). | ALTO | criar |
| 59 | **Email timeout pode entregar 2x** — atomizar limpeza do pending_email_tx_id. | MÉDIO | `queue.ts:259-299` |
| 60 | **Múltiplas transações sobrescrevem pending_email_tx_id** — perde entrega. Array ou tabela. | MÉDIO | `payment.ts:232-258` |
| 61 | **Sem timeout no executeFlow** — flow com loop trava após pagamento. | MÉDIO | `purchase-completer.ts:213` |
| 62 | **Refund não revoga acesso** — cliente reembolsado mantém produto. | MÉDIO | `payment.ts:150-164` |

---

## ACHADOS REFUTADOS NA VERIFICAÇÃO (não fazer — eram falsos positivos)

- "fire-and-forget não é fire-and-forget" — está correto, resposta HTTP já foi enviada antes.
- "findOrCreateLead faz UPDATE sempre" — já tem guard que pula se tid igual.
- "CAPI retry bloqueia 'Gerando Pix'" — CAPI só dispara no Purchase (async), não no clique.
- "fan-out nodes paralelos" — arquitetura é sequencial por design, não há multi-edge.
- "47 componentes use client desnecessário" — a maioria tem hooks reais que justificam.
- "fallback de conta causa cascata" — só tenta 2 contas, não cascateia.

---

## RESUMO DO IMPACTO ESPERADO

- **EMQ:** 7 → 8.0-8.3 (sem Pixel browser) ou 8.5-9.0 (com Pixel browser, decisão de amanhã).
- **Campanhas FB não banirem:** combinação de #2 (eventos completos), #6 (dedup), #7-9 (qualidade user_data) reduz o "low quality event" que está triggando o ban.
- **Tempo de resposta do bot:** #25+#26 sozinhos cortam ~3s do /start. #27-31 reduzem latência por mensagem em 100-400ms.
- **Segurança:** fecha o buraco de fraude (#15/#16) — hoje qualquer um pode forjar pagamento aprovado.
- **Estabilidade:** #45/#46/#56 evitam OOM, vazamento e duplicação sob carga.
