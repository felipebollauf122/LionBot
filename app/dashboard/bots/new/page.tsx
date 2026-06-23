import Link from "next/link";
import { CreateBotForm } from "@/components/dashboard/create-bot-form";
import { isOwner } from "@/lib/actions/owner-actions";

export default async function NewBotPage() {
  const owner = await isOwner();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-lg mx-auto w-full">
      {/* Voltar */}
      <Link
        href="/dashboard/bots"
        className="inline-flex items-center gap-2 text-(--text-muted) hover:text-foreground text-sm transition-all mb-6 group animate-up"
      >
        <div className="w-7 h-7 rounded-lg bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </div>
        Voltar
      </Link>

      {/* Cabeçalho */}
      <div className="mb-8 animate-up-1">
        <h1 className="text-2xl font-bold text-foreground tracking-tight page-title mb-1.5">
          Novo Bot
        </h1>
        <p className="text-(--text-secondary) text-sm">
          Conecte um bot do Telegram para começar a automatizar vendas
        </p>
      </div>

      <CreateBotForm isOwner={owner} />
    </div>
  );
}
