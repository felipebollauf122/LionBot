/**
 * Tradução de `error_message` (mtproto_scheduled_messages) pra quem olha o
 * chip de status de uma mensagem — nunca a string crua como texto
 * principal.
 *
 * O worker mistura dois tipos de texto na mesma coluna: frases próprias,
 * curtas e em português (`falhar(messageId, campaignId, "campanha sem canal
 * de destino", …)`, ver scheduled-campaign-handler.ts), e o `err.message`
 * bruto de qualquer exceção que escapou do envio — inclusive as do
 * Telegram/Bot API (GrammyError etc.), tipicamente em inglês. O componente
 * não tem como distinguir as duas coisas só olhando a string, então
 * reconhece os casos que o próprio worker documenta e cai num texto neutro
 * pra qualquer outro.
 *
 * O carve-out de "mostrar o erro por inteiro porque é acionável" é do
 * `ensureBotAccess` (o dono pode agir: mudar uma config no BotFather, trocar
 * de conta). Aqui não há ação que o dono possa tomar a partir do texto cru
 * de um erro do Telegram — só confusão com inglês técnico.
 */

const CASOS_CONHECIDOS: Array<{ padrao: RegExp; mensagem: string }> = [
  {
    padrao: /^campanha sem canal de destino$/,
    mensagem: "A campanha ficou sem canal de destino definido.",
  },
  {
    padrao: /^bot companheiro não cadastrado ou inválido$/,
    mensagem: "O bot companheiro não está configurado corretamente. Revise em Automações.",
  },
  {
    padrao: /^download da mídia falhou/,
    mensagem: "Não foi possível baixar a mídia desta mensagem.",
  },
  {
    padrao: /sem mídia gravada$/,
    mensagem: "Esta mensagem não tem mídia salva para publicar.",
  },
  {
    padrao: /^álbum publicado sem devolver id$/,
    mensagem: "O álbum não pôde ser confirmado como publicado.",
  },
];

/** Sentença neutra pra qualquer causa não reconhecida — nunca o texto cru. */
const GENERICA = "Houve um problema ao publicar esta mensagem.";

/**
 * `null` quando não há erro. Caso contrário, sempre uma frase curta em
 * português — reconhecida ou a genérica.
 */
export function describeSendError(errorMessage: string | null | undefined): string | null {
  if (!errorMessage) return null;
  for (const c of CASOS_CONHECIDOS) {
    if (c.padrao.test(errorMessage)) return c.mensagem;
  }
  return GENERICA;
}
