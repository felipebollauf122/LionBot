"use client";

export default function AutomationsError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-6xl px-4 py-12 md:px-8">
      <h1 className="text-xl font-semibold text-foreground">Não foi possível carregar esta tela</h1>
      <p className="mb-6 mt-2 text-sm text-(--text-secondary)">Tente carregar novamente para consultar seus dados.</p>
      <button className="btn-primary" onClick={reset}>Tentar novamente</button>
    </div>
  );
}
