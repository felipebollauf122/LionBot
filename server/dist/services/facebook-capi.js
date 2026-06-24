import { createHash } from "crypto";
export class FacebookCapi {
    /** todos os destinos configurados (principal + reserva, se houver). */
    targets;
    /**
     * @param pixelId pixel PRINCIPAL
     * @param accessToken token do principal
     * @param backup pixel RESERVA opcional (aquecimento). Só é usado se enabled e preenchido.
     */
    constructor(pixelId, accessToken, backup) {
        this.targets = [];
        if (pixelId && accessToken) {
            this.targets.push({ pixelId, accessToken, label: "principal" });
        }
        if (backup?.enabled && backup.pixelId && backup.accessToken) {
            this.targets.push({ pixelId: backup.pixelId, accessToken: backup.accessToken, label: "reserva" });
        }
    }
    isConfigured() {
        return this.targets.length > 0;
    }
    /** SHA-256 hash a value for Facebook's normalization requirements */
    hash(value) {
        return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
    }
    /**
     * Normaliza nome pro hash do Facebook: remove acentos (NFD), espaços
     * duplos e dígitos, rejeita placeholders genéricos. Retorna null se o
     * nome não tem valor de matching (não setar o campo é melhor que setar lixo).
     */
    normalizeNameForHash(value) {
        if (!value)
            return null;
        let normalized = value
            .trim()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "") // remove combining marks (acentos)
            .replace(/\d/g, "") // remove dígitos
            .replace(/\s+/g, " ") // colapsa espaços
            .trim();
        const lower = normalized.toLowerCase();
        const placeholders = ["na", "n/a", "anonimo", "anônimo", "unknown", "user", "cliente", "test", "teste"];
        if (placeholders.includes(lower))
            return null;
        return normalized.length > 1 ? normalized : null;
    }
    /**
     * Valida e normaliza telefone pro padrão E.164 brasileiro. Retorna só
     * dígitos com country code, ou null se inválido/placeholder (e loga).
     */
    validatePhoneE164(input) {
        if (!input)
            return null;
        const digits = input.replace(/\D/g, "");
        if (digits.length === 0)
            return null;
        const e164 = digits.startsWith("55") ? digits : `55${digits}`;
        // E.164 BR: 55 + DDD(2) + número(8-9) = 12-13 dígitos. Aceita faixa
        // mais ampla (10-15) pra não rejeitar formatos legítimos.
        if (e164.length < 12 || e164.length > 15) {
            console.warn(`[facebook-capi] phone "${input}" rejeitado: comprimento E.164 inválido (${e164.length})`);
            return null;
        }
        // Placeholders comuns (1199999..., todos 9, etc)
        if (/^55(11)?9{8,}$/.test(e164) || /^(\d)\1+$/.test(e164.slice(2))) {
            console.warn(`[facebook-capi] phone "${input}" rejeitado: placeholder`);
            return null;
        }
        return e164;
    }
    /** Build user_data object with proper hashing per Facebook spec */
    buildUserData(params) {
        const ud = {};
        if (params.fbc)
            ud.fbc = params.fbc;
        if (params.fbp)
            ud.fbp = params.fbp;
        if (params.externalIds && params.externalIds.length > 0) {
            // Meta aceita array de external_ids — testa match em cada um
            ud.external_id = params.externalIds.map((id) => this.hash(id));
        }
        if (params.subscriptionId)
            ud.subscription_id = params.subscriptionId;
        // Nomes: normaliza (remove acento/dígito/placeholder) antes do hash (#8)
        const fn = this.normalizeNameForHash(params.firstName);
        if (fn)
            ud.fn = this.hash(fn);
        const ln = this.normalizeNameForHash(params.lastName);
        if (ln)
            ud.ln = this.hash(ln);
        // Email: só hasheia se tem valor real após trim (#7)
        if (params.email) {
            const trimmed = params.email.trim();
            if (trimmed.length > 0 && !trimmed.endsWith("@eaglebot.temp")) {
                ud.em = this.hash(trimmed);
            }
        }
        // Telefone: valida E.164 forte + rejeita placeholder (#9)
        const validPhone = this.validatePhoneE164(params.phone);
        if (validPhone)
            ud.ph = this.hash(validPhone);
        ud.country = this.hash(params.country ?? "br");
        // IP and User-Agent are NOT hashed — sent as-is per Meta spec
        if (params.clientIp && params.clientIp.length > 0) {
            ud.client_ip_address = params.clientIp;
        }
        if (params.clientUserAgent && params.clientUserAgent.length > 0) {
            ud.client_user_agent = params.clientUserAgent;
        }
        return ud;
    }
    async sendPurchaseEvent(params) {
        if (!this.isConfigured())
            return false;
        // Guard against invalid value — Meta penalizes events with 0/NaN/negative value
        const value = Number(params.value);
        if (!Number.isFinite(value) || value <= 0) {
            console.error(`[facebook-capi] Refusing to send Purchase with invalid value=${params.value}`);
            return false;
        }
        const customData = {
            value,
            currency: params.currency.toUpperCase(),
            content_type: "product",
        };
        if (params.contentIds?.length) {
            customData.content_ids = params.contentIds;
        }
        if (params.contentName) {
            customData.content_name = params.contentName;
        }
        if (params.contents?.length) {
            customData.contents = params.contents;
            customData.num_items = params.numItems ?? params.contents.reduce((sum, c) => sum + c.quantity, 0);
        }
        else if (params.numItems) {
            customData.num_items = params.numItems;
        }
        if (params.orderId) {
            customData.order_id = params.orderId;
        }
        const eventData = {
            event_name: "Purchase",
            event_time: params.eventTime,
            event_id: params.eventId,
            action_source: "website",
            user_data: this.buildUserData(params.userData),
            custom_data: customData,
        };
        if (params.sourceUrl) {
            eventData.event_source_url = params.sourceUrl;
        }
        return this.sendEvent(eventData);
    }
    async sendInitiateCheckoutEvent(params) {
        if (!this.isConfigured())
            return false;
        const eventData = {
            event_name: "InitiateCheckout",
            event_time: params.eventTime,
            event_id: params.eventId,
            action_source: "website",
            user_data: this.buildUserData(params.userData),
            custom_data: {
                value: params.value,
                currency: params.currency.toUpperCase(),
                content_type: "product",
            },
        };
        if (params.contentIds?.length) {
            eventData.custom_data.content_ids = params.contentIds;
        }
        if (params.contentName) {
            eventData.custom_data.content_name = params.contentName;
        }
        return this.sendEvent(eventData);
    }
    async sendLeadEvent(params) {
        if (!this.isConfigured())
            return false;
        return this.sendEvent({
            event_name: "Lead",
            event_time: params.eventTime,
            event_id: params.eventId,
            action_source: "website",
            user_data: this.buildUserData(params.userData),
        });
    }
    async sendViewContentEvent(params) {
        if (!this.isConfigured())
            return false;
        const eventData = {
            event_name: "ViewContent",
            event_time: params.eventTime,
            event_id: params.eventId,
            action_source: "website",
            user_data: this.buildUserData(params.userData),
        };
        if (params.contentName) {
            eventData.custom_data = { content_name: params.contentName };
        }
        return this.sendEvent(eventData);
    }
    async sendPageViewEvent(params) {
        if (!this.isConfigured())
            return false;
        const eventData = {
            event_name: "PageView",
            event_time: params.eventTime,
            event_id: params.eventId,
            action_source: "website",
            user_data: this.buildUserData(params.userData),
        };
        if (params.sourceUrl) {
            eventData.event_source_url = params.sourceUrl;
        }
        return this.sendEvent(eventData);
    }
    /**
     * Envia o evento pra TODOS os destinos (principal + reserva). Dispara em
     * paralelo. O resultado retornado é o do destino PRINCIPAL — o reserva é
     * best-effort (aquecimento), uma falha nele não invalida o evento.
     */
    async sendEvent(eventData, maxRetries = 3) {
        const results = await Promise.all(this.targets.map((t) => this.sendToTarget(t, eventData, maxRetries)));
        // índice 0 é sempre o principal (foi adicionado primeiro).
        return results[0] ?? false;
    }
    /** Envia o evento a UM destino (pixel+token), com retry. */
    async sendToTarget(target, eventData, maxRetries) {
        const eventName = String(eventData.event_name);
        const apiUrl = `https://graph.facebook.com/v21.0/${target.pixelId}/events`;
        const tag = `[facebook-capi:${target.label}]`;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt === 1) {
                    console.log(`${tag} Sending ${eventName} event (event_id=${eventData.event_id})...`);
                }
                else {
                    console.log(`${tag} Retrying ${eventName} (attempt ${attempt}/${maxRetries})...`);
                }
                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        data: [eventData],
                        access_token: target.accessToken,
                    }),
                });
                const result = await response.json();
                if (response.ok) {
                    console.log(`${tag} ✓ ${eventName} sent (event_id=${eventData.event_id}, events_received=${result.events_received}, fbtrace_id=${result.fbtrace_id ?? "—"})`);
                    return true;
                }
                // Retry on server errors (5xx) and rate limits (429), but NOT on 4xx client errors (bad payload)
                const shouldRetry = response.status >= 500 || response.status === 429;
                if (shouldRetry && attempt < maxRetries) {
                    const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
                    console.warn(`${tag} ${eventName} failed with ${response.status}, retrying in ${delayMs}ms. Response: ${JSON.stringify(result)}`);
                    await new Promise((r) => setTimeout(r, delayMs));
                    continue;
                }
                console.error(`${tag} ✗ ${eventName} failed (${response.status}, no retry):`, JSON.stringify(result));
                return false;
            }
            catch (error) {
                const isLast = attempt >= maxRetries;
                if (!isLast) {
                    const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
                    console.warn(`${tag} ${eventName} network error (attempt ${attempt}), retrying in ${delayMs}ms:`, error);
                    await new Promise((r) => setTimeout(r, delayMs));
                    continue;
                }
                console.error(`${tag} ✗ ${eventName} request failed after ${maxRetries} attempts:`, error);
                return false;
            }
        }
        return false;
    }
}
