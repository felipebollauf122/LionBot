export default function EditorLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-(--accent)/30 border-t-(--accent) animate-spin" />
        <p className="text-(--text-muted) text-sm">Carregando editor de fluxo…</p>
      </div>
    </div>
  );
}
