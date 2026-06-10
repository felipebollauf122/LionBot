# LionBot — Repaginação Estrutural "Console"

**Data:** 2026-06-10
**Status:** Aprovado para implementação
**Origem:** o usuário quer a ESTRUTURA do app repaginada (não cor/fonte/texto, que já foram trocados). A arquitetura atual ainda lembra o EagleBot velho: 2 sidebars de 240px, `p-8 max-w-4xl`, header por tela, cards/tabelas empilhados, edição inline, clique=reload.

## 1. Objetivo

Repaginar o **esqueleto** de todo o app logado (telas internas de bot + shell) para a arquitetura **"Console"** — um workspace denso de operador (estilo Linear / terminal), claramente diferente da estrutura antiga. **Mesmos dados, mesmas funções, mesmas permissões** — só re-arranjados. Mantém a paleta synthwave e a camada de motion já existentes.

### Não-objetivos (YAGNI)
- Não tocar no `server/` nem em migrations.
- Não mudar tokens de cor/animação do `globals.css` (reusar os existentes; só ADICIONAR utilitários estruturais se preciso).
- Não reescrever a landing (já feita) nem as telas Dashboard/Análises (já no novo padrão).
- Não implementar ⌘K palette completa agora se inviável — pode ser um stub (busca local) na primeira leva; a CommandBar em si é obrigatória.

## 2. Conceito-guia

**"Console" = Command-Bar (topo) + Master-Detail + Context Drawer (direita), sobre um Rail de ícones (esquerda).**

```
┌───────────────────────────────────────────────────────────────┐
│ RAIL │  COMMAND BAR (sticky: título · busca · chips · KPIs · ação) │
│ 64px ├──────────────────────────────────────┬────────────────────┤
│ ícon │  MASTER (DataGrid denso / lista)      │  CONTEXT DRAWER     │
│ +glow│  ── linha ───────────────────────────  │  (detalhe+edição+   │
│      │  ── linha (selecionada) ◀─────────────│   ações) desliza ◀  │
└──────┴──────────────────────────────────────┴────────────────────┘
```

**4 princípios que mudam TODA tela:**
1. Fim do `p-8 max-w-4xl` → largura total, densidade.
2. Fim da edição inline que empurra a página → tudo vira **Context Drawer** (overlay deslizante).
3. Fim do header por tela → absorvido pela **Command Bar** única.
4. Seleção é o novo "navegar" → clicar linha popula o Drawer (deep-link `?sel=<id>`, sem reload).

## 3. Novo shell / navegação

A `BotSidebar` de 240px **vira `BotRail` de 64px**:
- Só ícones (reusa `item.color` + glow já existentes); label em tooltip no hover; rail expande pra ~220px no hover (overlay `transition-[width]`, não empurra).
- Avatar/@username + "Voltar" migram pro topo do rail.
- **Mobile:** rail vira **bottom-tab-bar** (5 ícones primários + "Mais") substituindo o hambúrguer do `BotShell`.

A sidebar global do dashboard (`DashboardShell`/`Sidebar`) permanece para o nível tenant (Meus Bots / Análises / Admin) — mas dentro de um bot, o **BotRail** é a navegação. (Decisão: não fundir os dois níveis agora; o foco é a estrutura interna do bot, que é o que o usuário apontou como "tudo igual".)

## 4. Componentes-base novos (em `components/dashboard/console/`)

Todos reusam tokens existentes (`.card-interactive`, `.row-hover`, `.glass`, `.num-pop`, `.badge-*`, `.btn-primary`, `.toggle-btn`, `--accent`/`--cyan`).

| Componente | Papel | Reusa |
|---|---|---|
| **`<CommandBar>`** | Faixa sticky no topo de cada tela. Slots: `title` (esq), `search`+`<FilterChip>`s (centro), `<KpiPill>`s + `primaryAction` (dir). Substitui todos os headers, os botões de filtro de Transações, os tab-switches de Tracking, o input de busca de Leads. | `.glass`, `.btn-primary`, `.toggle-btn` |
| **`<DataGrid>`** | Lista densa (rows ~36px), header sticky, `<RowGroup>` (Fluxos), `onRowClick→openDrawer`, coluna de status/ações, empty state. Scroll comum (virtual fica para depois). | `.table-header`, `.table-cell`, `.row-hover` |
| **`<MasterDetail>`** | Wrapper 2-painéis: `master` (grid/lista) + `detail` (Drawer overlay ou painel fixo). Controla seleção + sincroniza `?sel=<id>`. | layout flex |
| **`<ContextDrawer>`** | Painel deslizante à direita (overlay `.glass` + `--shadow-xl` + backdrop blur), header com título+ações, corpo com `<Tabs>` opcional. Onde toda edição inline antiga acontece. | `.glass`, `animate-in`, padrão do BotShell mobile |
| **`<KpiPill>`** | Número compacto pra CommandBar (label + valor). | `.stat-value`, `.num-pop` |
| **`<FilterChip>`** | Chip toggle de filtro. | `.toggle-btn` |

