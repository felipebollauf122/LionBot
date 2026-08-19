/** Escolhe um índice aleatório uniforme em [0, length). Usado pelos nós
 * image/video/text/payment_button pra randomizar mídia/texto/preço no
 * remarketing (biblioteca de mídia). Sem seed — cada envio é independente. */
export function pickRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}
