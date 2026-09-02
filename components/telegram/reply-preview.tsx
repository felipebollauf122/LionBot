/**
 * Bloco citado dentro da bolha, para a ação "Responder".
 * O texto trunca numa linha — o Telegram nunca deixa a citação crescer.
 */
export function ReplyPreview({ sender, text }: { sender: string; text: string }) {
  return (
    <div className="tg-reply">
      <div className="tg-reply-sender">{sender}</div>
      <div className="tg-reply-text">{text}</div>
    </div>
  );
}
