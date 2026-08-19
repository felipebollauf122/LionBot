import { classifyButton, mapRawButton, scanForPaymentConfirmation } from "./payment-guard.js";
import { computeStateFingerprint } from "./fingerprint.js";
import { gramjsEntitiesToCaptured } from "./entities-to-html.js";
function mediaKindLabel(rawKind) {
    return rawKind || "none";
}
/**
 * Percorre a árvore de conversa de um bot-alvo via BFS: /start, captura o
 * burst de resposta, classifica cada botão (payment-guard.ts) e clica só os
 * elegíveis, um de cada vez. Injeção de dependência igual CloneRunner —
 * toda I/O real (client MTProto, Supabase) fica de fora, aqui só a
 * orquestração/decisão, testável com deps falsos.
 */
export class BotExplorer {
    deps;
    cfg;
    byFingerprint = new Map(); // fingerprint -> nodeId
    byParentButton = new Map(); // "parentNodeId|buttonId" -> nodeId (idempotência de resume)
    exploredCount = 0;
    rootExists = false;
    constructor(deps, cfg) {
        this.deps = deps;
        this.cfg = cfg;
    }
    async run() {
        const existing = await this.deps.loadExistingNodes();
        const queue = [];
        // Passe 1: indexa TODO nó existente primeiro. Precisa ser um passe
        // completo antes de procurar botões pendentes (passe 2) — senão um nó
        // que aparece DEPOIS na lista, mas é filho de um nó anterior, ainda não
        // está no índice quando o nó anterior é examinado, e o botão que já
        // tem esse filho seria enfileirado de novo por engano.
        for (const n of existing) {
            this.byFingerprint.set(n.fingerprint, n.id);
            if (n.status === "explored")
                this.exploredCount++;
            if (n.parentNodeId === null && n.triggeredByButtonId === null)
                this.rootExists = true;
            this.byParentButton.set(this.parentButtonKey(n.parentNodeId, n.triggeredByButtonId), n.id);
        }
        // Passe 2: reconstrói a fronteira pendente a partir de botões já
        // persistidos que ainda não têm filho — sem isso, uma retomada nunca
        // continuaria uma exploração interrompida no meio (achado #8).
        for (const n of existing) {
            if (n.status !== "explored")
                continue;
            for (const msg of n.messages) {
                for (const btn of msg.buttons) {
                    if (btn.skip || !btn.data)
                        continue;
                    if (this.byParentButton.has(this.parentButtonKey(n.id, btn.id)))
                        continue;
                    queue.push({
                        parentNodeId: n.id,
                        triggeredByButtonId: btn.id,
                        depth: n.depth + 1,
                        action: { kind: "click", msgId: msg.rawMsgId, data: Buffer.from(btn.data, "base64") },
                    });
                }
            }
        }
        if (!this.rootExists) {
            queue.unshift({ parentNodeId: null, triggeredByButtonId: null, depth: 0, action: { kind: "start" } });
        }
        while (queue.length > 0) {
            if (await this.shouldStop())
                return;
            const item = queue.shift();
            // Teto checado ANTES do clique de verdade disparar — não só antes de
            // decidir se recursa depois (achado #9: o desenho original checava
            // isso tarde demais, deixando um clique disparar mesmo na fronteira
            // do teto).
            if (item.action.kind === "click") {
                if (item.depth > this.cfg.maxDepth)
                    continue;
                if (this.exploredCount >= this.cfg.maxNodes)
                    continue;
            }
            const nextItems = await this.processItem(item);
            queue.push(...nextItems);
            if (this.cfg.clickThrottleMs > 0)
                await this.deps.delay(this.cfg.clickThrottleMs);
        }
    }
    parentButtonKey(parentNodeId, buttonId) {
        return `${parentNodeId ?? "root"}|${buttonId ?? ""}`;
    }
    async shouldStop() {
        const status = await this.deps.getStatus();
        return status === null || status === "paused" || status === "failed";
    }
    /** Executa a ação (start ou clique), captura o burst, fingerprinta e persiste. Devolve os próximos itens candidatos (não filtrados por teto — isso acontece no run()). */
    async processItem(item) {
        if (item.action.kind === "start") {
            await this.deps.sendStart();
        }
        else {
            await this.deps.clickButton(item.action.msgId, item.action.data);
        }
        const raw = await this.deps.captureBurst();
        // Fingerprint calculado ANTES de qualquer download de mídia — evita
        // gastar re-hospedagem com conteúdo que vai ser descartado como
        // duplicata (loop detectado).
        const fingerprint = computeStateFingerprint({
            messages: raw.map((m) => ({
                text: m.text,
                mediaKind: mediaKindLabel(m.mediaKind),
                buttonLabels: m.rawButtons.map((b) => mapRawButton(b).label),
            })),
        });
        const existingId = this.byFingerprint.get(fingerprint);
        if (existingId) {
            await this.deps.persistNode({
                parentNodeId: item.parentNodeId,
                triggeredByButtonId: item.triggeredByButtonId,
                depth: item.depth,
                fingerprint,
                duplicateOfNodeId: existingId,
                messages: [],
                status: "duplicate",
                paymentConfirmationSuspected: false,
            });
            return [];
        }
        const nodeIdHint = `${item.parentNodeId ?? "root"}_${item.triggeredByButtonId ?? "start"}`;
        const messages = await this.materializeMessages(raw, nodeIdHint);
        const paymentConfirmationSuspected = messages.some((m) => m.text && scanForPaymentConfirmation(m.text));
        const nodeId = await this.deps.persistNode({
            parentNodeId: item.parentNodeId,
            triggeredByButtonId: item.triggeredByButtonId,
            depth: item.depth,
            fingerprint,
            duplicateOfNodeId: null,
            messages,
            status: "explored",
            paymentConfirmationSuspected,
        });
        this.byFingerprint.set(fingerprint, nodeId);
        this.byParentButton.set(this.parentButtonKey(item.parentNodeId, item.triggeredByButtonId), nodeId);
        this.exploredCount++;
        const nextItems = [];
        for (const msg of messages) {
            for (const btn of msg.buttons) {
                if (btn.skip || !btn.data)
                    continue;
                nextItems.push({
                    parentNodeId: nodeId,
                    triggeredByButtonId: btn.id,
                    depth: item.depth + 1,
                    action: { kind: "click", msgId: msg.rawMsgId, data: Buffer.from(btn.data, "base64") },
                });
            }
        }
        return nextItems;
    }
    /** Classifica botões, baixa/re-hospeda mídia — só roda pra burst que NÃO é duplicata. */
    async materializeMessages(raw, nodeIdHint) {
        const out = [];
        for (let seq = 0; seq < raw.length; seq++) {
            const m = raw[seq];
            const mediaPublicUrl = m.media
                ? await this.deps.rehostMedia(m.media, `${nodeIdHint}_${seq}`, m.fileName ?? `file_${seq}`)
                : null;
            const buttons = m.rawButtons.map((rawBtn, i) => {
                const info = mapRawButton(rawBtn);
                const decision = classifyButton(info, m.text ?? "");
                const id = `b${seq}_${i}`;
                const data = info.kind === "callback" && rawBtn instanceof Object && "data" in rawBtn
                    ? Buffer.from(rawBtn.data).toString("base64")
                    : null;
                if (decision.action === "click") {
                    return { id, kind: info.kind, label: info.label, url: info.url ?? null, data, skip: false, skipReason: null, paymentDomainMatch: false };
                }
                if (decision.action === "open_url_only") {
                    return {
                        id, kind: info.kind, label: info.label, url: info.url ?? null, data: null,
                        skip: true, skipReason: "url_button_not_clicked", paymentDomainMatch: decision.paymentDomainMatch,
                    };
                }
                return { id, kind: info.kind, label: info.label, url: info.url ?? null, data: null, skip: true, skipReason: decision.reason, paymentDomainMatch: false };
            });
            out.push({
                seq,
                rawMsgId: m.rawMsgId,
                text: m.text,
                entities: gramjsEntitiesToCaptured(m.entities),
                mediaKind: mediaKindLabel(m.mediaKind),
                mediaPublicUrl,
                buttons,
            });
        }
        return out;
    }
}
