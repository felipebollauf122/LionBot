# Design — Clone cross-account (ler numa conta, criar em outra)

**Data:** 2026-07-24
**Status:** Aprovado
**Autor:** Dary + Claude
**Depende de:** `2026-07-23-telegram-channel-clone-design.md`

## Contexto

Hoje o clone usa **uma conta** MTProto pra tudo: a mesma conta lê a origem E cria o
destino + promove o bot. Problema real: a conta do owner ficou **`USER_RESTRICTED`** —
o Telegram limitou-a de **criar canais** (anti-spam). Ela ainda lê e baixa normalmente,
mas não cria destino, então todo clone falha em `channels.CreateChannel`.

Solução: separar **quem lê** de **quem cria**. A conta restrita lê a origem (que ela já
participa); uma conta diferente, não-restrita, cria o destino e promove o bot.

## Restrição técnica central (aceita)

O "encaminhamento em lote" (`messages.ForwardMessages`, a rota rápida) só funciona quando
a **mesma** conta está na origem e no destino — ela encaminha de um chat pro outro dentro
da própria sessão. Com contas diferentes, ninguém está nos dois lados. Portanto:
**clone cross-account é sempre pela rota download** (a conta de origem baixa, o bot
publica no destino). Mais lento, mas correto — e a conta restrita ainda baixa sem
problema. Mesma-conta continua podendo usar o lote rápido.

## Detecção de restrição (reativa)

Não existe chamada barata pra perguntar "estou restrito?" ao Telegram — `USER_RESTRICTED`
só aparece ao tentar criar canal. Então marcamos **reativamente**:
- Quando `createChannel` (no clone) falha com `USER_RESTRICTED`, grava
  `mtproto_accounts.create_restricted = true` na conta que tentou criar.
- Quando `createChannel` dá certo, grava `create_restricted = false` (auto-limpa).
- Conta recém-conectada nasce `false` (não-restrita até provar o contrário).
- O owner pode limpar manualmente pelo card da conta ("marcar como liberada"), pra quando
  resolver a restrição via @SpamBot.

## Schema — migration `051_clone_cross_account.sql`

```sql
alter table public.mtproto_accounts
  add column if not exists create_restricted boolean not null default false;

alter table public.clone_jobs
  add column if not exists dest_account_id uuid references public.mtproto_accounts(id);
-- null = criar o destino na mesma conta da origem (retrocompatível com jobs antigos)
```

## Componentes

**Formulário de clone** (`components/dashboard/clone-form.tsx` + `.../clones/new/page.tsx`).
Ganha um seletor **"Criar o destino na conta:"** listando só contas **ativas e
não-restritas** (`status='active' and create_restricted=false`). Default: a conta da
origem se ela estiver na lista; senão, a primeira conta elegível; se não houver nenhuma,
o form avisa "nenhuma conta pode criar canais — conecte uma conta não-restrita ou libere
uma no card da conta". A `new/page.tsx` (server) busca as contas elegíveis e o
`source_account_id` do dialog e passa pro form. A conta restrita **não** aparece na
lista (mas segue sendo a que lê a origem).

**Server Action** (`app/dashboard/automations/clones/actions.ts` → `createCloneJob`).
Recebe `destAccountId`. Valida: pertence ao tenant, `status='active'`,
`create_restricted=false`. Grava em `clone_jobs.dest_account_id`. Se `destAccountId`
for igual ao account da origem, pode gravar null ou o id — grava o id explícito (mais
claro no histórico).

**Motor** (`server/src/workers/clone-handler.ts`). Passa a montar **dois clients**:
- `sourceClient` = `new MtprotoClient(..., sourceAccount.session_string)` — usado pelo
  `SourceReader` (ler histórico, baixar mídia, `hasNoForwards`, ler identidade).
- `destClient` = a conta `dest_account_id` (ou a mesma da origem quando null) — usado
  por `ensureDestination` nos deps de criação: `createChannel`, `setAbout`, `setPhoto`,
  `promoteBot`, `exportInvite`.
