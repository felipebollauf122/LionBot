import type { TelegramClient } from "telegram";
/**
 * Núcleo de download de mídia via MTProto, extraído de
 * clone/source-reader.ts's downloadToPath pra ser reaproveitado também pelo
 * bot-flow-clone (media-rehost.ts) sem duplicar a lógica de stream —
 * particularmente a defesa de timing abaixo, fácil de reintroduzir errado
 * se reescrita de memória.
 *
 * ARMADILHA (motivo da defesa Promise.race abaixo): falha de escrita
 * (ENOSPC, permissão) dispara o autoDestroy do fs.WriteStream — 'error' e,
 * poucos ms depois, 'close'. Um listener de 'close' registrado só depois do
 * `for await` esgotar o download inteiro chega tarde demais: 'close' já
 * disparou e não dispara de novo, a promise nunca resolve nem rejeita e
 * trava pra sempre (pior que o crash que o listener de 'error' evitava, e
 * o loop ainda puxaria o arquivo inteiro da rede à toa antes de travar).
 * Por isso o listener de 'close' só é registrado se o erro ainda NÃO foi
 * observado, e o loop de download corre em paralelo (Promise.race) com uma
 * promise que rejeita assim que 'error' dispara, sem esperar o resto do
 * arquivo ser puxado da rede.
 */
export declare function downloadMediaToPath(raw: TelegramClient, media: unknown, filePath: string, maxBytes: number): Promise<number | null>;
