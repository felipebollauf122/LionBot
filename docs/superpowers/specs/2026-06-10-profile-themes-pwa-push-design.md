# Meu Perfil + Temas + PWA + Push de Venda — Design

**Data:** 2026-06-10
**Status:** Aprovado para implementação
**Escopo:** front (worktree) + server (VPS) + 1 migration. O usuário autorizou mexer no backend para o push funcionar de verdade.

## 1. Objetivo

Três entregas conectadas:
1. **Aba "Meu Perfil"** (`/dashboard/profile`) — configurações do usuário, nível de personalização alto.
2. **Sistema de Temas** — trocar o tema muda TODA a paleta do site em tempo real; preferência persistida.
3. **PWA + Push real** — instalar o LionBot na tela inicial do iPhone (Safari) e receber **notificação de venda** no dispositivo quando uma venda é aprovada.

## 2. Frente A — Temas (100% front)

O `globals.css` já define a paleta via CSS vars (`--accent`, `--cyan`, `--purple`, `--bg-root`, etc.). Sistema de temas = trocar esses tokens por tema.

- **Mecanismo:** atributo `data-theme="synthwave|..."` no `<html>`. Cada tema sobrescreve as CSS vars num bloco `[data-theme="x"] { --accent: ...; ... }` no globals.css.
- **Temas iniciais (4-5):**
  - `synthwave` (atual: magenta/cyan/roxo, BG roxo-quase-preto) — default
  - `matrix` (verde-fosfórico + ciano, preto puro — neon terminal)
  - `inferno` (vermelho/laranja/âmbar, BG carvão)
  - `ice` (azul gelo/ciano/branco, BG azul-noite)
  - `light` (tema claro — BG claro, acentos saturados) *(opcional; mais trabalhoso por causa de contraste)*
- **Troca em tempo real:** componente client seta `document.documentElement.dataset.theme = x` + salva em `localStorage`. Um script inline no `layout.tsx` (antes do paint) lê o localStorage e aplica o `data-theme` pra evitar flash.
- **Persistência:** localStorage (sem backend). Opcional futuro: salvar no perfil do usuário (Supabase) — fora do escopo agora.
- **Preview:** na aba Perfil, cards de tema clicáveis que mostram um swatch das cores e aplicam ao clicar.

## 3. Frente B — Aba "Meu Perfil" (`/dashboard/profile`, front)

- Rota nova + item "Perfil" na sidebar (ou no rodapé da sidebar, perto do logout).
- Seções (master-detail leve ou stack):
  1. **Conta:** nome/email do usuário (lido do Supabase auth; read-only por ora), avatar opcional.
  2. **Aparência:** seletor de temas (grid de swatches), toggle de animações (respeita reduced-motion).
  3. **Notificações:** toggle "Ativar notificações push neste dispositivo" + estado (ativo/negado/não-suportado) + instrução de como instalar no iPhone.
- Estética Console (CommandBar + seções), synthwave.

## 4. Frente C — PWA (front)

Para instalar no iPhone (Safari → Compartilhar → "Adicionar à Tela de Início"):
- **`app/manifest.ts`** (Next 16 metadata route) ou `public/manifest.json`: name "LionBot", short_name, theme_color, background_color, display "standalone", start_url "/dashboard", ícones 192/512.
- **Ícones PWA:** gerar a partir do leão (192x192, 512x512, maskable). Reusar `app/icon.svg` como base; gerar PNGs (ou usar o ícone SVG + apple-touch-icon).
- **`apple-touch-icon`** + meta `apple-mobile-web-app-capable` (iOS exige).
- **Service worker** (`public/sw.js`): necessário para push. Registrado por um client component no layout. Lida com o evento `push` (mostra a notificação) e `notificationclick` (abre o app).

## 5. Frente D — Push real de venda (front + server + banco)

### Banco (migration nova — próximo número: 037)
`supabase/migrations/037_push_subscriptions.sql`:
```sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (tenant_id, endpoint)
);
-- RLS: tenant só vê/gerencia as próprias inscrições
alter table public.push_subscriptions enable row level security;
create policy "own subs" on public.push_subscriptions
  for all using (auth.uid() = tenant_id) with check (auth.uid() = tenant_id);
```

