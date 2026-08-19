import { Queue } from "bullmq";
interface DelayedJobData {
    leadId: string;
    flowId: string;
    nodeId: string;
    botId: string;
    tenantId: string;
    chatId: number;
}
export declare const delayedQueue: Queue<DelayedJobData, any, string, DelayedJobData, any, string>;
export declare function addDelayedJob(data: DelayedJobData, delaySeconds: number): Promise<void>;
interface PaymentTimeoutData {
    leadId: string;
    flowId: string;
    paymentNodeId: string;
    externalTransactionId: string;
    botId: string;
    tenantId: string;
    chatId: number;
    paymentButtonId?: string;
}
export declare const paymentTimeoutQueue: Queue<PaymentTimeoutData, any, string, PaymentTimeoutData, any, string>;
export declare function addPaymentTimeoutJob(data: PaymentTimeoutData, delaySeconds: number): Promise<void>;
interface PurchaseEmailTimeoutData {
    leadId: string;
    transactionId: string;
}
export declare const purchaseEmailTimeoutQueue: Queue<PurchaseEmailTimeoutData, any, string, PurchaseEmailTimeoutData, any, string>;
export declare function addPurchaseEmailTimeoutJob(data: PurchaseEmailTimeoutData, delaySeconds: number): Promise<void>;
export declare function startWorkers(): void;
export {};
