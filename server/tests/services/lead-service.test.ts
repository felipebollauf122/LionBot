import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeadService } from "../../src/services/lead-service.js";

// Mock supabase
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

function mockChain(returnData: unknown, returnError: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  mockSupabase.from.mockReturnValue(chain);
  return chain;
}

describe("LeadService", () => {
  let service: LeadService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LeadService(mockSupabase as any);
  });

  it("should find an existing lead by telegram_user_id and bot_id", async () => {
    const existingLead = {
      id: "lead-1",
      tenant_id: "tenant-1",
      bot_id: "bot-1",
      telegram_user_id: 12345,
      first_name: "João",
      username: "joao",
      state: {},
      current_flow_id: null,
      current_node_id: null,
    };
    mockChain(existingLead);

    const lead = await service.findOrCreateLead({
      botId: "bot-1",
      tenantId: "tenant-1",
      telegramUserId: 12345,
      firstName: "João",
      username: "joao",
    });

    expect(lead).toEqual(existingLead);
    expect(mockSupabase.from).toHaveBeenCalledWith("leads");
  });

  it("should create a new lead when not found", async () => {
    const chain = mockChain(null); // first call: not found
    const newLead = {
      id: "lead-new",
      tenant_id: "tenant-1",
      bot_id: "bot-1",
      telegram_user_id: 99999,
      first_name: "Maria",
      username: null,
      state: {},
      current_flow_id: null,
      current_node_id: null,
    };
    // Override: first maybeSingle returns null (not found), then insert returns new lead
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    chain.single.mockResolvedValueOnce({ data: newLead, error: null });

    const lead = await service.findOrCreateLead({
      botId: "bot-1",
      tenantId: "tenant-1",
      telegramUserId: 99999,
      firstName: "Maria",
      username: null,
    });

    expect(lead).toEqual(newLead);
  });

  it("should update lead position in flow", async () => {
    mockChain({ id: "lead-1" });

    await service.updatePosition("lead-1", "flow-1", "node-3");

    expect(mockSupabase.from).toHaveBeenCalledWith("leads");
  });

  it("should update lead state via merge_lead_state RPC (atomic merge, not a blind overwrite)", async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { name: "João", email: "j@test.com" },
      error: null,
    });

    const merged = await service.updateState("lead-1", { email: "j@test.com" });

    expect(mockSupabase.rpc).toHaveBeenCalledWith("merge_lead_state", {
      p_lead_id: "lead-1",
      p_patch: { email: "j@test.com" },
    });
    // Retorna o state mergeado que veio do banco (fonte da verdade), não um
    // eco do patch local — quem chamar deve resincronizar lead.state com isso.
    expect(merged).toEqual({ name: "João", email: "j@test.com" });
  });

  it("should update lead position + state via merge_lead_state_and_position RPC", async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: { step: 2 },
      error: null,
    });

    await service.updatePositionAndState("lead-1", "flow-1", "node-3", { step: 2 }, "onboarding");

    expect(mockSupabase.rpc).toHaveBeenCalledWith("merge_lead_state_and_position", {
      p_lead_id: "lead-1",
      p_patch: { step: 2 },
      p_flow_id: "flow-1",
      p_node_id: "node-3",
      p_active_flow_name: "onboarding",
      p_set_active_flow_name: true,
    });
  });
});
