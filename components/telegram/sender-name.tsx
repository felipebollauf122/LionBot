/**
 * Nome do remetente no topo da primeira bolha do grupo.
 *
 * A cor sai de um hash do nome, como no Telegram: o mesmo nome recebe sempre a
 * mesma cor, em qualquer sessão. Cor aleatória por render entregaria o truque
 * na primeira vez que o lead reabrisse o Mini App.
 *
 * As sete cores em si moram no theme.css (--tgc-peer-0..6), porque o Telegram
 * usa uma paleta no tema claro e outra, mais clara, no escuro.
 */

export const PEER_COLOR_COUNT = 7;

/** Hash djb2 do nome → índice de cor. Determinístico e estável. */
export function peerColorIndex(name: string): number {
  const s = name.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PEER_COLOR_COUNT;
}

export function SenderName({ name }: { name: string }) {
  return (
    <div className="tg-sender" style={{ color: `var(--tgc-peer-${peerColorIndex(name)})` }}>
      {name}
    </div>
  );
}
