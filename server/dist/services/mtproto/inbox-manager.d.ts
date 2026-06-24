export declare function openInbox(accountId: string): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;
export declare function heartbeatInbox(accountId: string): Promise<boolean>;
export declare function closeInbox(accountId: string): Promise<void>;