Ambos conectados no começo e desconectados no `finally`. Quando `dest_account_id` é null
ou igual à origem, os dois apontam pra mesma conta (comportamento atual, um objeto só —
não abrir duas conexões à toa). O bot publica no destino como sempre (indiferente a qual
conta criou o canal).

**Estratégia** (`chooseStrategy` em `publish-router.ts`). Ganha input `crossAccount:
boolean`. Quando `true`, força `"download"` (forward impossível entre contas). O handler
calcula `crossAccount = destAccountId !== sourceAccountId` e passa.

**Flag de restrição** (`clone-handler.ts`). No `catch` do handler (ou em torno do
`ensureDestination`), se `extractUserRestricted(err)` (novo, detecta `USER_RESTRICTED`),
grava `create_restricted=true` na conta de destino e falha com mensagem clara
("A conta escolhida para criar o destino está restrita pelo Telegram — escolha outra").
Após um `createChannel` bem-sucedido, grava `create_restricted=false` nessa conta.

**Card da conta** (`components/dashboard/mtproto-accounts.tsx` + action). Conta com
`create_restricted=true` mostra selo **"restrita — não cria canais"** e botão **"marcar
como liberada"** que chama uma action `clearAccountRestriction(accountId)` (owner-only,
tenant-scoped) zerando o flag.

## Fluxo do job (cross-account)

```
1. Carrega job, sourceAccount (job.account_id), destAccount (job.dest_account_id ?? source), bot.
2. sourceClient conecta; destClient conecta (mesmo objeto se igual).
3. ensureDestination usa destClient: cria canal, copia identidade (foto vem do sourceClient
   via readIdentity, buffer é account-agnostic), promove o bot, exporta invite.
   - createChannel OK  -> create_restricted=false na destAccount.
   - createChannel USER_RESTRICTED -> create_restricted=true na destAccount + fail claro.
4. strategy = chooseStrategy({..., crossAccount: dest !== source}) -> download quando cross.
5. Loop: sourceClient baixa, bot publica. (igual ao atual, só a leitura muda de client)
6. finally: desconecta os dois clients.
```

## Tratamento de erro

`friendlyCloneError` (já existe, do branch de mensagens amigáveis) já traduz
`USER_RESTRICTED`. Ajuste: a mensagem cross-account deixa claro que é a conta **de
destino** que está restrita, e que basta escolher outra conta no seletor.

## Testes

- **`chooseStrategy`** (unit, já existe): novo caso `crossAccount:true` → `download`,
  inclusive quando `sourceHasNoForwards=false` e sem botões (a rota rápida seria escolhida
  se não fosse cross-account). Mutation-check no plano.
- **`extractUserRestricted`** (unit novo): reconhece `USER_RESTRICTED` numa RPCError e
  ignora outros erros — espelha o `extractWaitSeconds`.
- **Validação de `createCloneJob`** (sem teste unit — Supabase; coberto por tsc + E2E):
  recusa dest account inexistente / de outro tenant / restrita.
- **Handler / dois clients**: sem teste unit (orquestração sobre gramjs/Supabase),
  coberto por tsc e pelo E2E manual do owner.

## Fora de escopo

- Ler @SpamBot automaticamente pra detectar restrição (frágil; usamos detecção reativa).
- Mover a origem entre contas / adicionar a conta de destino ao canal de origem.
- Pool de contas de destino / balanceamento (uma conta por job; o seletor já permite
  escolher qual).

## Riscos aceitos

1. **Cross-account é sempre download** (mais lento). Inerente ao Telegram.
2. **Detecção reativa** significa que a primeira tentativa numa conta restrita ainda
   falha (é o que marca o flag). Aceitável — a partir daí ela some do seletor.
3. A conta de destino também precisa poder resolver e promover o bot (`@username`) —
   qualquer conta ativa consegue; se o bot tiver Group Privacy ligada, o erro
   `BOT_GROUPS_BLOCKED` já é tratado e traduzido.
