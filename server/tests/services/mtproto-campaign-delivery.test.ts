import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignDeliveryDeadline, campaignMessageId } from "../../src/services/mtproto/campaign-delivery.js";

afterEach(() => vi.useRealTimers());
describe("retomada de uma entrega interrompida", () => {
  it("reutiliza random_id no mesmo ciclo e muda no próximo", () => {
    expect(campaignMessageId("target", "cycle-1")).toBe(campaignMessageId("target", "cycle-1"));
    expect(campaignMessageId("target", "cycle-1")).not.toBe(campaignMessageId("target", "cycle-2"));
    expect(campaignMessageId("target", "cycle-1")).not.toBe(campaignMessageId("other", "cycle-1"));
  });
  it("encerra conexão travada para liberar o job e permitir retomada", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    const result = campaignDeliveryDeadline(() => new Promise(() => {}), abort, 90_000);
    const assertion = expect(result).rejects.toThrow("CAMPAIGN_SEND_TIMEOUT");
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    expect(abort).toHaveBeenCalledOnce();
  });
  it("não cancela uma entrega que já terminou", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    await expect(campaignDeliveryDeadline(async () => "ok", abort)).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(abort).not.toHaveBeenCalled();
  });
});
