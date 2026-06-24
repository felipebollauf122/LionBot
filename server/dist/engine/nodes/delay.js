import { findNextNodeId } from "./text.js";
export async function handleDelayNode(ctx) {
    const amount = Number(ctx.node.data.amount ?? 0);
    const unit = String(ctx.node.data.unit ?? "seconds");
    let delaySeconds = amount;
    if (unit === "minutes")
        delaySeconds = amount * 60;
    if (unit === "hours")
        delaySeconds = amount * 3600;
    return {
        nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
        delaySeconds,
    };
}
