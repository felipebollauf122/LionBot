import { Api } from "telegram";
import type { InlineLink } from "./bot-client.js";
import type { PeerKind } from "../client.js";
export interface LinkReplaceValues {
    /** Username sem @ (armazenado assim em clone_jobs.link_replace_bot). */
    botUsername?: string;
    groupLink?: string;
    channelLink?: string;
}
export interface LinkReplaceDeps {
    classify(identifier: string): Promise<PeerKind>;
}
export interface RewriteMessageLinksInput {
    message: string | null | undefined;
    entities: Api.TypeMessageEntity[] | undefined;
    /** undefined pra álbum (nunca tem botão) ou quando copyButtons está desligado. */
    inlineLinks: InlineLink[] | undefined;
}
export interface RewriteMessageLinksResult {
    text: string;
    entities: Api.TypeMessageEntity[] | undefined;
    inlineLinks: InlineLink[] | undefined;
}
/**
 * Reescreve @mentions/links de uma mensagem, trocando toda ocorrência que o
 * Telegram classifica como bot/grupo/canal pelo valor configurado da
 * categoria correspondente. Pessoa comum (user) e tudo que não dá pra
 * classificar (unknown) fica intocado — nunca lança por causa disso.
 *
 * Uma flood de deps.classify PROPAGA (sem try/catch aqui de propósito): o
 * chamador (createPublisher, via CloneRunner.flush) já sabe tratar flood
 * como retomável.
 */
export declare function rewriteMessageLinks(input: RewriteMessageLinksInput, deps: LinkReplaceDeps, values: LinkReplaceValues): Promise<RewriteMessageLinksResult>;
