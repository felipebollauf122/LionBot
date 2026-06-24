import { findNextNodeId } from "./text.js";
export async function handleTriggerNode(ctx) {
    return {
        nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
    };
}
