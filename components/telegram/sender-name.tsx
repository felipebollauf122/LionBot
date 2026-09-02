/**
 * Nome do remetente no topo da primeira bolha do grupo.
 *
 * A cor sai de um hash do nome, como no Telegram: o mesmo nome recebe sempre a
 * mesma cor, em qualquer sessão. Cor aleatória por render entregaria o truque
 * na primeira vez que o lead reabrisse o Mini App.
 */

/** As 7 cores de peer do Telegram, na ordem do app. */
const PEER_COLORS = [
  "#e17076", // vermelho
  "#eda86c", // laranja
  "#a695e7", // roxo
  "#7bc862", // verde
  "#6ec9cb", // ciano
  "#65aadd", // azul
  "#ee7aae", // rosa
];

/** Hash djb2 do nome → índice de cor. Determinístico e estável. */
export function peerColorIndex(name: string): number {
  const s = name.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PEER_COLORS.length;
}

export function SenderName({ name }: { name: string }) {
  return (
    <div
      style={{
        color: PEER_COLORS[peerColorIndex(name)],
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.2,
        marginBottom: 2,
      }}
    >
      {name}
    </div>
  );
}
