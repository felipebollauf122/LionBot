# LionBot — Rebrand Completo do Front-end (Synthwave)

**Data:** 2026-06-09
**Status:** Aprovado para implementação
**Escopo:** Front-end inteiro. Back-end/server **NÃO muda** — nenhuma função, rota, schema ou comportamento é alterado.

---

## 1. Objetivo

Reformular **100% do front-end** do produto: trocar nome, logo, layout, cores e paleta. Nada deve lembrar o visual antigo ("EagleBot", verde esmeralda, indigo). O resultado deve ser **cyberpunk synthwave** — moderno, sofisticado, técnico, profissional. Toda a lógica de negócio (server, server actions, Supabase, gateways de pagamento, MTProto, tracking) permanece intacta.

### Não-objetivos (YAGNI)
- Não mexer em `server/`, server actions, rotas de API, schema do banco, ou qualquer lógica.
- Não adicionar dependências novas pesadas (sem libs de animação tipo framer-motion) — CSS puro + Tailwind v4.
- Não trocar a stack (Next 16 / React 19 / Tailwind v4 / @xyflow continuam).
- Não reescrever testes de lógica.

---

## 2. Identidade nova

| Item | Antigo | Novo |
|---|---|---|
| **Nome** | EagleBot / Eaglebot | **LionBot** |
| **Símbolo** | águia (SVG triangular) | **leão geométrico/neon** (linhas tipo circuito, juba como raios) |
| **Vibe** | dark verde-SaaS / landing indigo | **Synthwave — Blade Runner / Tron** |
| **Tom** | "piloto automático" amigável | técnico, sofisticado, "máquina de vendas" |

### Paleta (substitui esmeralda + indigo + cyan antigos)

```
--bg-root      #07040d   (roxo-quase-preto, mais escuro que surface)
--bg-surface   #0a0612
--bg-elevated  #100a1a
--bg-overlay   #160e24

--magenta      #ff2bd6   ← acento primário (era esmeralda #10b981)
--magenta-hover#ff5ce0
--cyan         #00e5ff   ← acento secundário
--purple       #b14bff   ← acento terciário / roxo elétrico
--amber        #ffb800   (warning — mantém função, novo tom)
--red          #ff3b6b   (erro — rosa-vermelho neon, combina com synthwave)

--text-primary   #f3eaff  (branco levemente lilás)
--text-secondary rgba(243,234,255,0.56)
--text-muted     rgba(243,234,255,0.30)
```

**Glow duplo** é a assinatura: elementos importantes brilham magenta + cyan simultaneamente (sombras sobrepostas). Aberração cromática sutil em títulos (offset magenta/cyan). Grid em perspectiva no fundo (synthwave horizon).

### Tipografia
- **Títulos/display:** trocar Sora por uma grotesk *wide/geométrica*. Usar **`Orbitron`** ou **`Chakra Petch`** (tech, synthwave) via `next/font/google` para títulos. → **Decisão: `Chakra Petch`** (mais legível que Orbitron em texto, mantém ar técnico).
- **Corpo/UI:** grotesk neutra legível — **`Space Grotesk`** (substitui Sora no sans).
- **Dados/stats/mono:** manter monoespaçada, trocar JetBrains por **`Space Mono`** ou manter JetBrains. → **Decisão: manter `JetBrains Mono`** (excelente para números; não é "marca" reconhecível do tema antigo).

> Resumo fontes: `Chakra Petch` (display) · `Space Grotesk` (sans/UI) · `JetBrains Mono` (dados).

---

## 3. Arquitetura da mudança

O front-end tem **dois sistemas visuais separados** hoje:

### A) O App (dashboard, auth, flow builder) — usa o **design system global**
Quase todos os componentes em `app/dashboard/**`, `app/(auth)/**`, `components/dashboard/**`, `components/auth/**` consomem classes definidas em `app/globals.css`: `.card`, `.card-elevated`, `.card-glow`, `.glass`, `.input`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.badge-*`, `.nav-item`, `.table-*`, `.gradient-text`, `.status-dot`, etc.

**→ Reescrever `app/globals.css` reformula o app inteiro de uma vez.** Esta é a alavanca principal. Trocamos os tokens (`--accent` → magenta, BG → roxo) e ajustamos os componentes-base para a estética synthwave (glow duplo, cantos com chanfro opcional, grid). Toda tela que usa as classes herda o visual novo automaticamente.

Depois, uma passada de **refino tela-a-tela** para corrigir o que estiver com cor hardcoded fora do design system (ex.: um `text-emerald-400` solto, um `bg-[#050508]` literal). Estratégia: buscar por tokens antigos no código (`emerald`, `#10b981`, `#050508`, `indigo`, `cyan-400`, etc.) e substituir.

### B) A Landing (`components/landing/*` + `app/page.tsx`) — **hardcoded, sistema próprio**
Não usa as classes globais. Usa Tailwind hardcoded (`bg-indigo-600`, `text-cyan-400`, `#030508`) e fontes próprias (`var(--font-syne)`). É um sistema visual independente.

**→ A landing é refeita componente-a-componente.** Cada seção (Hero, Features, FAQ, Testimonials, HowItWorks, PainSection, FinalCTA, Footer, Navbar) é reescrita com a paleta synthwave, o leão neon e as fontes novas. Aqui há mais liberdade criativa — é a vitrine.

### Camada de fontes
`app/layout.tsx` (do app) e `app/(landing)/layout` carregam fontes via `next/font/google`. Trocar Sora→Space Grotesk + Chakra Petch; remover Syne da landing e alinhar tudo no mesmo conjunto. Atualizar `metadata.title/description` (EagleBot → LionBot). Atualizar `<html>` e variáveis CSS `--font-*`.

### Assets
- `public/logo.png` (logo da águia, 206 KB) → substituir por logo do leão. Como não gero PNG aqui, o símbolo principal será **SVG inline** (componente `<LionMark />`) usado no navbar, sidebar, auth e favicon. O `logo.png` é referenciado? Verificar usos antes de remover; se referenciado, gerar um SVG equivalente e/ou nota para o usuário trocar o PNG.
- `app/favicon.ico` → idealmente trocar; se não der pra gerar .ico, deixar nota.

---

## 4. Componentes-chave do design system novo (em `globals.css`)

| Classe | Mudança synthwave |
|---|---|
| `body` / `--bg-root` | fundo roxo-quase-preto + grid em perspectiva opcional via util |
| `.card` | borda sutil lilás, hover com **glow duplo magenta+cyan**, linha de topo neon |
| `.card-glow` | glow magenta forte (era esmeralda) |
| `.btn-primary` | gradiente magenta→roxo, texto claro, sombra glow magenta+cyan, brilho diagonal |
| `.btn-ghost` | borda lilás translúcida, hover cyan |
| `.badge-active` | magenta; `.badge-info` cyan; `.badge-purple` roxo; `.badge-pending` âmbar; `.badge-error` rosa-neon |
| `.nav-item.active` | barra lateral + texto magenta, glow |
| `.gradient-text` | magenta→cyan (era esmeralda→cyan) |
| `.input:focus` | ring magenta + glow |
| `.status-dot.active` | magenta pulsante |
| `.grid-lines` / novo `.synthwave-grid` | grid em perspectiva (horizonte) para heros/fundos |
| novo `.chromatic` | aberração cromática sutil em títulos |
| novo `.scanlines` | overlay de scanlines opcional |

Mantém a **mesma API de classes** → zero quebra estrutural; só muda a aparência.

---

## 5. Ordem de implementação

1. **Fontes + metadata + layout** — trocar fontes em `app/layout.tsx`, atualizar título/descrição, variáveis `--font-*`.
2. **`globals.css`** — reescrever tokens (paleta synthwave) e componentes-base. ⟵ *reformula o app inteiro de uma vez.*
3. **`<LionMark />`** — criar o símbolo SVG do leão neon (componente reutilizável) + favicon.
4. **Varredura de cores hardcoded no app** — substituir `emerald/#10b981/#050508/indigo` soltos por tokens novos, em `components/dashboard/**`, `components/auth/**`, `app/dashboard/**`, `app/(auth)/**`.
5. **Flow builder** — nós (`components/dashboard/flow-builder/nodes/*`), paleta, painel de config: aplicar paleta synthwave (cada tipo de nó com sua cor neon).
6. **Landing** — refazer cada componente em `components/landing/*` + `app/page.tsx`: Navbar (com LionMark), Hero (leão + grid perspectiva + headline nova), Features, HowItWorks, Pain, Testimonials, FAQ, FinalCTA, Footer.
7. **Verificação** — `npm run build` + `npm run lint` passam; revisão visual; grep final garantindo que não sobrou "Eaglebot"/"EagleBot"/esmeralda/indigo no front.

---

## 6. Estratégia de teste / verificação

- **Build:** `npm run build` deve compilar sem erro (TypeScript + Next).
- **Lint:** `npm run lint` limpo.
- **Testes existentes:** `npm test` continua passando (são de lógica; não devem ser afetados — se algum testar texto "Eaglebot" no front, atualizar a string esperada).
- **Grep de regressão:** após terminar, `rg -i "eaglebot|emerald|#10b981|indigo-|#050508|var\(--font-sora\)|var\(--font-syne\)"` no front-end deve voltar vazio (ou só com ocorrências justificadas).
- **Verificação visual:** rodar `npm run dev` e conferir landing, login, dashboard, uma tela de tabela e o flow editor.

---

## 7. Riscos / pontos de atenção

- **AGENTS.md avisa:** "This is NOT the Next.js you know" — ler `node_modules/next/dist/docs/` antes de mexer em `layout.tsx`/`next/font` se houver dúvida de API.
- **Cores hardcoded fora do design system** podem escapar da varredura — por isso o grep de regressão é obrigatório.
- **`logo.png` e `favicon.ico`** são binários; substituição real do PNG pode exigir ação do usuário (gerar a arte). Plano: usar SVG inline como fonte da verdade do símbolo e sinalizar o PNG/ICO ao usuário.
- **Flow builder (@xyflow)** tem estilos próprios da lib + estilos custom dos nós; conferir que as cores dos handles/edges também migram.
- **Contraste/acessibilidade:** magenta/cyan sobre fundo escuro pode ter contraste baixo em textos pequenos — garantir `--text-primary` com contraste suficiente; cores neon só em acentos, não em corpo de texto longo.

---

## 8. Critérios de aceite

- [ ] Nenhuma ocorrência de "Eaglebot/EagleBot" visível no front (título, navbar, footer, metadata).
- [ ] Logo = leão neon (SVG) em navbar, sidebar, auth.
- [ ] Paleta synthwave (magenta/cyan/roxo) aplicada em app + landing; zero verde-esmeralda/indigo remanescente.
- [ ] Fontes novas (Chakra Petch / Space Grotesk) carregando.
- [ ] `npm run build` e `npm run lint` passam; testes de lógica intactos.
- [ ] Back-end/server **inalterado** (nenhum arquivo em `server/` ou server action tocado).