### Front
- O service worker se inscreve (`pushManager.subscribe`) com a **VAPID public key**.
- Server action `savePushSubscription(sub)` → grava em `push_subscriptions` (tenant = usuário logado).
- Toggle na aba Perfil pede permissão (`Notification.requestPermission`) e inscreve.
- iOS: push web SÓ funciona com o app **instalado na tela inicial** (standalone) e iOS 16.4+. A UI explica isso.

### Server (VPS) — disparo
- Dependência: `web-push` no `server/package.json`.
- Config: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:) no `server/.env` + `config.ts`.
- **Ponto de disparo:** `server/src/webhook/payment.ts`, logo após a venda virar `approved` (após a linha `if (newStatus !== "approved") return;`). Chamar `notifySale(tenant_id, { amount, product, bot })`:
  - lê todas as `push_subscriptions` do `tenant_id` (via supabase service role já existente em `db.ts`),
  - `webpush.sendNotification(sub, payload)` para cada uma,
  - remove subscriptions que retornarem 404/410 (expiradas).
- Payload: `{ title: "💰 Venda aprovada!", body: "R$ X · <produto>", url: "/dashboard" }`.
- Também plugar nos pollers (`evpay-poller`, `poseidonpay-poller`) se eles confirmam venda fora do webhook — OU centralizar a confirmação. (Verificar: se os pollers chamam o mesmo caminho do payment.ts, um disparo só basta.)

### Chaves VAPID (geradas)
- Pública (front, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`): `BI0rE7AYmeZb9JEvUgXDdz78zXJkQoMe0AElMjfWKaAm5VgKWvUowokbDZgaT-OqOJ48PyHjxZh88HsUJLgnweQ`
- Privada (server, `VAPID_PRIVATE_KEY`): `Lsofz8kyRKJLhbRlxUSr5eiSk0x2APpkx26NFMdVMsg`
- `VAPID_SUBJECT`: `mailto:` do owner.

## 6. Ordem de implementação

1. **Temas** (globals.css + ThemeProvider/switcher + script anti-flash).
2. **Aba Perfil** (rota + sidebar + seções Conta/Aparência/Notificações).
3. **PWA** (manifest + ícones + apple meta + service worker + registro).
4. **Migration** push_subscriptions.
5. **Front push** (subscribe + savePushSubscription action).
6. **Server push** (web-push dep + config + notifySale + plugar no payment.ts/pollers).
7. **Verificação** (build/lint; push end-to-end é testável só no dispositivo real instalado).

## 7. Riscos / decisões

- **iOS é chato com push:** só funciona com PWA instalado (standalone) + iOS 16.4+. Sem isso, o toggle mostra "instale na tela inicial primeiro". É limitação da Apple, não nossa.
- **Front na Vercel + SW:** o service worker precisa ser servido em HTTPS na raiz — Vercel serve `public/sw.js` em `/sw.js` ✅.
- **Server na VPS:** o disparo roda no server (VPS), não na Vercel. O `web-push` + VAPID privada vivem lá.
- **Migration:** precisa ser aplicada no Supabase do usuário (`supabase db push` ou manual). Documentar.
- **Múltiplos dispositivos:** um tenant pode ter N subscriptions (iPhone, desktop). Mandar pra todas.
- **Tema "light":** maior risco de contraste; se ficar ruim, entrego só os dark variants primeiro.
- **server/ + supabase/ ficam no repo principal**, não no worktree (o worktree é só front). Vou aplicar essas mudanças no repo principal e documentar o que vai pra VPS.

## 8. Critérios de aceite

- [ ] Trocar tema na aba Perfil muda a paleta do site inteiro, sem reload, sem flash ao recarregar.
- [ ] Aba "Meu Perfil" acessível pela sidebar com Conta/Aparência/Notificações.
- [ ] Manifest + ícones: dá pra "Adicionar à Tela de Início" no iPhone e abre standalone.
- [ ] Toggle de push pede permissão e inscreve; subscription salva no banco.
- [ ] Venda aprovada no server dispara push para os dispositivos do tenant (testado no dispositivo real).
- [ ] build/lint limpos no front; server compila; migration válida.
- [ ] Chaves VAPID entregues ao usuário para colar nos `.env`.
