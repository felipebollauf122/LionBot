import { Api } from "telegram";
import type { MessageEntity } from "@grammyjs/types";
/**
 * Converte entidades gramjs (Api.MessageEntity*) pro shape que a Bot API
 * espera (grammy `entities`/`caption_entities`).
 *
 * DEFEITO C1: gramjs serializa cada entidade como `{...args, className}` —
 * SEM o campo `type` que a Bot API exige. Passar `raw.entities` direto pro
 * grammy rende 400 "can't parse entities" e o clone-runner marca o grupo
 * inteiro como failed (toda formatação — negrito, links — da rota download
 * se perde). Esta função é pura e sem I/O de propósito: é o ponto crítico
 * do defeito, então precisa ser testável isoladamente.
 *
 * offset/length são copiados verbatim: gramjs e a Bot API usam as duas a
 * mesma unidade (UTF-16 code units), não há recomputação a fazer.
 */
export declare function toBotApiEntities(entities: Api.TypeMessageEntity[] | undefined): MessageEntity[];
