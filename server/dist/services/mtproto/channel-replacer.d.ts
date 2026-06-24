interface Monitor {
    id: string;
    tenant_id: string;
    account_id: string;
    template_id: string;
    peer_channel_id: string;
}
/**
 * Executa a substituição de um canal monitorado caído:
 * 1. escolhe conta substituta
 * 2. cria canal novo pela conta substituta usando template
 * 3. faz upload das mídias e posta no canal
 * 4. posta welcome_text
 * 5. exporta link de convite
 * 6. atualiza channel_monitors com resultado
 *
 * Idempotente: se monitor.status já = 'replaced', não roda de novo.
 */
export declare function replaceChannel(monitor: Monitor): Promise<void>;
export {};
