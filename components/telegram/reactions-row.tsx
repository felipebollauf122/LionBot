import type { Reaction } from "@/lib/social-proof/types";

/**
 * Pílulas de reação sob o conteúdo da bolha: 26px de altura, emoji de 18px e
 * contador em azul, como no Android; o iOS usa a mesma forma.
 *
 * Reação com contador zero é descartada: no Telegram uma reação só existe
 * enquanto alguém a mantém, e um "🔥 0" denuncia que os números são inventados.
 */
export function ReactionsRow({ reactions }: { reactions: Reaction[] }) {
  const visiveis = reactions.filter((r) => r.count > 0);
  if (visiveis.length === 0) return null;

  return (
    <div className="tg-reactions">
      {visiveis.map((r) => (
        <span key={r.emoji} className="tg-reaction">
          <span className="tg-reaction__emoji">{r.emoji}</span>
          <span>{r.count}</span>
        </span>
      ))}
    </div>
  );
}
