interface BotPaymentShape {
    sigilopay_public_key: string | null;
    sigilopay_secret_key: string | null;
    payment_gateway?: string | null;
}
export declare function ensureBotPaymentKeys<T extends BotPaymentShape>(botId: string, bot: T): Promise<T>;
export {};
