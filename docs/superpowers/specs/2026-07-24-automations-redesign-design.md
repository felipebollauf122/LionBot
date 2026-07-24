# Design — Redesign da página de Automações (premium/SaaS)

**Data:** 2026-07-24 · **Status:** Aprovado

## Problema

A página `/dashboard/automations` ficou pra trás do resto do dashboard: usa
`bg-white/[0.02]` (superfície quase invisível) e `text-white/50` cru sobre a
galáxia do fundo → texto ilegível, hierarquia fraca, cara de inacabado. Vai
virar feature paga; precisa parecer produto.

## Direção (aprovada)

**Reestilizar + reestruturar**, usando o design system synthwave que **já
existe** em `app/globals.css` — não inventar aesthetic novo, não mexer na
galáxia do dashboard (é a marca). O ganho de leitura vem de trocar as
superfícies transparentes pelos `.card` reais (fundo glass ~90% opaco).

## Cola do design system (classes reais, usar verbatim)

- **Superfícies:** `.card` (padrão), `.card-elevated`, `.card-glow` (destaque
  hero, tem borda-gradiente no topo), `.card-interactive` (hover com glow),
  `.glass`. Todas já têm fundo sólido + gradiente.
- **Badges de status:** `.badge` + um de: `.badge-active` (magenta),
  `.badge-info` (cyan), `.badge-pending` (âmbar), `.badge-error` (vermelho),
  `.badge-purple`, `.badge-inactive` (cinza).
- **Botões:** `.btn-primary` (CTA), `.btn-ghost` (secundário), `.btn-danger`.
- **Inputs:** `.input`, `select.input`, `.input-label`.
- **Texto (vars):** `--text-primary`, `--text-secondary`, `--text-muted`,
  `--text-ghost`. Sintaxe Tailwind do codebase: `text-(--text-secondary)`,
  `border-(--border-subtle)`, etc.
- **Animação:** `.reveal` / `.reveal-1..8` (fade-up escalonado por seção),
  `.row-hover` (linhas), `.section-icon`, `.status-dot`.
- **Progresso:** não há classe pronta — barra = `div` externo
  `bg-(--bg-input) rounded-full h-2` + `div` interno com
  `background: linear-gradient(90deg, var(--accent), var(--cyan))` e
  `width: <pct>%`.

## Estrutura da página (`app/dashboard/automations/page.tsx`)

1. **Header:** título "Automações" (`--text-primary`) + subtítulo
   (`--text-secondary`).
2. **Faixa de resumo:** grid de 4 tiles `.card` compactos, cada um com um
   número grande (`.stat-value`/`--text-primary`) + rótulo (`--text-muted`):
   *Contas ativas*, *Clones concluídos*, *Clones rodando*, *Bot* (badge
   `active`/`pending` conforme configurado). Derivado de `accounts` e `clones`
   já buscados na page.
3. **Duas colunas (grid, empilha no mobile):** *Contas conectadas* |
   *Bot companheiro*.
4. **Clonagem (herói):** título de seção + CTA, e a lista de clones com peso
   visual maior (ver clone-list).
5. **Campanhas** e **Monitoramento de canais:** restilizados, sem
   reestruturar.
6. Cada seção entra com `.reveal-N` escalonado.

## Componentes (restyle — NÃO tocar em lógica/handlers/dados)

- **`mtproto-accounts.tsx`:** cada conta = linha `.row-hover` dentro de um
  `.card`; status em `.badge` (active→`badge-active`; restrita→`badge-pending`
  com o selo "restrita" que já existe); ações (Mensagens, Sincronizar, Ver
  conteúdo) como `.btn-ghost` pequenos; Remover como `.btn-danger`. Preservar
  todo o fluxo de conectar conta (form/code/password) e o polling.
- **`automation-bot-card.tsx`:** `.card-glow` com avatar 🤖, `@username`
  (`--text-primary`), status/descrição (`--text-secondary`), "Trocar" como
  `.btn-ghost`. Estado sem-bot: card de setup com `.input` + `.btn-primary`.
- **`clone-list.tsx` (herói):** cada clone = `<a>` com `.card-interactive`;
  título do destino (`--text-primary`), "de <origem>" (`--text-muted`), badge
  de status mapeado (running/waiting_flood→`badge-info`, paused→`badge-pending`,
  completed→`badge-active`, failed→`badge-error`, draft→`badge-inactive`),
  barra de progresso inline (copied_count/total_seen), e o texto "N copiadas".
  Estado vazio bonito.
- **`mtproto-campaign-list.tsx`:** lista com `.card`/`.badge`/`.btn` no mesmo
  padrão.

## Fora de escopo

Lógica, dados, rotas, o fundo galáxia do dashboard, e as outras páginas. É
puramente visual/CSS nesta página e seus 4 componentes filhos.

## Verificação

Sem testes unitários (é apresentacional). `tsc --noEmit` limpo (fora dos 6
erros pré-existentes em `tests/lib/types.test.ts`), `eslint` escopado limpo, e
revisão visual do owner. Manter a convenção `bg-white/[0.02]`→`.card` etc.;
não deixar nenhum `text-white/50` cru sobre a galáxia.
