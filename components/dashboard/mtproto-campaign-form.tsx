"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { automationHref } from "@/lib/automations/navigation";
import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
import {
  createCampaign,
  launchCampaign,
  listAccountDialogs,
  listActiveAccounts,
} from "@/app/dashboard/automations/actions";

interface Account {
  id: string;
  display_name: string | null;
  phone_number: string;
}

interface Dialog {
  id: string;
  title: string | null;
  username: string | null;
  kind: string;
  peer_type: string;
  is_bot: boolean;
}

const KIND_LABELS: Record<string, string> = {
  contact: "Contato",
  dm: "Conversa direta",
  group_member: "Grupo (só membro)",
  group_admin: "Grupo (admin)",
  channel_subscriber: "Canal (inscrito)",
  channel_owner: "Canal (dono)",
  bot: "Bot",
  self: "Saved Messages",
};

const DEFAULT_KIND_FILTERS = new Set([
  "contact",
  "dm",
  "group_admin",
  "channel_owner",
]);

const ALL_FILTERABLE_KINDS = [
  "contact",
  "dm",
  "group_admin",
  "group_member",
  "channel_owner",
  "channel_subscriber",
];

export function MtprotoCampaignForm({ actingTenantId }: { actingTenantId?: string }) {
  // Navegação com outro ?view pode reutilizar o componente. O rascunho e seus
  // destinos pertencem a um usuário: a chave descarta todo o estado anterior.
  return <TenantCampaignForm key={actingTenantId ?? "mine"} actingTenantId={actingTenantId} />;
}

