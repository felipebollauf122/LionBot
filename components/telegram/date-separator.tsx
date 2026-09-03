/**
 * Chip centralizado que separa os dias: 22px de altura, cantos totalmente
 * arredondados, texto branco sobre a cor de "serviço" derivada do wallpaper,
 * como o Telegram desenha nas duas plataformas.
 */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div className="tg-date">
      <span>{label}</span>
    </div>
  );
}
