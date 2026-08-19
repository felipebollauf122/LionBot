import { Api } from "telegram";
export interface TextReplacement {
    offset: number;
    length: number;
    newText: string;
    /** Constrói a entidade de saída pro span substituído — permite trocar o
     *  TIPO da entidade (ex.: Mention→Url quando o valor novo não começa com
     *  @), não só offset/length. */
    buildEntity: (offset: number, length: number) => Api.TypeMessageEntity;
}
/**
 * Substitui trechos de `text` (mentions/urls trocados por outra categoria) e
 * reajusta offset/length de TODA entidade — a substituída e as demais, que
 * podem estar antes, depois, ou sobrepondo o span trocado (ex.: negrito
 * envolvendo uma mention). offset/length são UTF-16 code units (mesma
 * unidade que o resto do pipeline já assume, ver entities.ts) — .slice/
 * .length nativos do JS já operam nessa unidade, sem conversão extra.
 *
 * Zero replacements é o caminho comum (imensa maioria dos clones não liga a
 * troca de link): devolve as MESMAS referências de entrada, sem alocar nada.
 */
export declare function applyTextReplacements(text: string, entities: Api.TypeMessageEntity[] | undefined, replacements: TextReplacement[]): {
    text: string;
    entities: Api.TypeMessageEntity[] | undefined;
};
export interface TextUrlReplacement {
    offset: number;
    length: number;
    newUrl: string;
}
/**
 * Troca só o .url de Api.MessageEntityTextUrl — o texto visível (label) não
 * muda, então não precisa de nenhuma matemática de offset: é uma troca de
 * campo, não uma edição de string. Zero replacements devolve a MESMA
 * referência do array de entrada.
 */
export declare function applyTextUrlReplacements(entities: Api.TypeMessageEntity[] | undefined, replacements: TextUrlReplacement[]): Api.TypeMessageEntity[] | undefined;
