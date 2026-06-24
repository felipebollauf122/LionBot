export interface PoolAccount {
    id: string;
    phoneNumber: string;
    sessionString: string;
    status: "active" | "flood_wait" | "banned" | "disconnected";
    floodWaitUntil: Date | null;
}
export declare class AccountPool {
    private accounts;
    private cursor;
    load(accounts: PoolAccount[]): void;
    private isAvailable;
    next(): PoolAccount | null;
    /**
     * Pega uma conta específica pelo id, respeitando disponibilidade.
     * Usado em campanhas globais onde cada target tem uma conta pré-atribuída
     * (porque o access_hash do dialog só vale pra essa conta).
     * Retorna null se a conta não existe no pool OU está indisponível
     * (flood_wait/banned/disconnected).
     */
    getById(id: string): PoolAccount | null;
    markFloodWait(id: string, seconds: number): void;
    markBanned(id: string): void;
}
