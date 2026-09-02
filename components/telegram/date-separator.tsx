/**
 * Pill centralizado que separa os dias. Fundo escuro translúcido sobre o
 * wallpaper, como no Telegram.
 */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
      <span
        style={{
          background: "var(--tgc-veil)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 500,
          padding: "3px 10px",
          borderRadius: 14,
          backdropFilter: "blur(6px)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
