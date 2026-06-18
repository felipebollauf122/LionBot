# Notificações de venda (Web Push) — passo-a-passo de deploy

O **código** está 100% pronto (front + server + migration). Faltam só 2 passos que
dependem de acessos seus: aplicar a migration no Supabase e configurar a chave
privada VAPID na VPS. Sem esses 2 passos, o app não quebra — o push só fica
silenciosamente desativado.

---

> Nota: além da migration de push (037), há a **038_transactions_sale_type.sql**
> (coluna `sale_type` pra classificar Upsell/Downsell/OrderBump nas Análises).
> Aplique as duas — o `supabase db push` aplica todas as pendentes de uma vez.
> A geolocalização por estado NÃO precisa de migration (usa o `event_data` JSONB
> que já existe; o estado é resolvido via ip-api.com no bot_start).

## 1. Aplicar a migration no Supabase (cria a tabela `push_subscriptions`)

A migration está em `supabase/migrations/037_push_subscriptions.sql`.

**Opção A — Supabase CLI (recomendado):**
```bash
supabase db push
```

**Opção B — manual (SQL Editor do painel Supabase):**
Abra o SQL Editor do projeto e cole/rode o conteúdo de
`supabase/migrations/037_push_subscriptions.sql`.

✔️ Como conferir: em Table Editor deve aparecer a tabela `push_subscriptions`
com as colunas `tenant_id, endpoint, p256dh, auth, user_agent, created_at` e RLS ativado.

---

## 2. Configurar as chaves VAPID na VPS (server `.env`)

O **front** já tem a chave pública (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` no `.env.local`):
```
BI0rE7AYmeZb9JEvUgXDdz78zXJkQoMe0AElMjfWKaAm5VgKWvUowokbDZgaT-OqOJ48PyHjxZh88HsUJLgnweQ
```

O **server** (na VPS) precisa do PAR dessa chave no `server/.env`:
```env
VAPID_PUBLIC_KEY=BI0rE7AYmeZb9JEvUgXDdz78zXJkQoMe0AElMjfWKaAm5VgKWvUowokbDZgaT-OqOJ48PyHjxZh88HsUJLgnweQ
VAPID_PRIVATE_KEY=<a chave privada que é o par da pública acima>
VAPID_SUBJECT=mailto:seu-email@seu-dominio.com
```

> ⚠️ A `VAPID_PRIVATE_KEY` é **segredo** — nunca commitar. Ela precisa ser
> exatamente o par da pública acima, senão o navegador rejeita as notificações.

### Se você não tem a privada à mão (ou quer regenerar — mais seguro):
Gere um par novo e troque NOS DOIS lados (front público + server privado):
```bash
cd server
npx web-push generate-vapid-keys
```
Isso imprime `Public Key` e `Private Key`. Então:
- `Public Key`  → `NEXT_PUBLIC_VAPID_PUBLIC_KEY` no `.env.local` do front **e**
  `VAPID_PUBLIC_KEY` no `.env` do server (têm que ser a MESMA).
- `Private Key` → `VAPID_PRIVATE_KEY` no `.env` do server.

> Se regenerar, as subscriptions antigas (de antes da troca) param de funcionar e
> os usuários precisam reativar o toggle — mas como o push ainda não estava ligado,
> não há subscription antiga pra perder. Regenerar agora é seguro.

---

## 3. Deploy do server

Na VPS, depois de setar o `.env`:
```bash
cd server
npm install        # instala a nova dep web-push
npm run build
# reinicie o processo do server (pm2 restart / systemctl restart / etc.)
```

---

## 4. Testar de ponta a ponta

1. **Ativar**: logado, vá em **Perfil → Notificações** e ative o toggle.
   O browser pede permissão → aceite. (Em iOS precisa instalar o PWA antes.)
   ✔️ Confira: deve aparecer 1 linha nova em `push_subscriptions` (com o seu `tenant_id`).
2. **Receber**: faça uma venda chegar a `approved` (ou simule um webhook de pagamento aprovado).
   ✔️ Deve chegar a notificação **"💰 Venda aprovada! R$ X · Produto (@bot)"** no dispositivo.
   Clicar nela abre `/dashboard`.
3. **Limpeza automática**: se uma subscription expirar, o server apaga ela sozinho
   (trata erros 404/410 no envio).

---

## O que já está pronto no código (não precisa mexer)

- **Front**: toggle (`components/dashboard/push-toggle.tsx`), service worker
  (`public/sw.js`), salvar/remover subscription (`lib/actions/push-actions.ts`).
- **Server**: serviço de envio (`server/src/services/push.ts`), disparo no webhook
  de pagamento aprovado (`server/src/webhook/payment.ts`), chaves no
  `server/src/config.ts`, dependência `web-push` no `server/package.json`.
- **Migration**: `supabase/migrations/037_push_subscriptions.sql`.
