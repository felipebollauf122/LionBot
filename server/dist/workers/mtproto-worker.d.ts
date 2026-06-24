/** Graceful shutdown (#46): desconecta todos os clients MTProto vivos. */
export declare function shutdownMtprotoClients(): Promise<void>;
export declare function startMtprotoWorker(): void;
