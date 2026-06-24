interface UserData {
    fbc?: string;
    fbp?: string;
    externalIds?: string[];
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    country?: string;
    clientIp?: string;
    clientUserAgent?: string;
    subscriptionId?: string;
}
interface PurchaseContent {
    id: string;
    quantity: number;
    item_price: number;
}
interface PurchaseEventParams {
    eventTime: number;
    userData: UserData;
    value: number;
    currency: string;
    eventId: string;
    contentIds?: string[];
    contentName?: string;
    contents?: PurchaseContent[];
    numItems?: number;
    sourceUrl?: string;
    orderId?: string;
}
interface CheckoutEventParams {
    eventTime: number;
    userData: UserData;
    value: number;
    currency: string;
    eventId: string;
    contentIds?: string[];
    contentName?: string;
}
interface LeadEventParams {
    eventTime: number;
    userData: UserData;
    eventId: string;
}
interface ViewContentEventParams {
    eventTime: number;
    userData: UserData;
    eventId: string;
    contentName?: string;
}
interface PageViewEventParams {
    eventTime: number;
    userData: UserData;
    eventId: string;
    sourceUrl?: string;
}
export declare class FacebookCapi {
    /** todos os destinos configurados (principal + reserva, se houver). */
    private targets;
    /**
     * @param pixelId pixel PRINCIPAL
     * @param accessToken token do principal
     * @param backup pixel RESERVA opcional (aquecimento). Só é usado se enabled e preenchido.
     */
    constructor(pixelId: string, accessToken: string, backup?: {
        pixelId?: string | null;
        accessToken?: string | null;
        enabled?: boolean | null;
    });
    private isConfigured;
    /** SHA-256 hash a value for Facebook's normalization requirements */
    private hash;
    /**
     * Normaliza nome pro hash do Facebook: remove acentos (NFD), espaços
     * duplos e dígitos, rejeita placeholders genéricos. Retorna null se o
     * nome não tem valor de matching (não setar o campo é melhor que setar lixo).
     */
    private normalizeNameForHash;
    /**
     * Valida e normaliza telefone pro padrão E.164 brasileiro. Retorna só
     * dígitos com country code, ou null se inválido/placeholder (e loga).
     */
    private validatePhoneE164;
    /** Build user_data object with proper hashing per Facebook spec */
    private buildUserData;
    sendPurchaseEvent(params: PurchaseEventParams): Promise<boolean>;
    sendInitiateCheckoutEvent(params: CheckoutEventParams): Promise<boolean>;
    sendLeadEvent(params: LeadEventParams): Promise<boolean>;
    sendViewContentEvent(params: ViewContentEventParams): Promise<boolean>;
    sendPageViewEvent(params: PageViewEventParams): Promise<boolean>;
    /**
     * Envia o evento pra TODOS os destinos (principal + reserva). Dispara em
     * paralelo. O resultado retornado é o do destino PRINCIPAL — o reserva é
     * best-effort (aquecimento), uma falha nele não invalida o evento.
     */
    private sendEvent;
    /** Envia o evento a UM destino (pixel+token), com retry. */
    private sendToTarget;
}
export {};
