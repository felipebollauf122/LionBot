/**
 * Avatar do remetente, ao lado da ÚLTIMA mensagem do grupo.
 *
 * Quando invisível, o elemento continua ocupando espaço: é ele que mantém as
 * outras mensagens do grupo alinhadas com a que tem avatar.
 *
 * <img> puro e não next/image de propósito — estes componentes são
 * autocontidos (spec §6) e o otimizador acrescenta um salto de rede num
 * primeiro paint que precisa ser instantâneo dentro do webview.
 */

import type { CSSProperties } from "react";

const SIZE = 34;

export function TgAvatar({
  name,
  url,
  visible,
}: {
  name: string;
  url: string | null;
  visible: boolean;
}) {
  const base: CSSProperties = {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    borderRadius: "50%",
    alignSelf: "flex-end",
  };

  if (!visible) return <div style={base} aria-hidden />;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={SIZE}
        height={SIZE}
        loading="lazy"
        style={{ ...base, objectFit: "cover" }}
      />
    );
  }

  const inicial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        ...base,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--tgc-button)",
        color: "var(--tgc-button-text)",
        fontSize: 15,
        fontWeight: 500,
      }}
    >
      {inicial}
    </div>
  );
}