function TenantCampaignForm({ actingTenantId }: { actingTenantId?: string }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [targetsRaw, setTargetsRaw] = useState("");
  const [delayMin, setDelayMin] = useState(15);
  const [delayMax, setDelayMax] = useState(45);
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceSeconds, setRecurrenceSeconds] = useState(24 * 60 * 60);
  const [isGlobal, setIsGlobal] = useState(false);
  // Recorrência é guardada em segundos; a UI só decompõe em h/m/s pra editar.
  const recH = Math.floor(recurrenceSeconds / 3600);
  const recM = Math.floor((recurrenceSeconds % 3600) / 60);
  const recS = recurrenceSeconds % 60;
  const setRecPart = (part: "h" | "m" | "s", raw: string) => {
    const v = Math.max(0, parseInt(raw, 10) || 0);
    setRecurrenceSeconds(
      (part === "h" ? v : recH) * 3600 + (part === "m" ? v : recM) * 60 + (part === "s" ? v : recS),
    );
  };
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [kindFilters, setKindFilters] = useState<Set<string>>(
    new Set(DEFAULT_KIND_FILTERS),
  );
  const [search, setSearch] = useState("");
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [selectedDialogIds, setSelectedDialogIds] = useState<Set<string>>(new Set());
  const selectionVersion = useRef(0);

  useEffect(() => () => { selectionVersion.current += 1; }, []);

  useEffect(() => {
    let active = true;
    listActiveAccounts(actingTenantId)
      .then((accs) => {
        if (!active) return;
        setAccounts(accs);
        setSelectedAccountId(accs[0]?.id ?? "");
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar as contas do usuário selecionado.");
      });
    return () => { active = false; };
  }, [actingTenantId]);

  // Recarrega dialogs quando muda conta, filtros ou busca (debounced)
  useEffect(() => {
    if (!selectedAccountId) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingDialogs(true);
      try {
        const ds = await listAccountDialogs(selectedAccountId, {
          kinds: Array.from(kindFilters),
          search,
        }, actingTenantId);
        if (active) setDialogs(ds);
      } catch {
        if (active) setDialogs([]);
      } finally {
        if (active) setLoadingDialogs(false);
      }
    }, 300);
    // Cancelar apenas o timer não cancela uma consulta que já começou.
    return () => { active = false; clearTimeout(timer); };
  }, [selectedAccountId, kindFilters, search, actingTenantId]);

  function toggleKind(kind: string) {
    const next = new Set(kindFilters);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setKindFilters(next);
  }

  function toggleDialog(dialogId: string) {
    const next = new Set(selectedDialogIds);
    if (next.has(dialogId)) next.delete(dialogId);
    else next.add(dialogId);
    setSelectedDialogIds(next);
  }

  function selectAllVisible() {
    const next = new Set(selectedDialogIds);
    dialogs.forEach((d) => next.add(d.id));
    setSelectedDialogIds(next);
  }

  function clearSelection() {
    selectionVersion.current += 1;
    setSelectedDialogIds(new Set());
  }

  function submit(e: React.FormEvent, launch: boolean) {
    e.preventDefault();
    setError(null);
    if (delayMin > delayMax) {
      setError("Delay mínimo não pode ser maior que o máximo");
      return;
    }
    if (
      !isGlobal &&
      targetsRaw.trim().length === 0 &&
      selectedDialogIds.size === 0
    ) {
      setError("Cole uma lista de alvos OU selecione contatos/grupos abaixo OU ative o disparo global.");
      return;
    }
    if (recurrenceEnabled && recurrenceSeconds < 5) {
      setError("Recorrência: mínimo 5 segundos entre execuções.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await createCampaign({
          name,
          message,
          targetsRaw: isGlobal ? "" : targetsRaw,
          delayMin,
          delayMax,
          dialogIds: isGlobal ? [] : Array.from(selectedDialogIds),
          recurrenceSeconds: recurrenceEnabled ? recurrenceSeconds : null,
          global: isGlobal,
          actingTenantId,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (launch) {
          // Se a fila interna recusar, a campanha fica em rascunho: avisar
          // aqui é a única chance — a navegação abaixo esconderia a falha.
          const disparo = await launchCampaign(res.campaignId);
          if (!disparo.ok) {
            setError(disparo.error);
            return;
          }
        }
        router.push(automationHref(`/dashboard/automations/campaigns/${res.campaignId}`, actingTenantId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
      }
    });
  }

  // Calcula estimativa de duração de uma execução
  const totalSelected = selectedDialogIds.size + (targetsRaw.trim() ? targetsRaw.trim().split(/[\n,;]+/).filter(Boolean).length : 0);
  const avgDelaySec = (delayMin + delayMax) / 2;
  const estimatedSec = Math.max(0, (totalSelected - 1)) * avgDelaySec;
  const estimatedMin = Math.round(estimatedSec / 60);

  // Função pra selecionar todos os dialogs visíveis de um kind específico
  async function selectAllOfKind(kind: string) {
    if (!selectedAccountId) {
      setError("Selecione uma conta primeiro.");
      return;
    }
    const version = selectionVersion.current;
    try {
      const ds = await listAccountDialogs(selectedAccountId, { kinds: [kind] }, actingTenantId);
      if (version !== selectionVersion.current) return;
      setSelectedDialogIds((selected) => {
        const next = new Set(selected);
        ds.forEach((d) => next.add(d.id));
        return next;
      });
    } catch (err) {
      if (version === selectionVersion.current) setError(err instanceof Error ? err.message : "erro");
    }
  }

  return (
    <form className="space-y-4">
      <div>
        <label className="input-label">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
        />
      </div>
      <div>
        <label className="input-label">Mensagem</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={4}
          className="input resize-y"
        />
      </div>

      {/* Disparo global */}
      <div className="rounded-lg p-4 space-y-2 border border-(--amber)/30 bg-(--amber)/5">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isGlobal}
            onChange={(e) => setIsGlobal(e.target.checked)}
            className="accent-(--amber) mt-1"
          />
          <div>
            <div className="text-foreground text-sm font-medium">
              🌍 Disparo global — todas as contas, todos os contatos/DMs/grupos/canais meus
            </div>
            <div className="text-(--text-secondary) text-xs mt-1 leading-relaxed">
              Quando ativo, ignora a lista de alvos e a seleção manual. Cada conta MTProto
              conectada dispara a mesma mensagem pra <b>tudo onde a conta consegue mandar</b>:
              contatos, DMs, grupos (admin <i>ou</i> só participante) e canais onde a conta é
              dona/admin. <b>Não inclui</b> bots, Saved Messages nem canais onde a conta só
              assina (assinante não publica em canal). Grupo onde a conta está silenciada,
              banida ou sem permissão de escrever aparece como <b>pulado</b> na campanha, com o
              motivo, e não conta como falha.
              {" "}A base é <b>sincronizada automaticamente</b>: ao conectar a conta, antes de
              cada disparo global e em loop a cada 24h.
            </div>
            {isGlobal && (
              <div className="text-(--amber) text-xs mt-2 leading-relaxed">
                ⚠️ <b>Risco MUITO alto de ban:</b> incluir grupos/canais onde a conta só
                participa é o caminho mais rápido pra <code>PHONE_NUMBER_BANNED</code> —
                admins desses grupos denunciam por spam e o Telegram derruba a conta
                inteira. Recomendado: delays grandes (60-120s), começar com 1 conta
                pra testar, e só ativar recorrência depois de confirmar que a primeira
                execução não causou ban.
              </div>
            )}
          </div>
        </label>
      </div>

      {!isGlobal && (
        <>
          <div>
            <label className="input-label">
              Lista de alvos (opcional, um por linha — @username ou +telefone)
            </label>
            <textarea
              value={targetsRaw}
              onChange={(e) => setTargetsRaw(e.target.value)}
              rows={4}
              className="input font-mono resize-y"
              placeholder="@user1&#10;@user2&#10;+5511999998888"
            />
          </div>
        </>
      )}

      {/* Seletor de dialogs — escondido em disparo global */}
      {!isGlobal && (
      <div className="rounded-lg p-4 space-y-3 border border-(--border-subtle) bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-foreground text-sm font-medium">Selecionar do Telegram</h3>
            <p className="text-(--text-muted) text-xs">
              Contatos, conversas, grupos e canais sincronizados da conta MTProto.
            </p>
          </div>
          <div className="text-(--text-secondary) text-xs">
            {selectedDialogIds.size > 0 && (
              <span>
                {selectedDialogIds.size} selecionados
                {" · "}
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-(--text-muted) hover:text-(--red) transition-colors"
                >
                  limpar
                </button>
              </span>
            )}
          </div>
        </div>

        {accounts.length === 0 ? (
          <p className="text-(--text-muted) text-sm">
            Nenhuma conta ativa. <AutomationLink href="/dashboard/automations/accounts" className="underline">Conecte uma conta Telegram</AutomationLink> para começar.
          </p>
        ) : (
          <>
            <div>
              <label className="input-label">Conta</label>
              <select
                value={selectedAccountId}
                onChange={(e) => {
                  selectionVersion.current += 1;
                  setSelectedAccountId(e.target.value);
                  setDialogs([]);
                  setLoadingDialogs(true);
                  setSelectedDialogIds(new Set());
                }}
                className="input"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name || a.phone_number}
                  </option>
                ))}
              </select>
            </div>

            {/* Atalhos rápidos: marca todos de um kind sem precisar filtrar+selecionar manualmente */}
            <div className="flex flex-wrap gap-2 p-2 rounded bg-(--accent)/5 border border-(--accent)/20">
              <span className="text-(--accent) text-xs font-medium self-center mr-1">Atalhos:</span>
              <button
                type="button"
                onClick={() => selectAllOfKind("contact")}
                className="px-2 py-1 text-xs rounded bg-(--accent)/10 hover:bg-(--accent)/20 text-foreground transition-colors"
              >
                + Todos os contatos
              </button>
              <button
                type="button"
                onClick={() => selectAllOfKind("dm")}
                className="px-2 py-1 text-xs rounded bg-(--accent)/10 hover:bg-(--accent)/20 text-foreground transition-colors"
              >
                + Todas as DMs
              </button>
              <button
                type="button"
                onClick={() => selectAllOfKind("group_admin")}
                className="px-2 py-1 text-xs rounded bg-(--accent)/10 hover:bg-(--accent)/20 text-foreground transition-colors"
              >
                + Grupos que admin
              </button>
              <button
                type="button"
                onClick={() => selectAllOfKind("channel_owner")}
                className="px-2 py-1 text-xs rounded bg-(--accent)/10 hover:bg-(--accent)/20 text-foreground transition-colors"
              >
                + Canais meus
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="text-(--text-muted) text-xs self-center mr-1">Filtrar lista:</span>
              {ALL_FILTERABLE_KINDS.map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={kindFilters.has(k)}
                    onChange={() => toggleKind(k)}
                    className="accent-(--accent)"
                  />
                  <span className={k.includes("member") || k.includes("subscriber") ? "text-(--amber)" : "text-(--text-secondary)"}>
                    {KIND_LABELS[k] ?? k}
                  </span>
                </label>
              ))}
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              className="input"
            />

            <div className="rounded-lg max-h-64 overflow-y-auto border border-(--border-subtle) bg-white/[0.02]">
              {loadingDialogs ? (
                <p className="p-3 text-(--text-muted) text-xs">Carregando...</p>
              ) : dialogs.length === 0 ? (
                <p className="p-3 text-(--text-muted) text-xs">
                  Sem resultados. <AutomationLink href="/dashboard/automations/accounts" className="underline">Sincronize o conteúdo da conta</AutomationLink> e tente novamente.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="w-full text-left px-3 py-1.5 text-xs text-(--accent) hover:bg-white/[0.04] border-b border-(--border-subtle) transition-colors"
                  >
                    Selecionar todos os {dialogs.length} visíveis
                  </button>
                  {dialogs.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04] cursor-pointer text-xs transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDialogIds.has(d.id)}
                        onChange={() => toggleDialog(d.id)}
                        className="accent-(--accent)"
                      />
                      <span className="text-(--text-secondary) truncate flex-1">
                        {d.title || d.username || d.id}
                      </span>
                      <span className="text-(--text-ghost) text-xs">
                        {KIND_LABELS[d.kind] ?? d.kind}
                      </span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="input-label">Delay mín (s)</label>
          <input
            type="number"
            value={delayMin}
            onChange={(e) => setDelayMin(parseInt(e.target.value, 10) || 0)}
            className="input"
          />
        </div>
        <div className="flex-1">
          <label className="input-label">Delay máx (s)</label>
          <input
            type="number"
            value={delayMax}
            onChange={(e) => setDelayMax(parseInt(e.target.value, 10) || 0)}
            className="input"
          />
        </div>
      </div>

      {totalSelected > 0 && (
        <p className="text-(--text-muted) text-xs">
          Estimativa: <b className="text-foreground">{totalSelected}</b> alvo(s), delay médio{" "}
          <b className="text-foreground">{Math.round(avgDelaySec)}s</b> ={" "}
          <b className="text-foreground">~{estimatedMin} minuto(s)</b> por execução.
        </p>
      )}

      {/* Recurrence */}
      <div className="rounded-lg p-4 space-y-3 border border-(--border-subtle) bg-white/[0.02]">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={recurrenceEnabled}
            onChange={(e) => setRecurrenceEnabled(e.target.checked)}
            className="accent-(--accent) mt-1"
          />
          <div>
            <div className="text-foreground text-sm font-medium">Repetir automaticamente (loop)</div>
            <div className="text-(--text-muted) text-xs">
              Quando ativo, a campanha vira recorrente: a primeira execução acontece <b>imediatamente</b> ao salvar/disparar, e depois repete no intervalo abaixo (mínimo 5s).
              Os mesmos alvos recebem a mensagem em todo ciclo. Um ciclo só começa depois que o anterior termina — se o envio demorar mais que o intervalo, os ciclos saem em sequência, sem se sobrepor.
            </div>
          </div>
        </label>
          {recurrenceEnabled && (
            <div className="pl-6 flex flex-wrap items-center gap-4">
              <div>
                <label className="input-label">Horas</label>
                <input
                  type="number"
                  min={0}
                  value={recH}
                  onChange={(e) => setRecPart("h", e.target.value)}
                  className="input w-24"
                />
              </div>
              <div>
                <label className="input-label">Minutos</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={recM}
                  onChange={(e) => setRecPart("m", e.target.value)}
                  className="input w-24"
                />
              </div>
              <div>
                <label className="input-label">Segundos</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={recS}
                  onChange={(e) => setRecPart("s", e.target.value)}
                  className="input w-24"
                />
              </div>
              <span className="text-(--text-muted) text-xs self-end mb-2">
                Total: {recurrenceSeconds}s
                {recurrenceSeconds > 0 && recurrenceSeconds < 5 && (
                  <b className="text-(--red)"> — mínimo 5s</b>
                )}
              </span>
            </div>
          )}
      </div>
      {error && <p className="text-(--red) text-sm">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={(e) => submit(e, false)}
          disabled={pending}
          className="btn-ghost"
        >
          Salvar rascunho
        </button>
        <button
          onClick={(e) => submit(e, true)}
          disabled={pending}
          className="btn-primary"
        >
          Salvar e disparar
        </button>
      </div>
    </form>
  );
}
