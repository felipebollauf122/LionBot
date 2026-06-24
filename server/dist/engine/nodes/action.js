import { findNextNodeId } from "./text.js";
export async function handleActionNode(ctx) {
    const actionType = String(ctx.node.data.action_type ?? "");
    const stateUpdates = {};
    switch (actionType) {
        case "add_tag": {
            const tag = String(ctx.node.data.tag ?? "");
            const currentTags = (ctx.lead.state.tags ?? []);
            if (!currentTags.includes(tag)) {
                stateUpdates.tags = [...currentTags, tag];
            }
            break;
        }
        case "remove_tag": {
            const tag = String(ctx.node.data.tag ?? "");
            const currentTags = (ctx.lead.state.tags ?? []);
            stateUpdates.tags = currentTags.filter((t) => t !== tag);
            break;
        }
        case "set_variable": {
            const key = String(ctx.node.data.variable ?? "");
            const value = ctx.node.data.value;
            stateUpdates[key] = value;
            break;
        }
        default:
            break;
    }
    return {
        nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
        stateUpdates: Object.keys(stateUpdates).length > 0 ? stateUpdates : undefined,
    };
}
