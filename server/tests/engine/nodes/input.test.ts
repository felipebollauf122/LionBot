import { describe, it, expect, vi } from "vitest";
import { handleInputNode, handleInputResponse } from "../../../src/engine/nodes/input.js";
import type { NodeContext } from "../../../src/engine/types.js";

function makeContext(data: Record<string, unknown> = { prompt: "Qual seu email?", variable: "email" }): NodeContext {
  return {
    node: { id: "input-1", type: "input", data, position: { x: 0, y: 0 } },
    lead: {
      id: "lead-1", tenant_id: "t-1", bot_id: "b-1", telegram_user_id: 123,
      first_name: "Joao", last_name: null, username: null, tid: null, fbclid: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
      current_flow_id: "f-1", current_node_id: "input-1", active_flow_name: null, state: {},
      created_at: "", updated_at: "",
    },
    edges: [{ id: "e1", source: "input-1", target: "node-next" }],
    telegram: { sendMessage: vi.fn() } as any,
    chatId: 123,
  };
}

const EDGES = [{ id: "e1", source: "input-1", target: "node-next" }];
const node = (data: Record<string, unknown>) => ({ id: "input-1", data });

describe("handleInputNode", () => {
  it("should send prompt and wait", async () => {
    const ctx = makeContext();
    const result = await handleInputNode(ctx);
    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith({ chatId: 123, text: "Qual seu email?" });
    expect(result.nextNodeId).toBe("wait");
  });

  it("should interpolate lead fields into the prompt", async () => {
    const ctx = makeContext({ prompt: "{{first_name}}, qual seu email?", variable: "email" });
    await handleInputNode(ctx);
    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith({ chatId: 123, text: "Joao, qual seu email?" });
  });
});

describe("handleInputResponse", () => {
  it("should save user response to state and advance", () => {
    const result = handleInputResponse(node({ variable: "email" }), "joao@test.com", EDGES);
    expect(result.stateUpdates).toEqual({ email: "joao@test.com" });
    expect(result.nextNodeId).toBe("node-next");
    expect(result.retryMessage).toBeUndefined();
  });

  it("should trim the answer before saving", () => {
    const result = handleInputResponse(node({ variable: "nome" }), "  Joao  ", EDGES);
    expect(result.stateUpdates).toEqual({ nome: "Joao" });
  });

  it("should advance without state updates when no variable is configured", () => {
    const result = handleInputResponse(node({}), "qualquer coisa", EDGES);
    expect(result.stateUpdates).toBeUndefined();
    expect(result.nextNodeId).toBe("node-next");
  });

  it("should keep waiting and reprompt on empty answer", () => {
    const result = handleInputResponse(node({ variable: "email" }), "", EDGES);
    expect(result.nextNodeId).toBe("wait");
    expect(result.stateUpdates).toBeUndefined();
    expect(result.retryMessage).toBeTruthy();
  });

  it("should reject an invalid email and keep waiting", () => {
    const result = handleInputResponse(
      node({ variable: "email", validation: "email" }),
      "nao eh email",
      EDGES,
    );
    expect(result.nextNodeId).toBe("wait");
    expect(result.stateUpdates).toBeUndefined();
    expect(result.retryMessage).toContain("inválido");
  });

  it("should accept a valid email under email validation", () => {
    const result = handleInputResponse(
      node({ variable: "email", validation: "email" }),
      "joao@test.com",
      EDGES,
    );
    expect(result.nextNodeId).toBe("node-next");
    expect(result.stateUpdates).toEqual({ email: "joao@test.com" });
  });

  it("should validate numbers", () => {
    const data = { variable: "idade", validation: "number" };
    expect(handleInputResponse(node(data), "27", EDGES).nextNodeId).toBe("node-next");
    expect(handleInputResponse(node(data), "19,90", EDGES).nextNodeId).toBe("node-next");
    expect(handleInputResponse(node(data), "vinte e sete", EDGES).nextNodeId).toBe("wait");
  });

  it("should validate phones by digit count, ignoring formatting", () => {
    const data = { variable: "tel", validation: "phone" };
    expect(handleInputResponse(node(data), "(11) 91234-5678", EDGES).nextNodeId).toBe("node-next");
    expect(handleInputResponse(node(data), "+55 11 91234 5678", EDGES).nextNodeId).toBe("node-next");
    expect(handleInputResponse(node(data), "1234", EDGES).nextNodeId).toBe("wait");
  });

  it("should prefer the custom retry message when configured", () => {
    const result = handleInputResponse(
      node({ variable: "email", validation: "email", retry_message: "Manda o email certo ai" }),
      "xxx",
      EDGES,
    );
    expect(result.retryMessage).toBe("Manda o email certo ai");
  });

  it("should return null next node when the input has no outgoing edge", () => {
    const result = handleInputResponse(node({ variable: "email" }), "joao@test.com", []);
    expect(result.nextNodeId).toBeNull();
  });
});
