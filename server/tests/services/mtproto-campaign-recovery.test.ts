import { describe, it, expect, vi } from "vitest";
import { campaignNeedsJob, recoverCampaigns, type RecoverableCampaign } from "../../src/services/mtproto/campaign-recovery.js";

const now = Date.parse("2026-09-22T02:00:00Z");
const campaign: RecoverableCampaign = { id: "c1", status: "running", next_run_at: null, is_processing: true, processing_started_at: "2026-09-21T18:00:00Z" };
describe("recuperação de disparos", () => {
  it("recupera o caso real: running abandonado depois da perda do job", () => {
    expect(campaignNeedsJob(campaign, now)).toBe(true);
  });
  it.each(["paused", "draft", "failed", "completed"])("não ressuscita %s", (status) => {
    expect(campaignNeedsJob({ ...campaign, status }, now)).toBe(false);
  });
  it("respeita heartbeat recente e a espera do Telegram", () => {
    expect(campaignNeedsJob({ ...campaign, processing_started_at: new Date(now - 30_000).toISOString() }, now)).toBe(false);
    expect(campaignNeedsJob({ ...campaign, status: "scheduled", next_run_at: new Date(now + 60_000).toISOString() }, now)).toBe(false);
  });
  it("retoma espera vencida mesmo sem recorrência configurada", () => {
    expect(campaignNeedsJob({ ...campaign, status: "scheduled", next_run_at: new Date(now - 1).toISOString(), is_processing: false }, now)).toBe(true);
  });
  it("uma falha na fila não abandona as demais campanhas nem altera a intenção no banco", async () => {
    const enqueue = vi.fn().mockRejectedValueOnce(new Error("Redis offline")).mockResolvedValue(undefined);
    const onError = vi.fn();
    await recoverCampaigns([campaign, { ...campaign, id: "c2" }], enqueue, onError, now);
    expect(enqueue.mock.calls).toEqual([["c1"], ["c2"]]);
    expect(onError).toHaveBeenCalledOnce();
    expect(campaign.status).toBe("running");
  });
});
