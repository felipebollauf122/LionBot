/**
 * Extrai o código de login da mensagem que a pessoa mandou.
 *
 * Existe porque a versão anterior fazia `text.replace(/\D/g, "")` — grudava
 * TODOS os dígitos da mensagem inteira e exigia exatamente 5. Quem encaminha
 * ou copia a mensagem oficial do Telegram traz junto qualquer outro número que
 * ela contenha ("expira em 2 minutos"), a conta dava 6 e o código era recusado
 * aqui, sem nunca chegar ao Telegram. Pelo teclado de botões os dígitos nunca
 * passam por texto, então só o caminho digitado quebrava.
 *
 * Quem decide se o código é válido é o Telegram. O trabalho daqui é só achar o
 * código no texto — e devolver null quando não dá para ter certeza, porque
 * enviar o código errado queima o verdadeiro e força um ciclo novo.
 */

/** Tamanho do código do Telegram. O teclado (`buildNumpad`) usa o mesmo. */
export const LOGIN_CODE_LENGTH = 5;

export function extractLoginCode(text: string, length: number = LOGIN_CODE_LENGTH): string | null {
  const limpo = (text ?? "").trim();
  if (!limpo) return null;

  // A pessoa digitou só o código, talvez espaçado ("2 2 3 4 7") ou com traço.
  const semSeparador = limpo.replace(/[\s.\-–—_]/g, "");
  if (new RegExp(`^\\d{${length}}$`).test(semSeparador)) return semSeparador;

  // Caso contrário, procura um grupo isolado com exatamente o tamanho pedido:
  // as bordas impedem recortar um pedaço de um número maior (telefone, por
  // exemplo). Vários candidatos diferentes = ambíguo, e chutar sai caro.
  const candidatos = limpo.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`, "g")) ?? [];
  const distintos = [...new Set(candidatos)];
  return distintos.length === 1 ? distintos[0] : null;
}