## 5. Transformação por tela

| Tela | DE | PARA |
|---|---|---|
| **Fluxos** | 3 blocos de cards `p-5` + 4 botões/card | DataGrid com RowGroup (Principal/Black/Outros): Nome·Trigger·Nós·Versão·Status. Linha→Drawer (metadados, export/edit/delete, "Abrir editor"). |
| **Produtos** | `space-y-3` cards + edição inline + seção Fantasma | DataGrid: Preço·Nome·Status·Descrição·(admin Fantasma). Edição no Drawer. CommandBar: busca + "Novo Produto". |
| **Conjuntos** | Accordion gigante (5 seções/bundle) | Master-Detail: lista compacta esq + detalhe direito com tabs (Detalhes·Produtos·Avançado). |
| **Leads** | Tabela 6-col flat + paginação | DataGrid (header sticky, scroll). Linha→Drawer (perfil: Telegram ID, UTMs, TID, timeline de eventos). Busca/UTM→chips. |
| **Transações + Órfãs** | 2 rotas separadas | UMA tela. KPIs (Receita/Aprovado/Pendente/Órfãs) na CommandBar. Filtros→chips. Chip "Órfãs" + banner "Reenviar a todos". Linha→Drawer (comprovante + reenviar). |
| **Remarketing** | Cards lineares + setas up/down | Timeline/flow vertical (exceção: sequência temporal é a essência). Toggle+intervalo→CommandBar. Editar nó→Drawer. |
| **Tracking** | Funil + tabs Leads/Eventos + 2 tabelas | Funil→KPIs clicáveis na CommandBar (etapa=filtro). Leads/Eventos→um DataGrid com chip de fonte. Linha→Drawer. |
| **Settings** | 7 seções `max-w-2xl` + Blacklist + Danger | Master-Detail de settings: rail interno (Geral·Integrações·Tracking·Blacklist·Avançado·Danger). Direita=form. Blacklist→DataGrid. Danger isolado. |

## 6. Ordem de implementação

1. **Componentes-base** (`console/`): CommandBar, KpiPill, FilterChip, DataGrid (+RowGroup), ContextDrawer, MasterDetail. Validar isolados (Storybook-like via uma rota de teste, ou só type/build).
2. **Shell:** BotRail (64px, hover-expand) + repaginar BotShell (mobile bottom-tabs).
3. **Telas operacionais (DataGrid+Drawer):** Leads → Produtos → Fluxos → Transações(unifica órfãs) → Tracking.
4. **Telas especiais:** Conjuntos (master-detail tabs) → Settings (master-detail) → Remarketing (timeline).
5. **Verificação + review + merge.**

Cada tela: preserva 100% das server actions/queries/permissões existentes — só troca a apresentação. Build/lint a cada bloco.

## 7. Riscos / decisões

- **Edição inline → Drawer:** as telas hoje têm muito `useState` de form inline (ex.: product-list, bundle-list). Migrar pro Drawer exige mover esse estado pro MasterDetail/Drawer. Preservar a lógica de submit (server actions) intacta.
- **Deep-link `?sel=`:** usar `useSearchParams`/`router` para abrir o drawer por URL sem reload (client-side).
- **`force-dynamic`:** páginas que leem searchParams já são dinâmicas; manter.
- **Admin views:** as telas têm variantes admin (`isAdmin`, `basePath`). O BotRail e as telas devem honrar `basePath` (já é prop da bot-sidebar).
- **Não quebrar o que já existe:** Dashboard/Análises já estão no padrão novo e NÃO usam BotRail (são nível tenant). Não regredir.

## 8. Critérios de aceite

- [ ] Nenhuma tela interna de bot usa mais o layout antigo (sidebar 240px de texto, `p-8 max-w-4xl`, header h1+botões, edição inline que empurra).
- [ ] BotRail de 64px com hover-expand; mobile = bottom-tabs.
- [ ] CommandBar em todas as telas internas; DataGrid nas listas; Drawer nas edições/detalhes.
- [ ] Transações e "Pagou-não-recebeu" unificadas.
- [ ] Todas as ações/dados/permissões funcionam igual (toggle, export, delete, reenviar, admin).
- [ ] `npm run build` limpo; lint sem novos erros; smoke 200.
- [ ] `server/` intacto; nenhuma migration.
