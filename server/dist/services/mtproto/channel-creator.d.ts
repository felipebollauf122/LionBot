interface CreateResult {
    ok: true;
    instanceId: string;
    channelId: string;
    inviteLink: string | null;
    title: string;
}
interface CreateError {
    ok: false;
    error: string;
}
/**
 * Cria um canal completo (canal + foto + fluxo de mídias + texto +
 * permissões + invite link) a partir de um template e uma conta MTProto.
 * Registra o resultado em channel_instances.
 *
 * Usado pelo:
 *  - Botão "Criar agora" no painel (acionado pelo owner)
 *  - Auto-recriação do poller (quando canal/conta cai e template tem
 *    auto_recreate_on_ban=true)
 */
export declare function createChannelInstance(tenantId: string, templateId: string, accountId: string): Promise<CreateResult | CreateError>;
/**
 * Escolhe próxima conta substituta — usado pela auto-recriação.
 * Critério: status='active', mais recente, diferente da que está sendo
 * substituída.
 */
export declare function pickReplacementAccount(tenantId: string, exceptAccountId: string): Promise<string | null>;
export {};
