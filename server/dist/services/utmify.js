export class UtmifyService {
    apiToken;
    baseUrl = "https://api.utmify.com.br/api-credentials/orders";
    constructor(apiToken) {
        this.apiToken = apiToken;
    }
    isConfigured() {
        return Boolean(this.apiToken);
    }
    async sendOrder(params) {
        if (!this.isConfigured()) {
            console.warn("[utmify] API token não configurado, pulando envio");
            return false;
        }
        const tracking = params.trackingParameters ?? {};
        const body = {
            isTest: params.isTest ?? false,
            orderId: params.orderId,
            platform: params.platform,
            status: params.status,
            paymentMethod: params.paymentMethod,
            createdAt: params.paidAt ?? new Date().toISOString(),
            approvedDate: params.approvedDate ?? null,
            refundedAt: params.refundedAt ?? null,
            customer: {
                name: params.customer.name,
                email: params.customer.email,
                phone: params.customer.phone,
                document: params.customer.document,
                country: params.customer.country ?? "BR",
            },
            products: params.products.map((p) => ({
                id: p.id,
                name: p.name,
                priceInCents: p.priceInCents,
                quantity: p.quantity,
                planId: p.planId ?? p.id,
                planName: p.planName ?? p.name,
            })),
            commission: params.commission ?? {
                totalPriceInCents: params.products.reduce((sum, p) => sum + Number(p.priceInCents) * p.quantity, 0).toString(),
                gatewayFeeInCents: "0",
                userCommissionInCents: params.products.reduce((sum, p) => sum + Number(p.priceInCents) * p.quantity, 0).toString(),
            },
            trackingParameters: {
                src: tracking.src ?? null,
                sck: tracking.sck ?? null,
                utm_source: tracking.utm_source ?? null,
                utm_medium: tracking.utm_medium ?? null,
                utm_campaign: tracking.utm_campaign ?? null,
                utm_content: tracking.utm_content ?? null,
                utm_term: tracking.utm_term ?? null,
            },
        };
        try {
            console.log(`[utmify] Sending order ${params.orderId} to Utmify...`);
            const response = await fetch(this.baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-token": this.apiToken,
                },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[utmify] API error (${response.status}): ${errorText}`);
                return false;
            }
            console.log(`[utmify] ✓ Order ${params.orderId} sent successfully`);
            return true;
        }
        catch (error) {
            console.error("[utmify] Request failed:", error);
            return false;
        }
    }
}
