"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveChannelTemplate,
  deleteChannelTemplate,
  addChannelMonitor,
  pauseChannelMonitor,
  deleteChannelMonitor,
  uploadTemplateMedia,
  listMonitorableDialogs,
} from "@/app/dashboard/automations/channel-monitors/actions";

type Tab = "templates" | "monitors";

interface MediaItem {
  url: string;
  kind: "photo" | "video";
  caption?: string;
  mime_type?: string;
  file_name?: string;
}

interface Template {
  id: string;
  name: string;
  new_channel_title: string;
  new_channel_about: string;
  welcome_text: string;
  media_items: MediaItem[];
}

interface Monitor {
  id: string;
  status: string;
  channel_title: string | null;
  channel_username: string | null;
  peer_channel_id: string;
  last_checked_at: string | null;
  last_check_error: string | null;
  replacement_invite_link: string | null;
  replacement_channel_id: string | null;
  replaced_at: string | null;
  account: { id: string; phone_number: string; display_name: string | null; status: string } | null;
  template: { id: string; name: string; new_channel_title: string } | null;
}

interface Account {
  id: string;
  display_name: string | null;
  phone_number: string;
}

interface Dialog {
  id: string;
  peer_id: string;
  peer_access_hash: string | null;
  title: string | null;
  username: string | null;
  kind: string;
}

export function ChannelMonitorsPanel({
  initialTemplates,
  initialMonitors,
  accounts,
}: {
  initialTemplates: Template[];
  initialMonitors: Monitor[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("templates");
  const [templates, setTemplates] = useState(initialTemplates);
  const [monitors, setMonitors] = useState(initialMonitors);
  const [editingTpl, setEditingTpl] = useState<Template | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <div className="flex gap-1 border-b border-white/10 mb-6">
        <button
          onClick={() => setTab("templates")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "templates" ? "border-(--accent) text-white" : "border-transparent text-white/50 hover:text-white"}`}
        >
          Templates ({templates.length})
        </button>
        <button
          onClick={() => setTab("monitors")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "monitors" ? "border-(--accent) text-white" : "border-transparent text-white/50 hover:text-white"}`}
        >
          Canais monitorados ({monitors.length})
        </button>
      </div>

      {tab === "templates" && (
        <div className="space-y-4">
          {editingTpl ? (
            <TemplateForm
              initial={editingTpl}
              onCancel={() => setEditingTpl(null)}
              onSaved={(saved) => {
                setTemplates((prev) => {
                  const idx = prev.findIndex((t) => t.id === saved.id);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = saved;
                    return copy;
                  }
                  return [saved, ...prev];
                });
                setEditingTpl(null);
              }}
            />
          ) : (
            <>
              <button
                onClick={() =>
                  setEditingTpl({
                    id: "",
                    name: "",
                    new_channel_title: "",
                    new_channel_about: "",
                    welcome_text: "",
                    media_items: [],
                  })
                }
                className="btn-primary"
              >
                + Novo template
              </button>

              {templates.length === 0 ? (
                <p className="text-white/40 text-sm">
                  Nenhum template ainda. Crie um pra ele ser usado quando precisar substituir um canal.
                </p>
              ) : (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="p-4 rounded-lg border border-white/10 bg-white/[0.02] flex items-center justify-between"
                    >
                      <div>
                        <div className="text-white font-medium">{t.name || "Sem nome"}</div>
                        <div className="text-white/40 text-xs mt-1">
                          Vai criar canal: <span className="text-white/70">{t.new_channel_title}</span> ·{" "}
                          {t.media_items?.length ?? 0} mídia(s)
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingTpl(t)}
                          className="text-(--accent) hover:underline text-xs"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm(`Excluir template "${t.name}"?`)) return;
                            startTransition(async () => {
                              await deleteChannelTemplate(t.id);
                              setTemplates((p) => p.filter((x) => x.id !== t.id));
                            });
                          }}
                          className="text-red-400 hover:underline text-xs"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "monitors" && (
        <MonitorsTab
          monitors={monitors}
          accounts={accounts}
          templates={templates}
          onChanged={() => router.refresh()}
          setMonitors={setMonitors}
          pending={pending}
          startTransition={startTransition}
        />
      )}
    </div>
  );
}

function TemplateForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Template;
  onCancel: () => void;
  onSaved: (t: Template) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [title, setTitle] = useState(initial.new_channel_title);
  const [about, setAbout] = useState(initial.new_channel_about);
  const [welcome, setWelcome] = useState(initial.welcome_text);
  const [media, setMedia] = useState<MediaItem[]>(initial.media_items ?? []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadTemplateMedia(fd);
      setMedia((prev) => [...prev, r]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro upload");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border border-white/10 rounded-lg p-5 bg-white/[0.02] space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/70 text-xs block mb-1">Nome interno do template</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Vazados V2"
            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white text-sm"
          />
        </div>
        <div>
          <label className="text-white/70 text-xs block mb-1">Título do canal novo</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: 🔥 Vazados HOT 🔥"
            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-white/70 text-xs block mb-1">Descrição do canal (about)</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white text-sm"
        />
      </div>
      <div>
        <label className="text-white/70 text-xs block mb-1">Mensagem inicial (welcome HTML)</label>
        <textarea
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          rows={4}
          placeholder="Bem-vindo ao novo canal! Aproveite o conteúdo..."
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white text-sm"
        />
      </div>

      <div>
        <label className="text-white/70 text-xs block mb-2">Mídias ({media.length})</label>
        <input
          type="file"
          accept="image/*,video/*"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
          className="text-white/70 text-xs"
        />
        {uploading && <p className="text-white/50 text-xs mt-2">Enviando...</p>}
        {media.length > 0 && (
          <ul className="mt-3 space-y-1">
            {media.map((m, i) => (
              <li key={i} className="flex items-center justify-between p-2 bg-black/20 rounded text-xs">
                <span className="text-white/80 truncate">
                  {m.kind === "photo" ? "📷" : "🎥"} {m.file_name ?? m.url}
                </span>
                <button
                  onClick={() => setMedia((p) => p.filter((_, idx) => idx !== i))}
                  className="text-red-400 hover:underline"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={async () => {
            if (!title.trim()) {
              setError("Título do canal é obrigatório");
              return;
            }
            setSaving(true);
            setError(null);
            try {
              const r = await saveChannelTemplate({
                id: initial.id || undefined,
                name,
                new_channel_title: title,
                new_channel_about: about,
                welcome_text: welcome,
                media_items: media,
              });
              onSaved({
                id: r.id,
                name,
                new_channel_title: title,
                new_channel_about: about,
                welcome_text: welcome,
                media_items: media,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : "erro");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Salvando..." : "Salvar template"}
        </button>
        <button onClick={onCancel} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function MonitorsTab({
  monitors,
  accounts,
  templates,
  setMonitors,
  pending,
  startTransition,
}: {
  monitors: Monitor[];
  accounts: Account[];
  templates: Template[];
  onChanged: () => void;
  setMonitors: React.Dispatch<React.SetStateAction<Monitor[]>>;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {adding ? (
        <AddMonitorForm
          accounts={accounts}
          templates={templates}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            window.location.reload();
          }}
        />
      ) : (
        <button onClick={() => setAdding(true)} className="btn-primary" disabled={templates.length === 0}>
          + Monitorar canal
        </button>
      )}

      {templates.length === 0 && (
        <p className="text-amber-300 text-xs">
          ⚠️ Crie um template antes de adicionar um canal pra monitorar.
        </p>
      )}

      {monitors.length === 0 ? (
        <p className="text-white/40 text-sm">Nenhum canal sendo monitorado.</p>
      ) : (
        <div className="space-y-2">
          {monitors.map((m) => (
            <div key={m.id} className="p-4 rounded-lg border border-white/10 bg-white/[0.02]">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium truncate">
                      {m.channel_title || `canal ${m.peer_channel_id}`}
                    </span>
                    {m.channel_username && (
                      <span className="text-white/40 text-xs">@{m.channel_username}</span>
                    )}
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="text-white/40 text-xs mt-1">
                    Conta dona: {m.account?.display_name || m.account?.phone_number || "—"} ·
                    Template: {m.template?.name || "—"}
                    {m.last_checked_at && (
                      <> · Último check: {new Date(m.last_checked_at).toLocaleString("pt-BR")}</>
                    )}
                  </div>
                  {m.last_check_error && (
                    <div className="text-red-400 text-xs mt-1">⚠ {m.last_check_error}</div>
                  )}
                  {m.replacement_invite_link && (
                    <div className="text-(--accent) text-xs mt-2 break-all">
                      ✅ Substituído em {new Date(m.replaced_at!).toLocaleString("pt-BR")}:{" "}
                      <a
                        href={m.replacement_invite_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {m.replacement_invite_link}
                      </a>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {(m.status === "active" || m.status === "paused") && (
                    <button
                      onClick={() => {
                        startTransition(async () => {
                          const paused = m.status === "active";
                          await pauseChannelMonitor(m.id, paused);
                          setMonitors((p) =>
                            p.map((x) => (x.id === m.id ? { ...x, status: paused ? "paused" : "active" } : x)),
                          );
                        });
                      }}
                      className="text-white/60 hover:text-white text-xs"
                      disabled={pending}
                    >
                      {m.status === "active" ? "Pausar" : "Retomar"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!confirm("Remover este monitor?")) return;
                      startTransition(async () => {
                        await deleteChannelMonitor(m.id);
                        setMonitors((p) => p.filter((x) => x.id !== m.id));
                      });
                    }}
                    className="text-red-400 hover:underline text-xs"
                    disabled={pending}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    active: { text: "ativo", cls: "bg-(--cyan)/20 text-(--cyan)" },
    paused: { text: "pausado", cls: "bg-amber-500/20 text-amber-300" },
    replaced: { text: "substituído", cls: "bg-(--accent)/20 text-(--accent)" },
    dead: { text: "morto", cls: "bg-red-500/20 text-red-300" },
  };
  const s = map[status] ?? { text: status, cls: "bg-white/10 text-white/70" };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${s.cls}`}>{s.text}</span>;
}

function AddMonitorForm({
  accounts,
  templates,
  onCancel,
  onAdded,
}: {
  accounts: Account[];
  templates: Template[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [selectedDialogId, setSelectedDialogId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDialogs(accId: string) {
    setLoading(true);
    setError(null);
    try {
      const ds = await listMonitorableDialogs(accId);
      setDialogs(ds);
      if (ds.length > 0) setSelectedDialogId(ds[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-white/10 rounded-lg p-5 bg-white/[0.02] space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/70 text-xs block mb-1">Conta dona do canal</label>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              loadDialogs(e.target.value);
            }}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-white text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name || a.phone_number}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-white/70 text-xs block mb-1">Template a usar quando cair</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-white text-sm"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || "(sem nome)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <button
          onClick={() => loadDialogs(accountId)}
          className="text-(--accent) hover:underline text-xs"
          disabled={loading}
        >
          {loading ? "Carregando canais..." : "Listar canais dessa conta"}
        </button>
      </div>

      {dialogs.length > 0 && (
        <div>
          <label className="text-white/70 text-xs block mb-1">Canal a monitorar</label>
          <select
            value={selectedDialogId}
            onChange={(e) => setSelectedDialogId(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-white text-sm"
          >
            {dialogs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.kind === "channel_owner" ? "👑 " : "👤 "}
                {d.title || d.peer_id}
                {d.username ? ` (@${d.username})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={async () => {
            const d = dialogs.find((x) => x.id === selectedDialogId);
            if (!d) {
              setError("Selecione um canal");
              return;
            }
            if (!templateId) {
              setError("Selecione um template");
              return;
            }
            setError(null);
            try {
              await addChannelMonitor({
                accountId,
                templateId,
                peerChannelId: d.peer_id,
                peerAccessHash: d.peer_access_hash,
                channelTitle: d.title,
                channelUsername: d.username,
              });
              onAdded();
            } catch (err) {
              setError(err instanceof Error ? err.message : "erro");
            }
          }}
          className="btn-primary"
          disabled={!selectedDialogId || !templateId}
        >
          Adicionar monitor
        </button>
        <button onClick={onCancel} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </div>
  );
}
