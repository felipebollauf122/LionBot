import { describe, it, expect } from "vitest";
import { campaignProgress } from "@/lib/mtproto/campaign-progress";

const campaign = { status: "running", total_targets: 630, sent_count: 22, failed_count: 58, skipped_count: 370, is_processing: true, processing_started_at: "2026-09-21T18:16:32Z" };
describe("leitura do progresso do disparo", () => {
  it("explica os 1000 destinos reais sem misturar aptos e pulados", () => {
    expect(campaignProgress(campaign)).toMatchObject({ total: 1000, pending: 550, processed: 450, percent: 45 });
  });
  it("não chama de Enviando uma trava abandonada", () => {
    expect(campaignProgress(campaign, Date.parse("2026-09-22T01:00:00Z")).label).toBe("Recuperando envio");
    expect(campaignProgress(campaign, Date.parse("2026-09-21T18:17:00Z")).label).toBe("Enviando");
  });
  it("pausa manual prevalece sobre heartbeat e agendamento", () => {
    expect(campaignProgress({ ...campaign, status: "paused" }).label).toBe("Pausado por você");
  });
  it("espera com pendentes é retomada, não conclusão", () => {
    expect(campaignProgress({ ...campaign, status: "scheduled" }).label).toBe("Aguardando retomada");
  });
});
